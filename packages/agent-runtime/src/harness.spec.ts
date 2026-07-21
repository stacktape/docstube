import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentTaskSpecSchema, contentHash, idPrefixes, mintId } from '@docstube/contracts';
import type { AgentTaskSpec } from '@docstube/contracts';
import { ToolPolicyError } from './errors.ts';
import { runAgentTask, unwrapMdxResponse } from './harness.ts';
import { createSubmitPageTool } from './submit-page.ts';
import type { Transport } from './transport.ts';
import { standardToolDescriptors } from './tools.ts';
import type { AssistantTurn, CompleteInput, LoopTransport, SessionTransport } from './transport.ts';
import { createCodexCliTransport } from './transports/codex-cli.ts';
import { createGoogleTransport } from './transports/google.ts';

const RETRY_TS = 'export const retries = 3;\n';

let repoRoot: string;

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-harness-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'retry.ts'), RETRY_TS, 'utf8');
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

const buildSpec = (overrides: Partial<AgentTaskSpec> = {}): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'write-page',
    systemPrompt: 'You write verified documentation.',
    userPrompt: 'Write the retry page.',
    tools: standardToolDescriptors(),
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 8, maxToolCalls: 32 },
    output: { type: 'mdx' },
    ...overrides
  });

// Scripted fake: returns the queued turns in order, repeating the last one when exhausted.
const scriptedTransport = (turns: AssistantTurn[]): LoopTransport & { calls: CompleteInput[] } => {
  const calls: CompleteInput[] = [];
  let index = 0;
  return {
    mode: 'loop',
    id: 'fake-loop',
    capabilities: { toolInjection: 'native', structuredOutput: true },
    calls,
    complete: async (input) => {
      calls.push(input);
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      if (!turn) {
        throw new Error('scripted transport has no turns');
      }
      return turn;
    }
  };
};

const textTurn = (text: string): AssistantTurn => ({
  blocks: [{ type: 'text', text }],
  usage: { inputTokens: 10, outputTokens: 5 },
  stopReason: 'end'
});

const toolCallTurn = (name: string, args: unknown, toolCallId = 't1'): AssistantTurn => ({
  blocks: [{ type: 'tool-call', toolCallId, name, args }],
  usage: { inputTokens: 10, outputTokens: 5 },
  stopReason: 'tool-use'
});

