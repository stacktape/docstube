import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentHash } from '@docstube/contracts';
import { parseObservedReadLines } from './transports/claude-cli.ts';
import { runSubprocess } from './subprocess.ts';

// Smoke test for the executable MCP entry: spawns a real node process (never an AI agent) the way
// the claude-cli transport does, and proves env config + JSON-RPC wiring + the observed-reads sink.

const RETRY_TS = 'export const retries = 3;\n';
const binPath = join(dirname(fileURLToPath(import.meta.url)), 'mcp-stdio-server-bin.ts');

let repoRoot: string;
let sinkFile: string;

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-mcp-bin-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'retry.ts'), RETRY_TS, 'utf8');
  sinkFile = join(repoRoot, 'observed-reads.jsonl');
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('mcp-stdio-server-bin', () => {
  it('serves initialize, tools/list, and tools/call over stdio and appends observed reads to the sink', async () => {
    const requests = [
      { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'read_file', arguments: { path: 'src/retry.ts' } }
      }
    ];
    const result = await runSubprocess({
      command: process.execPath,
      args: ['--conditions=docstube-source', binPath],
      cwd: repoRoot,
      input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
      timeoutMs: 30_000,
      env: {
        DOCSTUBE_MCP_REPO_ROOT: repoRoot,
        DOCSTUBE_MCP_READ_ROOTS: JSON.stringify(['.']),
        DOCSTUBE_MCP_OBSERVED_READS_FILE: sinkFile
      }
    });

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    const responses = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { id: number; result: Record<string, unknown> });
    expect(responses.map((response) => response.id)).toEqual([0, 1, 2]);
    expect(responses[0]?.result).toMatchObject({ serverInfo: { name: 'docstube-tools' } });
    expect((responses[1]?.result.tools as { name: string }[] | undefined)?.map((tool) => tool.name)).toEqual([
      'read_file',
      'list_dir',
      'glob',
      'grep'
    ]);

    const reads = parseObservedReadLines(await readFile(sinkFile, 'utf8'));
    expect(reads).toEqual([{ file: 'src/retry.ts', contentHash: contentHash(RETRY_TS) }]);
  }, 40_000);
});
