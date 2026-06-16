import { describe, expect, it } from 'vitest';
import {
  AgentReplayMismatchError,
  AgentAdapterExecutionError,
  agentReplayFixtureSchema,
  agentRunInputSchema,
  assertChangesWithinWritableRoots,
  artifactPaths,
  buildClaudeCliRequest,
  buildCodexCliRequest,
  buildDirectApiRequest,
  buildGeminiCliRequest,
  createCliAgentAdapter,
  createDirectApiAdapter,
  createMockAgentAdapter,
  createReplayAgentAdapter,
  detectCliVersion,
  estimateUsage,
  isRateLimitOutput,
  parseAdapterJsonEvents,
  parseCliVersionOutput,
  runAdapterProcess,
  usageExceedsCaps
} from './agent.ts';
import type { AdapterProcessRunner, AgentReplayFixture, AgentRunInput } from './agent.ts';

const input: AgentRunInput = agentRunInputSchema.parse({
  taskId: 'walking-skeleton',
  prompt: 'Generate the overview page.',
  model: 'mock-model',
  sandbox: {
    readOnlyRoots: ['C:/repo'],
    writableRoots: ['C:/repo/docs'],
    allowNetwork: false,
    shell: 'none'
  }
});

const fixture: AgentReplayFixture = agentReplayFixtureSchema.parse({
  version: 1,
  name: 'walking-skeleton',
  recordedAt: '2026-06-16T00:00:00.000Z',
  input,
  result: {
    adapterId: 'mock',
    adapterVersion: '0.0.0',
    status: 'completed',
    startedAt: '2026-06-16T00:00:00.000Z',
    completedAt: '2026-06-16T00:00:01.000Z',
    events: [
      {
        type: 'run-started',
        sequence: 0,
        timestamp: '2026-06-16T00:00:00.000Z',
        adapterId: 'mock',
        adapterVersion: '0.0.0',
        model: 'mock-model',
        sandbox: input.sandbox
      },
      {
        type: 'artifact-written',
        sequence: 1,
        timestamp: '2026-06-16T00:00:01.000Z',
        path: 'docs/overview.mdx',
        bytes: 42
      },
      {
        type: 'run-completed',
        sequence: 2,
        timestamp: '2026-06-16T00:00:01.000Z',
        exitCode: 0
      }
    ],
    artifacts: [{ path: 'docs/overview.mdx', content: '# Overview', encoding: 'utf8' }]
  }
});

const geminiVersionRunner: AdapterProcessRunner = async () => ({
  stdout: 'gemini 0.18.2',
  stderr: '',
  exitCode: 0,
  timedOut: false
});

describe('AgentAdapter contract helpers', () => {
  it('normalizes mock adapter output with events and artifacts', async () => {
    const adapter = createMockAgentAdapter({
      artifacts: [{ path: 'docs/overview.mdx', content: '# Overview', encoding: 'utf8' }],
      output: { pageId: 'overview' }
    });

    const result = await adapter.run(input);
    expect(result.status).toBe('completed');
    expect(result.events.map((event) => event.type)).toEqual(['run-started', 'message', 'run-completed']);
    expect(artifactPaths(result)).toEqual(['docs/overview.mdx']);
  });

  it('replays a fixture only for the exact recorded input', async () => {
    const adapter = createReplayAgentAdapter(fixture);
    await expect(adapter.run(input)).resolves.toEqual(fixture.result);

    await expect(adapter.run({ ...input, prompt: 'Different prompt' })).rejects.toBeInstanceOf(
      AgentReplayMismatchError
    );
  });

  it('rejects unsafe artifact paths in replay fixtures', () => {
    expect(() =>
      agentReplayFixtureSchema.parse({
        ...fixture,
        result: {
          ...fixture.result,
          artifacts: [{ path: '../outside.mdx', content: '# Bad' }]
        }
      })
    ).toThrow('path must not contain');
  });
});