describe('runAgentTask with a loop transport', () => {
  it('drives tool calls in-process, records observed reads, and returns the mdx result', async () => {
    const spec = buildSpec();
    const transport = scriptedTransport([
      toolCallTurn('read_file', { path: 'src/retry.ts' }),
      textTurn('# Retry\n\n`retries` defaults to 3.')
    ]);

    const transcript = await runAgentTask(spec, { transport, model: 'test-model', repoRoot });

    expect(transcript.stopReason).toBe('complete');
    expect(transcript.result).toEqual({ type: 'mdx', mdx: '# Retry\n\n`retries` defaults to 3.' });
    expect(transcript.turns.map((turn) => turn.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(transcript.observedReads).toEqual([{ file: 'src/retry.ts', contentHash: contentHash(RETRY_TS) }]);
    expect(transcript.usage).toMatchObject({ inputTokens: 20, outputTokens: 10, cacheHit: false });
    // The tool result the model saw came from the real in-process handler.
    const toolTurn = transcript.turns[1];
    expect(toolTurn?.blocks[0]).toMatchObject({ type: 'tool-result', toolCallId: 't1', isError: false });
    // The transport received the tool result back as a message for the next completion.
    expect(transport.calls[1]?.messages.at(-1)?.role).toBe('tool');
  });

  it('estimates costUsd from the pricing table for known models and leaves it unset otherwise', async () => {
    const spec = buildSpec();
    const turns = [toolCallTurn('read_file', { path: 'src/retry.ts' }), textTurn('# Retry')];

    const known = await runAgentTask(spec, {
      transport: scriptedTransport(turns),
      model: 'claude-sonnet-5-20260401',
      repoRoot
    });
    // Two completions at 10 in / 5 out each: (20 * 3 + 10 * 15) / 1e6.
    expect(known.usage.costUsd).toBeCloseTo(0.00021, 10);

    const unknown = await runAgentTask(spec, {
      transport: scriptedTransport(turns),
      model: 'test-model',
      repoRoot
    });
    expect(unknown.usage.costUsd).toBeUndefined();
  });

  it('stops with max-turns when the model never emits a final answer', async () => {
    const spec = buildSpec({ budget: { maxTurns: 2, maxToolCalls: 32 } });
    const transport = scriptedTransport([toolCallTurn('read_file', { path: 'src/retry.ts' })]);

    const transcript = await runAgentTask(spec, { transport, model: 'test-model', repoRoot });

    expect(transcript.stopReason).toBe('max-turns');
    expect(transcript.result).toBeUndefined();
    expect(transcript.turns).toHaveLength(4);
  });

  it('stops with max-tool-calls and marks over-budget calls as errors', async () => {
    const spec = buildSpec({ budget: { maxTurns: 8, maxToolCalls: 2 } });
    const transport = scriptedTransport([
      {
        blocks: [
          { type: 'tool-call', toolCallId: 'a', name: 'read_file', args: { path: 'src/retry.ts' } },
          { type: 'tool-call', toolCallId: 'b', name: 'read_file', args: { path: 'src/retry.ts' } },
          { type: 'tool-call', toolCallId: 'c', name: 'read_file', args: { path: 'src/retry.ts' } }
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'tool-use'
      }
    ]);

    const transcript = await runAgentTask(spec, { transport, model: 'test-model', repoRoot });

    expect(transcript.stopReason).toBe('max-tool-calls');
    const results = transcript.turns[1]?.blocks ?? [];
    expect(results.map((block) => (block.type === 'tool-result' ? block.isError : undefined))).toEqual([
      false,
      false,
      true
    ]);
  });

  it('surfaces tool policy violations to the model as error results, not crashes', async () => {
    const spec = buildSpec();
    const transport = scriptedTransport([toolCallTurn('read_file', { path: '../escape.txt' }), textTurn('done')]);

    const transcript = await runAgentTask(spec, { transport, model: 'test-model', repoRoot });

    expect(transcript.stopReason).toBe('complete');
    const result = transcript.turns[1]?.blocks[0];
    expect(result).toMatchObject({ type: 'tool-result', isError: true });
  });

  it('throws ToolPolicyError when a spec tool has no registered handler', async () => {
    const spec = buildSpec({
      tools: [{ name: 'summon_demon', description: 'nope', paramsJsonSchema: { type: 'object' } }]
    });
    const transport = scriptedTransport([textTurn('unused')]);
    await expect(runAgentTask(spec, { transport, model: 'test-model', repoRoot })).rejects.toThrow(ToolPolicyError);
  });
});

describe('structured output', () => {
  const jsonSchema = {
    type: 'object',
    required: ['severity', 'findings'],
    properties: {
      severity: { type: 'string', enum: ['info', 'warning', 'error'] },
      findings: { type: 'array', items: { type: 'string' } }
    }
  };

  it('parses a valid JSON object on the first try', async () => {
    const spec = buildSpec({ output: { type: 'structured', jsonSchema } });
    const transport = scriptedTransport([textTurn('{"severity":"warning","findings":["stale default"]}')]);

    const transcript = await runAgentTask(spec, { transport, model: 'test-model', repoRoot });

    expect(transcript.stopReason).toBe('complete');
    expect(transcript.result).toEqual({
      type: 'structured',
      value: { severity: 'warning', findings: ['stale default'] }
    });
    // The schema instruction is appended to the system prompt.
    expect(transport.calls[0]?.systemPrompt).toContain('JSON Schema');
  });

  it('re-prompts once with the validation error and accepts the repaired output', async () => {
    const spec = buildSpec({ output: { type: 'structured', jsonSchema }, budget: { maxTurns: 1, maxToolCalls: 4 } });
    const transport = scriptedTransport([
      textTurn('{"severity":"catastrophic","findings":[]}'),
      textTurn('{"severity":"error","findings":[]}')
    ]);

    const transcript = await runAgentTask(spec, { transport, model: 'test-model', repoRoot });

    expect(transcript.stopReason).toBe('complete');
    expect(transcript.result).toEqual({ type: 'structured', value: { severity: 'error', findings: [] } });
    const repairMessage = transport.calls[1]?.messages.at(-1);
    expect(repairMessage?.role).toBe('user');
    expect(repairMessage && 'text' in repairMessage ? repairMessage.text : '').toContain('rejected');
  });

  it('stops with an error after the single repair retry fails', async () => {
    const spec = buildSpec({ output: { type: 'structured', jsonSchema } });
    const transport = scriptedTransport([textTurn('not json at all, sorry')]);

    const transcript = await runAgentTask(spec, { transport, model: 'test-model', repoRoot });

    expect(transcript.stopReason).toBe('error');
    expect(transcript.result).toBeUndefined();
    expect(transcript.error).toContain('JSON');
  });

  it('accepts fenced JSON output', async () => {
    const spec = buildSpec({ output: { type: 'structured', jsonSchema } });
    const transport = scriptedTransport([textTurn('```json\n{"severity":"info","findings":[]}\n```')]);

    const transcript = await runAgentTask(spec, { transport, model: 'test-model', repoRoot });
    expect(transcript.result).toEqual({ type: 'structured', value: { severity: 'info', findings: [] } });
  });
});

describe('runAgentTask with a session transport', () => {
  it('collects vendor-driven turns and observed reads through the shared executor', async () => {
    const spec = buildSpec();
    const transport: SessionTransport = {
      mode: 'session',
      id: 'fake-session',
      capabilities: { toolInjection: 'mcp', structuredOutput: false },
      runSession: async (input, hooks) => {
        // Simulate the vendor CLI calling our tool through the MCP boundary.
        const readFileTool = input.tools.find((tool) => tool.descriptor.name === 'read_file');
        const result = await readFileTool?.handler({ path: 'src/retry.ts' });
        hooks.onTurn({
          role: 'assistant',
          blocks: [{ type: 'tool-call', toolCallId: 's1', name: 'read_file', args: { path: 'src/retry.ts' } }]
        });
        hooks.onTurn({ role: 'tool', blocks: [{ type: 'tool-result', toolCallId: 's1', result, isError: false }] });
        hooks.onTurn({ role: 'assistant', blocks: [{ type: 'text', text: '# Retry' }] });
        expect(input.spec.systemPrompt).toBe(spec.systemPrompt);
        return { finalText: '# Retry', usage: { inputTokens: 100, outputTokens: 40 }, stopReason: 'complete' as const };
      }
    };

    const transcript = await runAgentTask(spec, { transport, model: 'vendor-model', repoRoot });

    expect(transcript.stopReason).toBe('complete');
    expect(transcript.result).toEqual({ type: 'mdx', mdx: '# Retry' });
    expect(transcript.turns).toHaveLength(3);
    expect(transcript.observedReads).toEqual([{ file: 'src/retry.ts', contentHash: contentHash(RETRY_TS) }]);
    expect(transcript.usage).toMatchObject({ inputTokens: 100, outputTokens: 40 });
  });
});

describe('mdx-ledger output via submit_page', () => {
  const submittedMdx = '---\ntitle: "Retry"\n---\n\n# Retry\n\n<Claim id="c1">`retries` defaults to 3.</Claim>\n';
  const submittedLedger = {
    schemaVersion: 1,
    claims: [{ markerId: 'c1', class: 'value', predicate: 'retries defaults to 3' }]
  };

  const ledgerSpec = () => {
    const { tool } = createSubmitPageTool();
    const spec = buildSpec({
      tools: [...standardToolDescriptors(), tool.descriptor],
      output: { type: 'mdx-ledger' }
    });
    return { spec, tool };
  };

  it('completes with the accepted submission as the task result (loop transport)', async () => {
    const { spec, tool } = ledgerSpec();
    const transport = scriptedTransport([
      toolCallTurn('submit_page', { mdx: submittedMdx, ledger: submittedLedger }),
      textTurn('Done.')
    ]);
    const transcript = await runAgentTask(spec, { transport, model: 'm', repoRoot, extraTools: [tool] });
    expect(transcript.stopReason).toBe('complete');
    expect(transcript.result).toMatchObject({ type: 'mdx-ledger', mdx: submittedMdx });
  });

  it('feeds rejection errors back in-session so the model can repair and resubmit', async () => {
    const { spec, tool } = ledgerSpec();
    const transport = scriptedTransport([
      // First submission misses the ledger entry for its marker.
      toolCallTurn('submit_page', { mdx: submittedMdx, ledger: { schemaVersion: 1, claims: [] } }),
      toolCallTurn('submit_page', { mdx: submittedMdx, ledger: submittedLedger }, 't2'),
      textTurn('Done.')
    ]);
    const transcript = await runAgentTask(spec, { transport, model: 'm', repoRoot, extraTools: [tool] });
    expect(transcript.stopReason).toBe('complete');
    const firstResult = transcript.turns[1]?.blocks[0];
    expect(firstResult).toMatchObject({ type: 'tool-result', isError: false });
    expect(JSON.stringify(firstResult)).toContain('has no ledger entry');
    expect(transcript.result?.type).toBe('mdx-ledger');
  });

  it('prompts once for a missing submission, then errors honestly', async () => {
    const { spec, tool } = ledgerSpec();
    const transport = scriptedTransport([textTurn('Here is the page as chat text (wrong).')]);
    const transcript = await runAgentTask(spec, { transport, model: 'm', repoRoot, extraTools: [tool] });
    expect(transcript.stopReason).toBe('error');
    expect(transcript.error).toContain('without an accepted submit_page call');
    // The repair nudge was actually sent before giving up.
    expect(
      transport.calls.at(-1)?.messages.some((message) => 'text' in message && /submit_page/.test(message.text ?? ''))
    ).toBe(true);
  });

  it('reads the accepted submission after session-transport replay (forwarded tools)', async () => {
    const { spec, tool } = ledgerSpec();
    const transport: SessionTransport = {
      mode: 'session',
      id: 'fake-session',
      capabilities: { toolInjection: 'mcp', structuredOutput: false },
      runSession: async (input, hooks) => {
        // Simulates forwarded-tool replay: the real handler runs before runSession returns.
        const submit = input.tools.find((candidate) => candidate.descriptor.name === 'submit_page');
        await submit?.handler({ mdx: submittedMdx, ledger: submittedLedger });
        hooks.onTurn({ role: 'assistant', blocks: [{ type: 'text', text: 'submitted' }] });
        return { finalText: 'submitted', usage: { inputTokens: 5, outputTokens: 5 }, stopReason: 'complete' as const };
      }
    };
    const transcript = await runAgentTask(spec, { transport, model: 'm', repoRoot, extraTools: [tool] });
    expect(transcript.result).toMatchObject({ type: 'mdx-ledger', mdx: submittedMdx });
  });
});

describe('cli session transports', () => {
  it('codex-cli and google are real session transports with MCP tool injection', () => {
    for (const transport of [createCodexCliTransport(), createGoogleTransport()]) {
      expect(transport.mode).toBe('session');
      expect(transport.capabilities).toEqual({ toolInjection: 'mcp', structuredOutput: false });
    }
  });
});

describe('transport error turns', () => {
  it('surfaces a truncated (error stop-reason) turn as a task error, never a finished page', async () => {
    const spec = buildSpec();
    const transport = scriptedTransport([
      {
        blocks: [{ type: 'text', text: '# Retry\n\nThis page covers retr' }],
        usage: { inputTokens: 10, outputTokens: 32_000 },
        stopReason: 'error',
        errorMessage: 'output truncated at 32000 tokens (stop_reason max_tokens)'
      }
    ]);

    const transcript = await runAgentTask(spec, { transport, model: 'test-model', repoRoot });

    expect(transcript.stopReason).toBe('error');
    expect(transcript.result).toBeUndefined();
    expect(transcript.error).toContain('output truncated at 32000 tokens');
    expect(transcript.usage).toMatchObject({ inputTokens: 10, outputTokens: 32_000 });
  });
});

describe('transport retry with backoff', () => {
  it('accumulates usage from failed attempts into the final transcript', async () => {
    const { TransportError } = await import('./errors.ts');
    let calls = 0;
    const flaky: Transport = {
      mode: 'loop',
      id: 'flaky-usage',
      capabilities: { toolInjection: 'native', structuredOutput: false },
      complete: async () => {
        calls += 1;
        if (calls === 2) {
          // First attempt: one successful tool turn, then a mid-session failure.
          throw new TransportError({ transport: 'flaky-usage', message: 'timeout', retryable: true });
        }
        if (calls === 1 || calls === 3) {
          return calls === 1
            ? toolCallTurn('read_file', { path: 'src/retry.ts' })
            : toolCallTurn('read_file', { path: 'src/retry.ts' });
        }
        return textTurn('# Retry');
      }
    };

    const transcript = await runAgentTask(buildSpec(), {
      transport: flaky,
      model: 'test-model',
      repoRoot,
      retryDelaysMs: [1, 1]
    });

    expect(transcript.stopReason).toBe('complete');
    // Attempt 1 burned 10/5 before failing; attempt 2 spent 20/10 — all of it is accounted.
    expect(transcript.usage).toMatchObject({ inputTokens: 30, outputTokens: 15 });
  });

  it('retries a retryable transport error and succeeds, but rethrows non-retryable ones', async () => {
    const { TransportError } = await import('./errors.ts');
    let calls = 0;
    const flaky: Transport = {
      mode: 'loop',
      id: 'flaky',
      capabilities: { toolInjection: 'native', structuredOutput: false },
      complete: async () => {
        calls += 1;
        if (calls === 1) {
          throw new TransportError({ transport: 'flaky', message: 'rate limited', retryable: true, rateLimited: true });
        }
        return {
          blocks: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'end'
        };
      }
    };
    const spec = agentTaskSpecSchema.parse({
      id: mintId(idPrefixes.task),
      kind: 'write-page',
      systemPrompt: 'x',
      userPrompt: 'y',
      tools: [],
      workspace: { readRoots: ['.'], writableRoots: [] },
      budget: { maxTurns: 2, maxToolCalls: 2 },
      output: { type: 'text' }
    });
    const transcript = await runAgentTask(spec, { transport: flaky, model: 'm', repoRoot: '.', retryDelaysMs: [1, 1] });
    expect(calls).toBe(2);
    expect(transcript.stopReason).toBe('complete');

    const fatal: Transport = {
      ...flaky,
      id: 'fatal',
      complete: async () => {
        throw new TransportError({ transport: 'fatal', message: 'bad auth', retryable: false });
      }
    };
    await expect(
      runAgentTask(
        { ...spec, id: mintId(idPrefixes.task) },
        { transport: fatal, model: 'm', repoRoot: '.', retryDelaysMs: [1] }
      )
    ).rejects.toThrow(/bad auth/u);
  });
});

describe('unwrapMdxResponse', () => {
  const page = '---\ntitle: "X"\n---\n\n# X\n\nBody.';

  it('unwraps chat prose plus a fenced page (live sonnet regression)', () => {
    const wrapped = `Now I have enough to write the corrected page.\n\n\`\`\`mdx\n${page}\n\`\`\`\n`;
    expect(unwrapMdxResponse(wrapped)).toBe(page);
  });

  it('keeps the whole page when it contains inner code fences (live truncation regression)', () => {
    // A lazy match closes the wrapper at the page's FIRST inner fence, chopping everything after
    // the intro sentence — this exact shape shipped truncated and the reviewer caught it.
    const pageWithCode = `---\ntitle: "X"\n---\n\n# X\n\nIntro:\n\n\`\`\`ts\nconst x = greet({ name: 'a' });\n\`\`\`\n\nAfter the example.`;
    const wrapped = `Here is the page.\n\n\`\`\`mdx\n${pageWithCode}\n\`\`\``;
    expect(unwrapMdxResponse(wrapped)).toBe(pageWithCode);
  });

  it('leaves a page that already starts with frontmatter untouched, even with inner fences', () => {
    const withExample = `${page}\n\n\`\`\`mdx\n---\ntitle: "Example"\n---\n\`\`\`\n`;
    expect(unwrapMdxResponse(withExample)).toBe(withExample.trim());
  });

  it('leaves plain unfenced output untouched', () => {
    expect(unwrapMdxResponse('# Just a heading\n\nText.')).toBe('# Just a heading\n\nText.');
  });
});
