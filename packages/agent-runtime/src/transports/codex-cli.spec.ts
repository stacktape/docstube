import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { agentTaskSpecSchema, idPrefixes, mintId } from '@docstube/contracts';
import type { AgentTaskSpec } from '@docstube/contracts';
import { TransportError } from '../errors.ts';
import type { SubprocessRequest, SubprocessResult } from '../subprocess.ts';
import { createObservedReadsCollector, standardToolDescriptors } from '../tools.ts';
import type { SessionRunInput, SessionTurn } from '../transport.ts';
import { buildCodexCliArgs, combineCodexPrompt, createCodexCliTransport, parseCodexJsonEvents } from './codex-cli.ts';

describe('combineCodexPrompt', () => {
  it('prepends the system prompt under an explicit delimiter (codex has no system-prompt flag)', () => {
    const combined = combineCodexPrompt('You write verified documentation.', 'Write the retry page.');
    expect(combined).toBe('You write verified documentation.\n\n=== TASK PROMPT ===\n\nWrite the retry page.');
  });
});

describe('buildCodexCliArgs', () => {
  it('builds the exact non-interactive arg vector with TOML -c overrides for the MCP server', () => {
    const args = buildCodexCliArgs({
      prompt: 'Write the retry page.',
      model: 'gpt-5.2-codex',
      mcpServer: {
        command: 'node',
        args: ['--conditions=docstube-source', 'C:\\repo\\mcp-stdio-server-bin.ts'],
        env: { DOCSTUBE_MCP_REPO_ROOT: 'C:\\repo' }
      }
    });
    expect(args).toEqual([
      'exec',
      '-',
      '--json',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--sandbox',
      'read-only',
      '--model',
      'gpt-5.2-codex',
      '-c',
      'features.shell_tool=false',
      '-c',
      'tools.web_search=false',
      '-c',
      'tools.view_image=false',
      '-c',
      'mcp_servers.docstube.command="node"',
      '-c',
      'mcp_servers.docstube.args=["--conditions=docstube-source","C:\\\\repo\\\\mcp-stdio-server-bin.ts"]',
      '-c',
      'mcp_servers.docstube.required=true',
      '-c',
      'mcp_servers.docstube.default_tools_approval_mode="approve"',
      '-c',
      'mcp_servers.docstube.env.DOCSTUBE_MCP_REPO_ROOT="C:\\\\repo"'
    ]);
  });

  it('escapes quotes and newlines in TOML string values', () => {
    const args = buildCodexCliArgs({
      prompt: 'p',
      model: 'm',
      mcpServer: { command: 'no"de', args: [], env: { WEIRD: 'a\nb\t"c"' } }
    });
    expect(args).toContain('mcp_servers.docstube.command="no\\"de"');
    expect(args).toContain('mcp_servers.docstube.env.WEIRD="a\\nb\\t\\"c\\""');
  });
});

// Fixture shapes follow codex-rs/exec/src/exec_events.rs (serde tag "type", flattened item details).
const successLines = [
  '{"type":"thread.started","thread_id":"th_123"}',
  '{"type":"turn.started"}',
  '{"type":"item.started","item":{"id":"item_0","type":"reasoning","text":"thinking"}}',
  '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"done thinking"}}',
  '{"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","server":"docstube","tool":"read_file","arguments":{"path":"src/retry.ts"},"result":null,"error":null,"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"docstube","tool":"read_file","arguments":{"path":"src/retry.ts"},"result":{"content":[{"type":"text","text":"export const retries = 3;"}],"structured_content":null},"error":null,"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"# Retry"}}',
  '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":10,"output_tokens":45,"reasoning_output_tokens":5}}'
];