describe('built-in adapter process helpers', () => {
  it('kills hung child processes and reports timeout', async () => {
    const result = await runAdapterProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      timeoutMs: 50
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it('parses version output from recorded command fixtures', async () => {
    expect(parseCliVersionOutput('codex-cli 0.139.0')).toBe('0.139.0');
    expect(parseCliVersionOutput('2.1.177 (Claude Code)')).toBe('2.1.177');

    await expect(detectCliVersion('gemini', ['--version'], geminiVersionRunner)).resolves.toBe('0.18.2');
  });

  it('normalizes JSONL adapter events', () => {
    const events = parseAdapterJsonEvents(
      [
        JSON.stringify({ type: 'session_started' }),
        JSON.stringify({ type: 'message', content: 'writing docs' }),
        JSON.stringify({ type: 'artifact', path: 'docs/overview.mdx', bytes: 12 }),
        JSON.stringify({ type: 'completed' })
      ].join('\n'),
      {
        adapterId: 'codex',
        adapterVersion: '0.139.0',
        model: input.model,
        sandbox: input.sandbox
      }
    );

    expect(events.map((event) => event.type)).toEqual(['run-started', 'message', 'artifact-written', 'run-completed']);
    expect(events[2]).toMatchObject({ path: 'docs/overview.mdx', bytes: 12 });
  });

  it('rejects post-run changes outside writable roots', () => {
    expect(() =>
      assertChangesWithinWritableRoots({
        repoRoot: 'C:/repo',
        writableRoots: ['C:/repo/docs'],
        changedPaths: ['docs/overview.mdx', 'src/secret.ts']
      })
    ).toThrow('outside writable roots');
  });

  it('builds non-interactive CLI requests from the frozen sandbox contract', () => {
    expect(buildCodexCliRequest(input)).toMatchObject({
      command: 'codex',
      args: expect.arrayContaining(['exec', '--json', '--ask-for-approval', 'never', '-']),
      input: input.prompt
    });
    expect(buildClaudeCliRequest(input)).toMatchObject({
      command: 'claude',
      args: expect.arrayContaining(['-p', '--input-format', 'text', '--output-format', 'stream-json'])
    });
    expect(buildGeminiCliRequest(input)).toMatchObject({
      command: 'gemini',
      args: expect.arrayContaining(['-p', input.prompt, '--output-format', 'stream-json'])
    });
  });

  it('surfaces timeout, rate-limit, and guard errors through adapter factories', async () => {
    const timedOut = createCliAgentAdapter({
      id: 'codex',
      version: '0.139.0',
      buildRequest: () => ({ command: 'codex', args: [] }),
      runner: async () => ({ stdout: '', stderr: '', exitCode: null, timedOut: true })
    });
    await expect(timedOut.run(input)).rejects.toMatchObject({ code: 'timeout' });

    const rateLimited = createCliAgentAdapter({
      id: 'claude',
      version: '2.1.177',
      buildRequest: () => ({ command: 'claude', args: [] }),
      runner: async () => ({ stdout: '', stderr: '429 rate limit', exitCode: 1, timedOut: false })
    });
    await expect(rateLimited.run(input)).rejects.toMatchObject({ code: 'rate_limited' });

    const guarded = createCliAgentAdapter({
      id: 'gemini',
      version: '0.18.2',
      repoRoot: 'C:/repo',
      listChangedPaths: () => ['src/outside.ts'],
      buildRequest: () => ({ command: 'gemini', args: [] }),
      runner: async () => ({
        stdout: JSON.stringify({ type: 'completed' }),
        stderr: '',
        exitCode: 0,
        timedOut: false
      })
    });
    await expect(guarded.run(input)).rejects.toBeInstanceOf(AgentAdapterExecutionError);
  });

  it('estimates usage caps and detects rate-limit text', () => {
    const usage = estimateUsage({
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 10
    });

    expect(usage.estimatedUsd).toBe(7);
    expect(usageExceedsCaps(usage, { maxUsd: 5 })).toBe(true);
    expect(isRateLimitOutput('HTTP 429 Too Many Requests')).toBe(true);
  });

  it('builds and runs direct API adapter requests with injected fetch', async () => {
    const request = buildDirectApiRequest('openai', input, { apiKey: 'test-key' });
    expect(request.url).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(request.body)).toMatchObject({ model: input.model, input: input.prompt });

    const adapter = createDirectApiAdapter({
      provider: 'anthropic',
      apiKey: 'test-key',
      now: () => '2026-06-16T00:00:00.000Z',
      fetchJson: async () => ({ content: 'ok' })
    });

    const result = await adapter.run(input);
    expect(result.status).toBe('completed');
    expect(result.output).toEqual({ content: 'ok' });
  });
});
