import { describe, expect, it } from 'vitest';
import {
  buildClaudeCliArgs,
  buildClaudeMcpConfig,
  buildClaudeStdinPrompt,
  parseClaudeStreamEvents,
  parseObservedReadLines
} from './claude-cli.ts';

describe('buildClaudeCliArgs', () => {
  it('builds the exact non-interactive arg vector from the transport design', () => {
    const args = buildClaudeCliArgs({
      systemPrompt: 'You write verified documentation.',
      model: 'claude-sonnet-5',
      maxTurns: 8,
      mcpConfig: '{"mcpServers":{}}'
    });
    // No prompt in argv: --input-format stream-json makes the CLI ignore an argv prompt and
    // read stdin instead (live-hit: silent empty run). The prompt travels via stdin.
    expect(args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--tools',
      '',
      '--strict-mcp-config',
      '--allowedTools',
      'mcp__docstube',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--max-turns',
      '8',
      '--system-prompt',
      'You write verified documentation.',
      '--model',
      'claude-sonnet-5'
    ]);
  });
});

describe('buildClaudeStdinPrompt', () => {
  it('wraps the prompt as a single stream-json user message line', () => {
    const line = buildClaudeStdinPrompt('Write the retry page.');
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Write the retry page.' }] }
    });
  });
});

describe('buildClaudeMcpConfig', () => {
  it('produces inline stdio server config pointing at our MCP entry', () => {
    const config = JSON.parse(
      buildClaudeMcpConfig({
        serverPath: 'packages/agent-runtime/src/mcp-stdio-server.ts',
        command: 'node',
        nodeArgs: ['--conditions=docstube-source'],
        env: { DOCSTUBE_MCP_REPO_ROOT: '/repo' }
      })
    );
    expect(config).toEqual({
      mcpServers: {
        docstube: {
          type: 'stdio',
          command: 'node',
          args: ['--conditions=docstube-source', 'packages/agent-runtime/src/mcp-stdio-server.ts'],
          env: { DOCSTUBE_MCP_REPO_ROOT: '/repo' }
        }
      }
    });
  });
});

