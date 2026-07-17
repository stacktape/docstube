import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docstubeConfigSchema, fixtureConfigInput } from '@docstube/contracts';
import { createTaskRunnerFromConfig, resolveTransportId, taskModelFor } from './task-runner.ts';

// Transport wiring: the public enum stops at four transports; DOCSTUBE_TRANSPORT_OVERRIDE is the
// internal escape hatch for 'replay'/'google'. Review tasks route to agents.reviewModel.

let repoRoot: string;

const config = (agents: Record<string, unknown>) => docstubeConfigSchema.parse({ ...fixtureConfigInput, agents });

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-task-runner-'));
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('resolveTransportId', () => {
  it('uses the config transport when no override is set', () => {
    expect(resolveTransportId(config({ transport: 'codex-cli' }), {})).toBe('codex-cli');
    expect(resolveTransportId(config({ transport: 'codex-cli' }), { DOCSTUBE_TRANSPORT_OVERRIDE: '' })).toBe(
      'codex-cli'
    );
  });

  it('lets DOCSTUBE_TRANSPORT_OVERRIDE reach the internal-only transports', () => {
    expect(resolveTransportId(config({}), { DOCSTUBE_TRANSPORT_OVERRIDE: 'replay' })).toBe('replay');
    expect(resolveTransportId(config({}), { DOCSTUBE_TRANSPORT_OVERRIDE: 'google' })).toBe('google');
  });

  it('rejects unknown override values instead of passing them through', () => {
    expect(() => resolveTransportId(config({}), { DOCSTUBE_TRANSPORT_OVERRIDE: 'gemini-cli' })).toThrow(
      /not a known transport/
    );
  });
});

describe('review-model routing', () => {
  it('routes review-page tasks to agents.reviewModel and everything else to agents.model', () => {
    expect(taskModelFor({ kind: 'review-page', model: 'big', reviewModel: 'small' })).toBe('small');
    expect(taskModelFor({ kind: 'write-page', model: 'big', reviewModel: 'small' })).toBe('big');
    expect(taskModelFor({ kind: 'review-page', model: 'big' })).toBe('big');
  });

  it('createTaskRunnerFromConfig applies the routing per task kind', () => {
    const runner = createTaskRunnerFromConfig(config({ model: 'gpt-5.5', reviewModel: 'gpt-5.5-mini' }), repoRoot, {
      DOCSTUBE_TRANSPORT_OVERRIDE: 'replay'
    });
    expect(runner.transportId).toBe('replay');
    expect(runner.model).toBe('gpt-5.5');
    expect(runner.reviewModel).toBe('gpt-5.5-mini');
    expect(runner.modelForTaskKind('review-page')).toBe('gpt-5.5-mini');
    expect(runner.modelForTaskKind('write-page')).toBe('gpt-5.5');
    expect(runner.modelForTaskKind('translate-page')).toBe('gpt-5.5');
  });

  it('review tasks fall back to the primary model when reviewModel is unset', () => {
    const runner = createTaskRunnerFromConfig(config({ model: 'gpt-5.5' }), repoRoot, {
      DOCSTUBE_TRANSPORT_OVERRIDE: 'replay'
    });
    expect(runner.reviewModel).toBe('gpt-5.5');
    expect(runner.modelForTaskKind('review-page')).toBe('gpt-5.5');
  });
});
