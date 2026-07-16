import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentHash } from '@docstube/contracts';
import { createObservedReadsCollector, createStandardTools } from './tools.ts';
import type { ObservedReadsCollector, ToolImplementation } from './tools.ts';
import { handleMcpMessage } from './mcp-stdio-server.ts';

const RETRY_TS = 'export const retries = 3;\n';

let repoRoot: string;
let observedReads: ObservedReadsCollector;
let tools: ToolImplementation[];

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-mcp-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'retry.ts'), RETRY_TS, 'utf8');
  observedReads = createObservedReadsCollector();
  tools = createStandardTools({ repoRoot, readRoots: ['.'], observedReads });
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('handleMcpMessage', () => {
  it('answers initialize with server info and tool capability', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { tools }
    );
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 0,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'docstube-tools' } }
    });
  });

  it('stays silent on notifications', async () => {
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, { tools })).toBeUndefined();
  });

  it('lists the tool descriptors', async () => {
    const response = (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { tools })) as {
      result: { tools: { name: string; inputSchema: unknown }[] };
    };
    expect(response.result.tools.map((tool) => tool.name)).toEqual(['read_file', 'list_dir', 'glob', 'grep']);
    expect(response.result.tools[0]?.inputSchema).toMatchObject({ type: 'object' });
  });

  it('routes tools/call through the shared executor and records observed reads', async () => {
    const response = (await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'read_file', arguments: { path: 'src/retry.ts' } }
      },
      { tools }
    )) as { result: { content: { type: string; text: string }[]; isError?: boolean } };
    expect(response.result.isError).toBeUndefined();
    expect(JSON.parse(response.result.content[0]?.text ?? '{}')).toMatchObject({ path: 'src/retry.ts' });
    expect(observedReads.list()).toContainEqual({ file: 'src/retry.ts', contentHash: contentHash(RETRY_TS) });
  });

  it('returns isError results for unknown tools and policy violations', async () => {
    const unknown = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'rm_rf', arguments: {} } },
      { tools }
    )) as { result: { isError?: boolean } };
    expect(unknown.result.isError).toBe(true);

    const escape = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_file', arguments: { path: '../nope' } } },
      { tools }
    )) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(escape.result.isError).toBe(true);
    expect(escape.result.content[0]?.text).toContain('escapes');
  });

  it('answers unknown methods with a JSON-RPC error', async () => {
    const response = (await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, { tools })) as {
      error: { code: number };
    };
    expect(response.error.code).toBe(-32601);
  });
});