describe('parseCodexJsonEvents', () => {
  it('maps --json JSONL events into transcript turns with tool calls and results', () => {
    const parsed = parseCodexJsonEvents(successLines);
    expect(parsed.stopReason).toBe('complete');
    expect(parsed.finalText).toBe('# Retry');
    expect(parsed.usage).toEqual({ inputTokens: 120, outputTokens: 45 });
    expect(parsed.turns.map((turn) => turn.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(parsed.turns[0]?.blocks[0]).toEqual({
      type: 'tool-call',
      toolCallId: 'item_1',
      name: 'read_file',
      args: { path: 'src/retry.ts' }
    });
    expect(parsed.turns[1]?.blocks[0]).toEqual({
      type: 'tool-result',
      toolCallId: 'item_1',
      result: 'export const retries = 3;',
      isError: false
    });
    expect(parsed.turns[2]?.blocks[0]).toEqual({ type: 'text', text: '# Retry' });
  });

  it('accumulates usage across multiple turns', () => {
    const parsed = parseCodexJsonEvents([
      '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":2,"reasoning_output_tokens":0}}',
      '{"type":"turn.completed","usage":{"input_tokens":20,"cached_input_tokens":0,"output_tokens":3,"reasoning_output_tokens":0}}'
    ]);
    expect(parsed.usage).toEqual({ inputTokens: 30, outputTokens: 5 });
    expect(parsed.stopReason).toBe('complete');
  });

  it('surfaces failed MCP tool calls as error results', () => {
    const parsed = parseCodexJsonEvents([
      '{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"docstube","tool":"read_file","arguments":{"path":"nope"},"result":null,"error":{"message":"path escapes read roots"},"status":"failed"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}'
    ]);
    expect(parsed.turns[1]?.blocks[0]).toEqual({
      type: 'tool-result',
      toolCallId: 'item_1',
      result: 'path escapes read roots',
      isError: true
    });
  });

  it('maps turn.failed and stream error events to an error stop reason', () => {
    const failed = parseCodexJsonEvents(['{"type":"turn.failed","error":{"message":"model unavailable"}}']);
    expect(failed.stopReason).toBe('error');
    expect(failed.errorMessage).toBe('model unavailable');

    const streamError = parseCodexJsonEvents(['{"type":"error","message":"stream disconnected"}']);
    expect(streamError.stopReason).toBe('error');
    expect(streamError.errorMessage).toBe('stream disconnected');
  });

  it('reports an error when no turn completes, and ignores garbage and unknown event types', () => {
    const parsed = parseCodexJsonEvents([
      'not json',
      '',
      '{"type":"session.mystery","payload":1}',
      '{"type":"item.completed","item":{"id":"item_9","type":"web_search","query":"q"}}'
    ]);
    expect(parsed.stopReason).toBe('error');
    expect(parsed.errorMessage).toContain('no turn completion');
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
  model: 'gpt-5.2-codex',
  repoRoot: 'C:\\repo',
  tools: [],
  observedReads: createObservedReadsCollector()
});

const successResult = (): SubprocessResult => ({
  stdout: successLines.join('\n'),
  stderr: '',
  exitCode: 0,
  timedOut: false
});

const sinkFileFromArgs = (args: string[]): string => {
  const override = args.find((arg) => arg.startsWith('mcp_servers.docstube.env.DOCSTUBE_MCP_OBSERVED_READS_FILE='));
  const escaped = override?.split('=').slice(1).join('=').slice(1, -1) ?? '';
  return escaped.replace(/\\\\/g, '\\');
};

describe('createCodexCliTransport runSession', () => {
  it('spawns codex in a scratch cwd (apply_patch discard), wires the sink env, and returns the outcome', async () => {
    const requests: SubprocessRequest[] = [];
    const transport = createCodexCliTransport({
      mcpServerPath: 'C:\\repo\\packages\\agent-runtime\\src\\mcp-stdio-server-bin.ts',
      nodeArgs: ['--conditions=docstube-source'],
      runner: async (request) => {
        requests.push(request);
        await writeFile(
          sinkFileFromArgs(request.args),
          `${JSON.stringify({ file: 'src/retry.ts', contentHash: 'a'.repeat(64) })}\n`,
          'utf8'
        );
        return successResult();
      }
    });
    const input = runInput(buildSpec());
    const turns: SessionTurn[] = [];
    const outcome = await transport.runSession(input, { onTurn: (turn) => turns.push(turn) });

    expect(outcome.stopReason).toBe('complete');
    expect(outcome.finalText).toBe('# Retry');
    expect(outcome.usage).toEqual({ inputTokens: 120, outputTokens: 45 });
    expect(turns.map((turn) => turn.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(input.observedReads.list()).toEqual([{ file: 'src/retry.ts', contentHash: 'a'.repeat(64) }]);

    const request = requests[0];
    expect(request?.command).toBe('codex');
    expect(request?.args[0]).toBe('exec');
    // The prompt travels via stdin ('-' argv), never argv — long prompts crash codex on Windows.
    expect(request?.args[1]).toBe('-');
    expect(request?.input).toContain('=== TASK PROMPT ===');
    // cwd is a throwaway scratch dir, never the repo: stray apply_patch output is discarded.
    expect(request?.cwd).toContain(tmpdir());
    expect(request?.cwd).not.toBe('C:\\repo');
    expect(request?.args).toContain('mcp_servers.docstube.env.DOCSTUBE_MCP_REPO_ROOT="C:\\\\repo"');
    // the scratch dir and sink file are cleaned up afterwards
    await expect(readFile(sinkFileFromArgs(requests[0]?.args ?? []), 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('maps non-zero exits to a non-retryable TransportError', async () => {
    const transport = createCodexCliTransport({
      mcpServerPath: 'server.ts',
      runner: async () => ({ stdout: '', stderr: 'boom', exitCode: 2, timedOut: false })
    });
    const error = await transport
      .runSession(runInput(buildSpec()), { onTurn: () => {} })
      .then(() => undefined)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).retryable).toBe(false);
    expect((error as TransportError).message).toContain('exited with 2');
  });

  it('does not misread rate-limit words in MODEL OUTPUT of a successful run as a rate limit', async () => {
    // Live regression: docstube documenting its own retry/rate-limit code produced pages whose
    // text contains "rate limited", which the old whole-output scan classified as a quota error.
    const lines = [
      '{"type":"thread.started","thread_id":"th_123"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Requests that are rate limited (429) are retried with backoff."}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}'
    ];
    const transport = createCodexCliTransport({
      mcpServerPath: 'server.ts',
      runner: async () => ({ stdout: lines.join('\n'), stderr: '', exitCode: 0, timedOut: false })
    });
    const session = await transport.runSession(runInput(buildSpec()), { onTurn: () => {} });
    expect(session.finalText).toContain('rate limited');
  });

  it('detects rate limiting and marks the error retryable', async () => {
    const transport = createCodexCliTransport({
      mcpServerPath: 'server.ts',
      runner: async () => ({ stdout: '', stderr: '429 Too Many Requests', exitCode: 1, timedOut: false })
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
    const transport = createCodexCliTransport({
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
