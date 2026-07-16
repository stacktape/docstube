import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentTaskSpecSchema, idPrefixes, mintId } from '@docstube/contracts';
import type { AgentTaskSpec } from '@docstube/contracts';
import { TransportError } from '../errors.ts';
import type { SubprocessRequest, SubprocessResult } from '../subprocess.ts';
import { createObservedReadsCollector, standardToolDescriptors } from '../tools.ts';
import type { SessionRunInput, SessionTurn } from '../transport.ts';
import {
  buildGeminiCliArgs,
  buildGeminiSettings,
  createGoogleTransport,
  parseGeminiStreamEvents,
  writeGeminiWorkspace
} from './google.ts';

describe('buildGeminiCliArgs', () => {
  it('builds the exact headless arg vector from the transport design', () => {
    expect(buildGeminiCliArgs({ prompt: 'Write the retry page.', model: 'gemini-2.5-pro' })).toEqual([
      '-p',
      'Write the retry page.',
      '--output-format',
      'stream-json',
      '--model',
      'gemini-2.5-pro',
      '--skip-trust'
    ]);
  });
});

describe('buildGeminiSettings', () => {
  it('pins API-key auth, disables every built-in tool, and wires our trusted MCP stdio server', () => {
    const settings = buildGeminiSettings({
      serverPath: '/repo/mcp-stdio-server-bin.ts',
      command: 'node',
      nodeArgs: ['--conditions=docstube-source'],
      env: { DOCSTUBE_MCP_REPO_ROOT: '/repo' },
      maxTurns: 8
    });
    expect(settings).toEqual({
      general: { enableAutoUpdate: false, enableNotifications: false },
      security: { auth: { selectedType: 'gemini-api-key' }, folderTrust: { enabled: false } },
      model: { maxSessionTurns: 8 },
      tools: { core: [] },
      mcpServers: {
        docstube: {
          command: 'node',
          args: ['--conditions=docstube-source', '/repo/mcp-stdio-server-bin.ts'],
          env: { DOCSTUBE_MCP_REPO_ROOT: '/repo' },
          trust: true
        }
      }
    });
  });
});

