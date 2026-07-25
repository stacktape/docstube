import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mcpServerEnvVars } from '../mcp-stdio-server.ts';
import { createSubmitPageTool } from '../submit-page.ts';
import { runSubprocess } from '../subprocess.ts';
import { createObservedReadsCollector, createStandardTools } from '../tools.ts';
import type { ToolImplementation } from '../tools.ts';
import { loadForwardedToolImplementations, prepareForwardedTools } from './forwarded-tools.ts';

const flagQuestionTool = (captured: unknown[]): ToolImplementation => ({
  descriptor: {
    name: 'flag_question',
    description: 'Ask the maintainers.',
    paramsJsonSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] }
  },
  handler: async (args) => {
    captured.push(args);
    return { recorded: true };
  }
});

describe('prepareForwardedTools', () => {
  it('is a no-op when only standard tools are present', async () => {
    const standard = createStandardTools({
      repoRoot: '.',
      readRoots: ['.'],
      observedReads: createObservedReadsCollector()
    });
    const session = await prepareForwardedTools(standard);
    expect(session.env).toEqual({});
    expect(await session.replay()).toBe(0);
  });

  it('round-trips: child records calls to the sink, parent replays them through the real handler', async () => {
    const captured: unknown[] = [];
    const session = await prepareForwardedTools([flagQuestionTool(captured)]);
    const descriptorsFile = session.env[mcpServerEnvVars.extraToolsFile]!;
    const callsFile = session.env[mcpServerEnvVars.toolCallsFile]!;

    // Simulate the child process side.
    const childTools = await loadForwardedToolImplementations(descriptorsFile, (line) => {
      void appendFile(callsFile, `${line}\n`);
    });
    expect(childTools.map((tool) => tool.descriptor.name)).toEqual(['flag_question']);
    const ack = (await childTools[0]!.handler({ question: 'Why is retries 3?' })) as { recorded: boolean };
    expect(ack.recorded).toBe(true);
    // The real handler has NOT run yet — recording is deferred to the parent.
    expect(captured).toEqual([]);

    // Give the fire-and-forget append a tick, then replay parent-side.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await session.replay()).toBe(1);
    expect(captured).toEqual([{ question: 'Why is retries 3?' }]);
    await session.cleanup();
  });

  it("carries submit_page's element policy to the child, so the child accepts EXACTLY what the parent does", async () => {
    // The registered-component whitelist is data, not behavior, so it can cross the process
    // boundary the handler closures cannot. Without it the child would reject a page using a
    // legitimately enabled component while the parent accepted it — the model would then repair a
    // problem that does not exist.
    const submitPage = createSubmitPageTool({ allowedComponents: ['Callout'] });
    const session = await prepareForwardedTools([submitPage.tool]);
    const childTools = await loadForwardedToolImplementations(session.env[mcpServerEnvVars.extraToolsFile]!, () => {});
    const mdx = '---\ntitle: "Retry"\n---\n\n# Retry\n\n<Callout tone="info">Read on.</Callout>\n';
    const ledger = { schemaVersion: 1, claims: [] };
    const child = (await childTools[0]!.handler({ mdx, ledger })) as { accepted: boolean; errors?: string[] };
    expect(child.accepted).toBe(true);

    // …and a component the registry does not know is refused on the child exactly as on the parent.
    const unknown = (await childTools[0]!.handler({
      mdx: mdx.replace('Callout', 'Sneaky').replace('Callout', 'Sneaky'),
      ledger
    })) as { accepted: boolean; errors?: string[] };
    expect(unknown.accepted).toBe(false);
    expect(unknown.errors?.some((error) => error.includes('is not a registered component'))).toBe(true);
    await session.cleanup();
  });

  it('validates FAIL-CLOSED in the child when no policy travels with submit_page', async () => {
    const session = await prepareForwardedTools([createSubmitPageTool().tool]);
    const childTools = await loadForwardedToolImplementations(session.env[mcpServerEnvVars.extraToolsFile]!, () => {});
    const result = (await childTools[0]!.handler({
      mdx: '---\ntitle: "Retry"\n---\n\n# Retry\n\n<Callout tone="info">Read on.</Callout>\n',
      ledger: { schemaVersion: 1, claims: [] }
    })) as { accepted: boolean; errors?: string[] };
    expect(result.accepted).toBe(false);
    expect(result.errors?.some((error) => error.includes('enables no components at all'))).toBe(true);
    await session.cleanup();
  });

  it('skips malformed sink lines and unknown tools without failing', async () => {
    const captured: unknown[] = [];
    const session = await prepareForwardedTools([flagQuestionTool(captured)]);
    const callsFile = session.env[mcpServerEnvVars.toolCallsFile]!;
    await writeFile(
      callsFile,
      [
        'not-json',
        JSON.stringify({ name: 'other_tool', args: {} }),
        JSON.stringify({ name: 'flag_question', args: { question: 'q?' } })
      ].join('\n'),
      'utf8'
    );
    expect(await session.replay()).toBe(1);
    expect(captured).toEqual([{ question: 'q?' }]);
    await session.cleanup();
  });
});

