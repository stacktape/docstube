import { describe, expect, it } from 'vitest';
import { detectProviders, soleViableProvider } from './detect-providers.ts';

// PRODUCT §3.9.2 phase 2 / dx-knowledge-v2 decision 2. Detection is deterministic and never shells
// out here — the binary probe is injected, so CI stays offline.

const noBinaries = async (): Promise<boolean> => false;
const onlyClaude = async (binary: string): Promise<boolean> => binary === 'claude';

describe('provider detection', () => {
  it('preselects the sole viable provider and says why', async () => {
    const candidates = await detectProviders({ env: {}, probeBinary: onlyClaude });
    const preselected = soleViableProvider(candidates);
    expect(preselected?.transport).toBe('claude-cli');
    expect(preselected?.reason).toContain('installed on PATH');
    expect(preselected?.defaultModel).toBe('sonnet');
  });

  it('requires an explicit choice when several providers are viable', async () => {
    const candidates = await detectProviders({
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      probeBinary: onlyClaude
    });
    expect(candidates.filter((candidate) => candidate.viable).map((candidate) => candidate.transport)).toEqual([
      'claude-cli',
      'anthropic-api'
    ]);
    // docstube never silently ranks one subscription or API over another.
    expect(soleViableProvider(candidates)).toBeUndefined();
  });

  it('reports nothing viable — and an honest reason — when the machine has neither CLI nor keys', async () => {
    const candidates = await detectProviders({ env: {}, probeBinary: noBinaries });
    expect(candidates.every((candidate) => !candidate.viable)).toBe(true);
    expect(candidates.map((candidate) => candidate.reason)).toEqual([
      '`claude` not found on PATH',
      '`codex` not found on PATH',
      'ANTHROPIC_API_KEY is not set',
      'OPENAI_API_KEY is not set'
    ]);
    expect(soleViableProvider(candidates)).toBeUndefined();
  });

  it('reads only whether a credential variable is set, never its value', async () => {
    const candidates = await detectProviders({ env: { OPENAI_API_KEY: 'sk-secret-value' }, probeBinary: noBinaries });
    expect(JSON.stringify(candidates)).not.toContain('sk-secret-value');
    const openAi = candidates.find((candidate) => candidate.transport === 'openai-compatible');
    expect(openAi?.viable).toBe(true);
    expect(openAi?.apiKeyEnv).toBe('OPENAI_API_KEY');
    // No default model: setup must ask, because the transport factory refuses to guess one.
    expect(openAi?.requiresModel).toBe(true);
  });

  it('ignores a blank credential variable', async () => {
    const candidates = await detectProviders({ env: { ANTHROPIC_API_KEY: '   ' }, probeBinary: noBinaries });
    expect(candidates.find((candidate) => candidate.transport === 'anthropic-api')?.viable).toBe(false);
  });
});