describe('writeGeminiWorkspace', () => {
  it('writes settings.json and the system-prompt replacement file into <dir>/.gemini', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'docstube-gemini-spec-'));
    try {
      const { settingsPath, systemMdPath } = await writeGeminiWorkspace({
        dir,
        settings: buildGeminiSettings({ serverPath: 'server.ts', maxTurns: 4 }),
        systemPrompt: 'You write verified documentation.'
      });
      expect(settingsPath).toBe(join(dir, '.gemini', 'settings.json'));
      expect(systemMdPath).toBe(join(dir, '.gemini', 'system.md'));
      const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
      expect(settings.mcpServers.docstube.args).toEqual(['server.ts']);
      expect(settings.tools.core).toEqual([]);
      expect(await readFile(systemMdPath, 'utf8')).toBe('You write verified documentation.');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Fixture shapes follow packages/core/src/output/types.ts and nonInteractiveCli.ts on
// google-gemini/gemini-cli@main: assistant text always arrives as delta chunks.
const successLines = [
  '{"type":"init","timestamp":"2026-07-13T00:00:00Z","session_id":"s1","model":"gemini-2.5-pro"}',
  '{"type":"message","timestamp":"t","role":"user","content":"Write the retry page."}',
  '{"type":"message","timestamp":"t","role":"assistant","content":"Let me","delta":true}',
  '{"type":"message","timestamp":"t","role":"assistant","content":" read the file.","delta":true}',
  '{"type":"tool_use","timestamp":"t","tool_name":"read_file","tool_id":"call_1","parameters":{"path":"src/retry.ts"}}',
  '{"type":"tool_result","timestamp":"t","tool_id":"call_1","status":"success","output":"export const retries = 3;"}',
  '{"type":"message","timestamp":"t","role":"assistant","content":"# Retry","delta":true}',
  '{"type":"result","timestamp":"t","status":"success","stats":{"total_tokens":165,"input_tokens":120,"output_tokens":45,"cached":0,"input":120,"duration_ms":1234,"tool_calls":1,"models":{}}}'
];

describe('parseGeminiStreamEvents', () => {
  it('accumulates assistant delta chunks and maps tool events into transcript turns', () => {
    const parsed = parseGeminiStreamEvents(successLines);
    expect(parsed.stopReason).toBe('complete');
    expect(parsed.finalText).toBe('# Retry');
    expect(parsed.usage).toEqual({ inputTokens: 120, outputTokens: 45 });
    expect(parsed.turns.map((turn) => turn.role)).toEqual(['assistant', 'assistant', 'tool', 'assistant']);
    expect(parsed.turns[0]?.blocks[0]).toEqual({ type: 'text', text: 'Let me read the file.' });
    expect(parsed.turns[1]?.blocks[0]).toEqual({
      type: 'tool-call',
      toolCallId: 'call_1',
      name: 'read_file',
      args: { path: 'src/retry.ts' }
    });
    expect(parsed.turns[2]?.blocks[0]).toEqual({
      type: 'tool-result',
      toolCallId: 'call_1',
      result: 'export const retries = 3;',
      isError: false
    });
    expect(parsed.turns[3]?.blocks[0]).toEqual({ type: 'text', text: '# Retry' });
  });

  it('normalizes server-prefixed MCP tool names and maps error tool results', () => {
    const parsed = parseGeminiStreamEvents([
      '{"type":"tool_use","timestamp":"t","tool_name":"docstube__read_file","tool_id":"call_2","parameters":{}}',
      '{"type":"tool_result","timestamp":"t","tool_id":"call_2","status":"error","error":{"type":"TOOL_EXECUTION_ERROR","message":"path escapes read roots"}}',
      '{"type":"result","timestamp":"t","status":"success"}'
    ]);
    expect(parsed.turns[0]?.blocks[0]).toMatchObject({ type: 'tool-call', name: 'read_file' });
    expect(parsed.turns[1]?.blocks[0]).toEqual({
      type: 'tool-result',
      toolCallId: 'call_2',
      result: 'path escapes read roots',
      isError: true
    });
  });

  it('maps the turn-limit warning to max-turns and fatal errors to error', () => {
    const maxTurns = parseGeminiStreamEvents([
      '{"type":"error","timestamp":"t","severity":"error","message":"Maximum session turns exceeded"}',
      '{"type":"result","timestamp":"t","status":"success"}'
    ]);
    expect(maxTurns.stopReason).toBe('max-turns');

    const errored = parseGeminiStreamEvents([
      '{"type":"error","timestamp":"t","severity":"error","message":"boom"}',
      '{"type":"result","timestamp":"t","status":"error","error":{"type":"API_ERROR","message":"boom"}}'
    ]);
    expect(errored.stopReason).toBe('error');
    expect(errored.errorMessage).toBe('boom');
  });

  it('ignores warnings, reports an error when no result event arrives, and skips garbage', () => {
    const parsed = parseGeminiStreamEvents([
      'not json',
      '',
      '{"type":"error","timestamp":"t","severity":"warning","message":"Loop detected, stopping execution"}'
    ]);
    expect(parsed.stopReason).toBe('error');
    expect(parsed.errorMessage).toContain('no result event');
    expect(parsed.turns).toEqual([]);
  });
});

const buildSpec = (): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'write-page',
    systemPrompt: 'You write verified documentation.',
    userPrompt: 'Write the retry page.',
    tools: standardToolDescriptors(),
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 8, maxToolCalls: 32 },
    output: { type: 'mdx' }
  });

const runInput = (spec: AgentTaskSpec): SessionRunInput => ({
  spec,
  model: 'gemini-2.5-pro',
  repoRoot: '/repo',
  tools: [],
  observedReads: createObservedReadsCollector()
});

const successResult = (): SubprocessResult => ({
  stdout: successLines.join('\n'),
  stderr: '',
  exitCode: 0,
  timedOut: false
});

type ParsedSettings = {
  model: { maxSessionTurns: number };
  tools: { core: string[] };
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string>; trust: boolean }>;
};

const readScratchSettings = async (request: SubprocessRequest): Promise<ParsedSettings> =>
  JSON.parse(await readFile(join(request.cwd ?? '', '.gemini', 'settings.json'), 'utf8')) as ParsedSettings;