describe('mcp-stdio-server-bin with forwarded tools', () => {
  it('advertises the forwarded tool and acks calls while recording them to the sink', async () => {
    const captured: unknown[] = [];
    const session = await prepareForwardedTools([flagQuestionTool(captured)]);
    const binPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp-stdio-server-bin.ts');
    const requests = [
      { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'flag_question', arguments: { question: 'Why does the queue retry three times?' } }
      }
    ];
    const result = await runSubprocess({
      command: process.execPath,
      args: ['--conditions=docstube-source', binPath],
      cwd: process.cwd(),
      input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
      timeoutMs: 30_000,
      env: { [mcpServerEnvVars.readRoots]: JSON.stringify(['.']), ...session.env }
    });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);

    const responses = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map(
        (line) => JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name: string }>; content?: unknown } }
      );
    const toolNames = responses.find((response) => response.id === 1)?.result?.tools?.map((tool) => tool.name) ?? [];
    expect(toolNames).toContain('flag_question');
    expect(toolNames).toContain('read_file');
    expect(JSON.stringify(responses.find((response) => response.id === 2)?.result?.content)).toContain('recorded');

    const sink = await readFile(session.env[mcpServerEnvVars.toolCallsFile]!, 'utf8');
    expect(sink).toContain('Why does the queue retry three times?');
    expect(await session.replay()).toBe(1);
    expect(captured).toEqual([{ question: 'Why does the queue retry three times?' }]);
    await session.cleanup();
  }, 60_000);

  it('validates submit_page IN-SESSION: invalid call gets repair errors, corrected call gets accepted, parent replay mints the artifact', async () => {
    const submitPage = createSubmitPageTool();
    const session = await prepareForwardedTools([submitPage.tool]);
    const binPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp-stdio-server-bin.ts');
    const goodMdx = '---\ntitle: "Retry"\n---\n\n# Retry\n\n<Claim id="c1">`retries` defaults to 3.</Claim>\n';
    const goodLedger = {
      schemaVersion: 1,
      claims: [{ markerId: 'c1', class: 'value', predicate: 'retries defaults to 3' }]
    };
    const requests = [
      { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        // Invalid first submission: the marker has no ledger entry.
        params: { name: 'submit_page', arguments: { mdx: goodMdx, ledger: { schemaVersion: 1, claims: [] } } }
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'submit_page', arguments: { mdx: goodMdx, ledger: goodLedger } }
      }
    ];
    const result = await runSubprocess({
      command: process.execPath,
      args: ['--conditions=docstube-source', binPath],
      cwd: process.cwd(),
      input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
      timeoutMs: 30_000,
      env: { [mcpServerEnvVars.readRoots]: JSON.stringify(['.']), ...session.env }
    });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);

    const responses = new Map(
      result.stdout
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { id?: number; result?: { content?: Array<{ text?: string }> } })
        .map((response) => [response.id, response] as const)
    );
    // The vendor model saw the REAL validation outcome in-session, not a generic ack.
    const firstBody = JSON.parse(responses.get(1)?.result?.content?.[0]?.text ?? '{}') as {
      accepted: boolean;
      errors?: string[];
    };
    expect(firstBody.accepted).toBe(false);
    expect(firstBody.errors?.some((error) => error.includes('has no ledger entry'))).toBe(true);
    const secondBody = JSON.parse(responses.get(2)?.result?.content?.[0]?.text ?? '{}') as { accepted: boolean };
    expect(secondBody.accepted).toBe(true);

    // The artifact only exists after parent replay through the real handler.
    expect(submitPage.accepted()).toBeUndefined();
    expect(await session.replay()).toBe(2);
    expect(submitPage.accepted()).toMatchObject({ mdx: goodMdx });
    expect(submitPage.tool.taskResult?.()).toMatchObject({ type: 'mdx-ledger', mdx: goodMdx });
    await session.cleanup();
  }, 60_000);
});
