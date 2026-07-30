import { describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Transcript } from '@docstube/contracts';
import { docstubeConfigSchema } from '@docstube/contracts';
import { preflightSkipReason, preflightTaskSpec, runTransportPreflight } from './preflight-transport.ts';

// The setup preflight is a LIVE call by construction, so the invariant under test is that no test
// or CI path can ever make one: either the environment short-circuits it, or a runner is injected.

const config = docstubeConfigSchema.parse({
  schemaVersion: 1,
  docType: 'external-library',
  personas: [{ id: 'app-developer', description: 'Builds apps' }],
  agents: { transport: 'anthropic-api', model: 'claude-sonnet-5' },
  site: { title: 'Docs' }
});

const transcriptFor = (spec: AgentTaskSpec, overrides: Partial<Transcript> = {}): Transcript => ({
  schemaVersion: 1,
  taskId: spec.id,
  cacheKey: 'test',
  transport: 'scripted',
  model: 'scripted-model',
  turns: [],
  observedReads: [],
  usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
  stopReason: 'complete',
  result: { type: 'text', text: 'ok' },
  ...overrides
});

describe('preflight task', () => {
  it('is tiny and read-only — one turn, no tools, no writable roots', () => {
    const spec = preflightTaskSpec();
    expect(spec.kind).toBe('preflight');
    expect(spec.budget).toEqual({ maxTurns: 1, maxToolCalls: 0 });
    expect(spec.tools).toEqual([]);
    expect(spec.workspace.writableRoots).toEqual([]);
  });
});

describe('preflight skip rules', () => {
  it('never runs live under the test runner, in CI, or when explicitly opted out', () => {
    expect(preflightSkipReason({ VITEST: 'true' })).toContain('test runner');
    expect(preflightSkipReason({ CI: 'true' })).toContain('CI');
    expect(preflightSkipReason({ DOCSTUBE_SKIP_PREFLIGHT: '1' })).toContain('DOCSTUBE_SKIP_PREFLIGHT');
    expect(preflightSkipReason({})).toBeUndefined();
  });

  it('reports a skip as skipped, not as a pass', async () => {
    const result = await runTransportPreflight({ repoRoot: process.cwd(), config, env: { CI: 'true' } });
    expect(result.skipped).toBe(true);
    expect(result.detail).toContain('CI');
  });
});

describe('preflight outcomes', () => {
  it('passes when the injected transport answers', async () => {
    const result = await runTransportPreflight({
      repoRoot: process.cwd(),
      config,
      env: {},
      runTask: async (spec) => transcriptFor(spec)
    });
    expect(result).toMatchObject({ ok: true, skipped: false, transport: 'scripted', model: 'scripted-model' });
  });

  it('fails with the transport error verbatim — an auth problem must be readable in setup', async () => {
    const result = await runTransportPreflight({
      repoRoot: process.cwd(),
      config,
      env: {},
      runTask: () => Promise.reject(new Error('missing API key: set the ANTHROPIC_API_KEY environment variable'))
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('ANTHROPIC_API_KEY');
  });

  it('treats an error stop reason as a failure even when the call itself resolved', async () => {
    const result = await runTransportPreflight({
      repoRoot: process.cwd(),
      config,
      env: {},
      runTask: async (spec) => transcriptFor(spec, { stopReason: 'error', error: 'rate limited' })
    });
    expect(result).toMatchObject({ ok: false, detail: 'rate limited' });
  });
});