describe('createGoogleTransport runSession', () => {
  it('runs gemini in an isolated scratch HOME with generated settings, system.md, and sink wiring', async () => {
    const requests: SubprocessRequest[] = [];
    let observedSettings: ParsedSettings | undefined;
    let observedSystemMd: string | undefined;
    const transport = createGoogleTransport({
      mcpServerPath: '/repo/packages/agent-runtime/src/mcp-stdio-server-bin.ts',
      nodeArgs: ['--conditions=docstube-source'],
      runner: async (request) => {
        requests.push(request);
        observedSettings = await readScratchSettings(request);
        observedSystemMd = await readFile(request.env?.GEMINI_SYSTEM_MD ?? '', 'utf8');
        const sink = observedSettings.mcpServers.docstube?.env.DOCSTUBE_MCP_OBSERVED_READS_FILE ?? '';
        await writeFile(sink, `${JSON.stringify({ file: 'src/retry.ts', contentHash: 'b'.repeat(64) })}\n`, 'utf8');
        return successResult();
      }
    });
    const input = runInput(buildSpec());
    const turns: SessionTurn[] = [];
    const outcome = await transport.runSession(input, { onTurn: (turn) => turns.push(turn) });

    expect(outcome.stopReason).toBe('complete');
    expect(outcome.finalText).toBe('# Retry');
    expect(outcome.usage).toEqual({ inputTokens: 120, outputTokens: 45 });
    expect(turns).toHaveLength(4);
    expect(input.observedReads.list()).toEqual([{ file: 'src/retry.ts', contentHash: 'b'.repeat(64) }]);

    const request = requests[0];
    expect(request?.command).toBe('gemini');
    expect(request?.args.slice(0, 2)).toEqual(['-p', 'Write the retry page.']);
    expect(request?.cwd).toContain(tmpdir());
    // HOME/USERPROFILE point at the scratch dir so the user's real ~/.gemini never leaks in.
    expect(request?.env?.HOME).toBe(request?.cwd);
    expect(request?.env?.USERPROFILE).toBe(request?.cwd);
    expect(request?.env?.GEMINI_SYSTEM_MD).toBe(join(request?.cwd ?? '', '.gemini', 'system.md'));
    expect(observedSystemMd).toBe('You write verified documentation.');
    expect(observedSettings?.model.maxSessionTurns).toBe(8);
    expect(observedSettings?.tools.core).toEqual([]);
    expect(observedSettings?.mcpServers.docstube?.trust).toBe(true);
    expect(observedSettings?.mcpServers.docstube?.env.DOCSTUBE_MCP_REPO_ROOT).toBe('/repo');
    // scratch dir is removed afterwards
    await expect(readFile(join(request?.cwd ?? '', '.gemini', 'settings.json'), 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('maps the documented turn-limit exit code 53 to a max-turns outcome instead of throwing', async () => {
    const transport = createGoogleTransport({
      mcpServerPath: 'server.ts',
      runner: async () => ({
        stdout: [
          '{"type":"message","timestamp":"t","role":"assistant","content":"partial","delta":true}',
          '{"type":"error","timestamp":"t","severity":"error","message":"Maximum session turns exceeded"}',
          '{"type":"result","timestamp":"t","status":"success","stats":{"total_tokens":12,"input_tokens":10,"output_tokens":2,"cached":0,"input":10,"duration_ms":5,"tool_calls":0,"models":{}}}'
        ].join('\n'),
        stderr: '',
        exitCode: 53,
        timedOut: false
      })
    });
    const outcome = await transport.runSession(runInput(buildSpec()), { onTurn: () => {} });
    expect(outcome.stopReason).toBe('max-turns');
    expect(outcome.errorMessage).toBeUndefined();
    expect(outcome.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
  });

  it('maps non-zero exits to a non-retryable TransportError', async () => {
    const transport = createGoogleTransport({
      mcpServerPath: 'server.ts',
      runner: async () => ({ stdout: '', stderr: 'boom', exitCode: 1, timedOut: false })
    });
    const error = await transport
      .runSession(runInput(buildSpec()), { onTurn: () => {} })
      .then(() => undefined)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).retryable).toBe(false);
    expect((error as TransportError).message).toContain('exited with 1');
  });

  it('detects rate limiting and marks the error retryable', async () => {
    const transport = createGoogleTransport({
      mcpServerPath: 'server.ts',
      runner: async () => ({ stdout: '', stderr: 'Quota exceeded for quota metric', exitCode: 1, timedOut: false })
    });
    const error = await transport
      .runSession(runInput(buildSpec()), { onTurn: () => {} })
      .then(() => undefined)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).rateLimited).toBe(true);
    expect((error as TransportError).retryable).toBe(true);
  });

  it('maps timeouts to a retryable TransportError', async () => {
    const transport = createGoogleTransport({
      mcpServerPath: 'server.ts',
      runner: async () => ({ stdout: '', stderr: '', exitCode: null, timedOut: true })
    });
    const error = await transport
      .runSession(runInput(buildSpec()), { onTurn: () => {} })
      .then(() => undefined)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).retryable).toBe(true);
  });
});
