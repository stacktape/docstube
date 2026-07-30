import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CoreError } from '../errors.ts';
import {
  clearOnboardingDraft,
  draftSetupConfig,
  onboardingDraftRelativePath,
  readOnboardingDraft,
  readSetupStatus,
  resolveSetupConfig,
  saveOnboardingDraft
} from './onboarding-draft.ts';

// FIRST-RUN BOOTSTRAP (PRODUCT §3.9.1/§3.9.2). The bug these cover: setup's own steps needed a
// committed docstube.yml that setup had not written yet, and the UI opened on a dashboard that a
// fresh repository cannot populate.

let repoRoot: string;

const configYaml = [
  '# Hand-written note that must survive every programmatic write.',
  'schemaVersion: 1',
  'docType: external-library',
  'personas:',
  '  - id: app-developer',
  '    description: Builds apps',
  'site:',
  '  title: Greeter Docs',
  ''
].join('\n');

const iaYaml = 'schemaVersion: 1\ntree:\n  - title: Getting started\n    slug: getting-started\n    brief: Install.\n';

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-draft-'));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('setup status', () => {
  it('reports no config in a fresh workspace and routes the UI to setup', async () => {
    const status = await readSetupStatus(repoRoot);
    expect(status.hasConfig).toBe(false);
    expect(status.initialSurface).toBe('setup');
    expect(status.draft).toBeUndefined();
  });

  it('routes to the dashboard once the config family exists', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml, 'utf8');
    await writeFile(join(repoRoot, 'ia.yml'), iaYaml, 'utf8');
    const status = await readSetupStatus(repoRoot);
    expect(status.hasConfig).toBe(true);
    expect(status.initialSurface).toBe('dashboard');
  });

  it('sends an existing-but-broken config back to setup, which is the surface that can repair it', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), 'schemaVersion: 1\ndocType: nonsense\n', 'utf8');
    await writeFile(join(repoRoot, 'ia.yml'), iaYaml, 'utf8');
    const status = await readSetupStatus(repoRoot);
    expect(status.hasConfig).toBe(true);
    expect(status.initialSurface).toBe('setup');
    expect(status.configProblem).toContain('docType');
  });
});

describe('onboarding draft', () => {
  it('autosaves and survives a reload — a refresh mid-setup resumes instead of restarting', async () => {
    await saveOnboardingDraft(repoRoot, { step: 2, agents: { transport: 'claude-cli' } });
    await saveOnboardingDraft(repoRoot, { config: { docType: 'external-product', site: { title: 'Widgets' } } });

    // A "reload" is just another read of the machine-local file.
    const reloaded = await readOnboardingDraft(repoRoot);
    expect(reloaded?.step).toBe(2);
    // The agent block merges rather than being replaced by the later save.
    expect(reloaded?.agents.transport).toBe('claude-cli');
    expect(reloaded?.config).toMatchObject({ docType: 'external-product' });

    // Machine-local, under .docstube/, never next to the user's YAML.
    expect(await readFile(join(repoRoot, onboardingDraftRelativePath), 'utf8')).toContain('claude-cli');
  });

  it('treats a corrupt draft as no draft — setup must never be dead-ended by its own scratch file', async () => {
    await saveOnboardingDraft(repoRoot, { step: 1 });
    await writeFile(join(repoRoot, onboardingDraftRelativePath), '{ not json', 'utf8');
    expect(await readOnboardingDraft(repoRoot)).toBeUndefined();
  });

  it('clears on request', async () => {
    await saveOnboardingDraft(repoRoot, { step: 1 });
    await clearOnboardingDraft(repoRoot);
    expect(await readOnboardingDraft(repoRoot)).toBeUndefined();
  });
});

describe('resolveSetupConfig', () => {
  // THE CIRCULARITY REGRESSION: agent-backed setup steps must be able to build a task runner with
  // NO docstube.yml present, from the provider the user chose moments earlier in setup.
  it('builds a runnable config from the draft when no config is committed', async () => {
    await saveOnboardingDraft(repoRoot, {
      agents: { transport: 'anthropic-api', model: 'claude-sonnet-5', apiKeyEnv: 'ANTHROPIC_API_KEY' },
      config: {
        docType: 'external-library',
        projectContext: 'A toolkit.',
        personas: [{ id: 'app-developer', description: 'Builds apps' }],
        site: { title: 'Toolkit Docs' }
      }
    });

    const { config, source } = await resolveSetupConfig(repoRoot);
    expect(source).toBe('draft');
    expect(config.agents.transport).toBe('anthropic-api');
    expect(config.agents.model).toBe('claude-sonnet-5');
    expect(config.personas[0]?.id).toBe('app-developer');
    expect(config.site.title).toBe('Toolkit Docs');
  });

  it('fills only the fields setup has not reached yet, so a half-filled draft still runs', async () => {
    await saveOnboardingDraft(repoRoot, { agents: { transport: 'claude-cli' } });
    const { config } = await resolveSetupConfig(repoRoot);
    expect(config.agents.transport).toBe('claude-cli');
    expect(config.personas).toHaveLength(1);
    expect(config.site.title.length).toBeGreaterThan(0);
  });

  it('prefers committed config over any leftover draft', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml, 'utf8');
    await writeFile(join(repoRoot, 'ia.yml'), iaYaml, 'utf8');
    await saveOnboardingDraft(repoRoot, { config: { site: { title: 'Draft title' } } });
    const { config, source } = await resolveSetupConfig(repoRoot);
    expect(source).toBe('committed');
    expect(config.site.title).toBe('Greeter Docs');
  });

  it('refuses to run at all without either', async () => {
    await expect(resolveSetupConfig(repoRoot)).rejects.toBeInstanceOf(CoreError);
  });

  it('surfaces an invalid committed config instead of silently running on a draft', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), 'schemaVersion: 1\ndocType: nonsense\n', 'utf8');
    await writeFile(join(repoRoot, 'ia.yml'), iaYaml, 'utf8');
    await saveOnboardingDraft(repoRoot, { agents: { transport: 'claude-cli' } });
    await expect(resolveSetupConfig(repoRoot)).rejects.toMatchObject({ code: 'config-invalid' });
  });
});

describe('draftSetupConfig', () => {
  it('never lets a draft the UI wrote in an unknown shape brick setup', async () => {
    const draft = await saveOnboardingDraft(repoRoot, {
      agents: { transport: 'claude-cli' },
      config: { personas: 'not an array', site: 42 } as unknown as Record<string, unknown>
    });
    const config = draftSetupConfig(draft, repoRoot);
    expect(config.agents.transport).toBe('claude-cli');
    expect(config.personas).toHaveLength(1);
  });
});
