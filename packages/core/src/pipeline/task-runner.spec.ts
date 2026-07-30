import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docstubeConfigSchema, fixtureConfigInput } from '@docstube/contracts';
import { createTaskRunnerFromConfig } from './task-runner.ts';

// Transport wiring, per ROLE: the runner must construct the transport+model each task kind's role
// resolves to — an unset role inheriting the run default, an overridden one moving alone.

let repoRoot: string;

const config = (agents: Record<string, unknown>) => docstubeConfigSchema.parse({ ...fixtureConfigInput, agents });

const runner = (agents: Record<string, unknown>) =>
  createTaskRunnerFromConfig(config(agents), repoRoot, { DOCSTUBE_TRANSPORT_OVERRIDE: 'replay' });

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-task-runner-'));
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('createTaskRunnerFromConfig', () => {
  it('reports the WRITER routing as the run primary', () => {
    const configured = runner({ model: 'gpt-5.5' });
    expect(configured.transportId).toBe('replay');
    expect(configured.model).toBe('gpt-5.5');
  });

  it('routes every task kind through its role, and unset roles inherit the primary model', () => {
    const configured = runner({ model: 'gpt-5.5' });
    for (const kind of ['write-page', 'review-page', 'translate-page', 'propose-ia', 'extract-theme-tokens']) {
      expect(configured.routingForTaskKind(kind).model).toBe('gpt-5.5');
    }
    expect(configured.routingForTaskKind('review-page').role).toBe('reviewer');
    expect(configured.routingForTaskKind('translate-page').role).toBe('translator');
    expect(configured.routingForTaskKind('propose-ia').role).toBe('architect');
    expect(configured.routingForTaskKind('extract-theme-tokens').role).toBe('extractor');
  });

  it('moves ONLY the overridden role — the writer keeps running on the run default', () => {
    const configured = runner({ model: 'gpt-5.5', roles: { reviewer: { model: 'gpt-5.5-mini' } } });
    expect(configured.routingForTaskKind('review-page').model).toBe('gpt-5.5-mini');
    expect(configured.routingForTaskKind('write-page').model).toBe('gpt-5.5');
    expect(configured.routingForTaskKind('translate-page').model).toBe('gpt-5.5');
    expect(configured.model).toBe('gpt-5.5');
  });

  it('throws for an unusable PRIMARY configuration at wiring time, before a run claims to start', () => {
    expect(() => createTaskRunnerFromConfig(config({ transport: 'codex-cli' }), repoRoot, {})).toThrow(
      /must set agents\.model/
    );
  });
});