describe('parseClaudeStreamEvents', () => {
  const successLines = [
    '{"type":"system","subtype":"init","session_id":"s1","tools":[],"mcp_servers":[{"name":"docstube","status":"connected"}]}',
    '{"type":"assistant","message":{"id":"msg_01","role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"mcp__docstube__read_file","input":{"path":"src/retry.ts"}}]},"session_id":"s1"}',
    '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":[{"type":"text","text":"{\\"path\\":\\"src/retry.ts\\"}"}]}]},"session_id":"s1"}',
    '{"type":"assistant","message":{"id":"msg_02","role":"assistant","content":[{"type":"text","text":"# Retry"}]},"session_id":"s1"}',
    '{"type":"result","subtype":"success","is_error":false,"duration_ms":1234,"num_turns":2,"result":"# Retry","session_id":"s1","total_cost_usd":0.01,"usage":{"input_tokens":120,"output_tokens":45}}'
  ];

  it('maps stream-json events into transcript turns with normalized tool names', () => {
    const parsed = parseClaudeStreamEvents(successLines);
    expect(parsed.stopReason).toBe('complete');
    expect(parsed.finalText).toBe('# Retry');
    // total_cost_usd from the result event is captured as the vendor-authoritative cost.
    expect(parsed.usage).toEqual({ inputTokens: 120, outputTokens: 45, costUsd: 0.01 });
    expect(parsed.turns.map((turn) => turn.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(parsed.turns[0]?.blocks[0]).toEqual({
      type: 'tool-call',
      toolCallId: 'toolu_01',
      name: 'read_file',
      args: { path: 'src/retry.ts' }
    });
    expect(parsed.turns[1]?.blocks[0]).toEqual({
      type: 'tool-result',
      toolCallId: 'toolu_01',
      result: '{"path":"src/retry.ts"}',
      isError: false
    });
  });

  it('maps max-turns and error result subtypes', () => {
    const maxTurns = parseClaudeStreamEvents([
      '{"type":"result","subtype":"error_max_turns","is_error":true,"num_turns":8,"usage":{"input_tokens":10,"output_tokens":2}}'
    ]);
    expect(maxTurns.stopReason).toBe('max-turns');
    expect(maxTurns.sawResult).toBe(true);

    const errored = parseClaudeStreamEvents([
      '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"boom"}'
    ]);
    expect(errored.stopReason).toBe('error');
    expect(errored.errorMessage).toBe('boom');
  });

  it('reports an error when no result event arrives, and skips garbage lines', () => {
    const parsed = parseClaudeStreamEvents(['not json', '', '{"type":"assistant","message":{"content":[]}}']);
    expect(parsed.stopReason).toBe('error');
    expect(parsed.errorMessage).toContain('no result event');
    expect(parsed.sawResult).toBe(false);
    expect(parsed.turns).toEqual([]);
  });

  it('returns the parsed outcome when the CLI exits non-zero after a result event (max-turns)', async () => {
    // Live regression: the CLI exits 1 after error_max_turns; a concluded session must reach the
    // harness as a max-turns outcome, not crash the run as a TransportError.
    const { createClaudeCliTransport } = await import('./claude-cli.ts');
    const stdout = [
      '{"type":"result","subtype":"error_max_turns","is_error":true,"num_turns":12,"usage":{"input_tokens":10,"output_tokens":2}}'
    ].join('\n');
    const transport = createClaudeCliTransport({
      mcpServerPath: 'server.ts',
      runner: async () => ({ stdout, stderr: '', exitCode: 1, timedOut: false })
    });
    const outcome = await transport.runSession(
      {
        spec: {
          id: 'tk_00000000000000000000',
          kind: 'review-page',
          systemPrompt: 'sys',
          userPrompt: 'user',
          tools: [],
          workspace: { readRoots: ['.'], writableRoots: [] },
          budget: { maxTurns: 12, maxToolCalls: 12 },
          output: { type: 'text' }
        },
        model: 'sonnet',
        repoRoot: '.',
        tools: [],
        observedReads: { record: () => {} }
      } as never,
      { onTurn: () => {} }
    );
    expect(outcome.stopReason).toBe('max-turns');
  });

  it('still throws when the CLI exits non-zero with no result event', async () => {
    const { createClaudeCliTransport } = await import('./claude-cli.ts');
    const transport = createClaudeCliTransport({
      mcpServerPath: 'server.ts',
      runner: async () => ({ stdout: '', stderr: 'spawn failed', exitCode: 1, timedOut: false })
    });
    await expect(
      transport.runSession(
        {
          spec: {
            id: 'tk_00000000000000000000',
            kind: 'review-page',
            systemPrompt: 'sys',
            userPrompt: 'user',
            tools: [],
            workspace: { readRoots: ['.'], writableRoots: [] },
            budget: { maxTurns: 12, maxToolCalls: 12 },
            output: { type: 'text' }
          },
          model: 'sonnet',
          repoRoot: '.',
          tools: [],
          observedReads: { record: () => {} }
        } as never,
        { onTurn: () => {} }
      )
    ).rejects.toThrow('exited with 1');
  });
});

describe('parseObservedReadLines', () => {
  it('parses the JSONL sink written by the MCP server, skipping malformed lines', () => {
    const hash = 'a'.repeat(64);
    const content = [
      `{"file":"src/retry.ts","contentHash":"${hash}"}`,
      'garbage',
      '{"file":"C:\\\\abs\\\\path.ts","contentHash":"nope"}',
      ''
    ].join('\n');
    expect(parseObservedReadLines(content)).toEqual([{ file: 'src/retry.ts', contentHash: hash }]);
  });
});
