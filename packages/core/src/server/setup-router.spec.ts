import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTaskSpec, Codemap, Transcript } from '@docstube/contracts';
import { readOnboardingDraft, saveOnboardingDraft } from '../config/onboarding-draft.ts';
import type { PreflightResult } from '../pipeline/preflight-transport.ts';
import { createControlPlaneCaller } from './trpc-router.ts';

// FIRST-RUN CONTROL PLANE (PRODUCT §3.9.1/§3.9.2). Everything here runs with NO committed config,
// which is exactly the state the old wizard could not operate in.

let repoRoot: string;

const codemap: Codemap = {
  schemaVersion: 1,
  commit: 'a1b2c3d',
  symbols: [
    {
      hash: `ts:${'0'.repeat(64)}`,
      lang: 'ts',
      kind: 'function',
      name: 'greet',
      containerPath: [],
      file: 'src/greet.ts',
      span: [1, 5],
      visibility: 'public',
      project: '.'
    }
  ]
};

const proposalTree = [{ title: 'Guides', slug: 'guides', brief: 'Overview of the guides.', depth: 'standard' }];
const threeProposals = {
  proposals: [
    { id: 'task-oriented', label: 'Task-oriented', rationale: 'Readers come with jobs.', tree: proposalTree },
    { id: 'by-module', label: 'By module', rationale: 'Clear module seams.', tree: proposalTree },
    { id: 'user-journey', label: 'User journey', rationale: 'Zero to prod.', tree: proposalTree }
  ]
};

const structuredRunner = (value: unknown) => {
  const specs: AgentTaskSpec[] = [];
  return {
    specs,
    runTask: async (spec: AgentTaskSpec): Promise<Transcript> => {
      specs.push(spec);
      return {
        schemaVersion: 1,
        taskId: spec.id,
        cacheKey: 'test',
        transport: 'scripted',
        model: 'scripted-model',
        turns: [],
        observedReads: [],
        usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
        stopReason: 'complete',
        result: { type: 'structured', value }
      };
    }
  };
};

const configInput = {
  schemaVersion: 1,
  docType: 'external-library',
  projectContext: 'A toolkit.',
  personas: [{ id: 'app-developer', description: 'Builds apps' }],
  agents: { transport: 'claude-cli', model: 'sonnet' },
  site: { title: 'Toolkit Docs' }
};
const iaInput = { schemaVersion: 1, tree: [{ title: 'Getting started', slug: 'getting-started', brief: 'Install.' }] };

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-setup-router-'));
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'toolkit', type: 'module' }), 'utf8');
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('setup.status', () => {
  it('tells the UI to open setup in a fresh workspace and the dashboard once config exists', async () => {
    const caller = createControlPlaneCaller({ repoRoot });
    expect(await caller.setup.status()).toMatchObject({ hasConfig: false, initialSurface: 'setup' });

    await caller.setup.commit({ config: configInput, ia: iaInput, startRun: false });
    expect(await caller.setup.status()).toMatchObject({ hasConfig: true, initialSurface: 'dashboard' });
  });
});

describe('setup draft procedures', () => {
  it('autosaves and reloads the draft — a browser refresh mid-setup resumes', async () => {
    const caller = createControlPlaneCaller({ repoRoot });
    await caller.setup.saveDraft({ patch: { step: 3, agents: { transport: 'claude-cli' } } });
    await caller.setup.saveDraft({ patch: { config: { site: { title: 'Toolkit Docs' } } } });

    const reloaded = await caller.setup.draft();
    expect(reloaded?.step).toBe(3);
    expect(reloaded?.agents.transport).toBe('claude-cli');
    expect(reloaded?.config).toMatchObject({ site: { title: 'Toolkit Docs' } });
  });
});

describe('agent-backed setup steps run from the draft', () => {
  // THE CIRCULARITY REGRESSION. ia.propose is an AI step designed for first run; before the draft
  // it called loadConfigFamily and therefore could only work after the config it helps produce
  // already existed.
  it('proposes an IA with NO committed config present, using the draft as prompt context', async () => {
    await saveOnboardingDraft(repoRoot, {
      agents: { transport: 'claude-cli', model: 'sonnet' },
      config: {
        docType: 'external-library',
        projectContext: 'A toolkit for building acme apps.',
        personas: [{ id: 'app-developer', description: 'Builds apps' }],
        site: { title: 'Toolkit Docs' }
      }
    });
    const runner = structuredRunner(threeProposals);
    const caller = createControlPlaneCaller({
      repoRoot,
      runTask: runner.runTask,
      codemapProvider: async () => codemap
    });

    const result = await caller.ia.propose();
    expect(result.proposals).toHaveLength(3);
    // The draft's own intent reached the prompt — not a placeholder, and not a committed file.
    expect(runner.specs[0]?.systemPrompt).toContain('A toolkit for building acme apps.');
    expect(runner.specs[0]?.systemPrompt).toContain('app-developer');
  });

  it('still refuses when there is neither a config nor a draft to run from', async () => {
    const runner = structuredRunner(threeProposals);
    const caller = createControlPlaneCaller({
      repoRoot,
      runTask: runner.runTask,
      codemapProvider: async () => codemap
    });
    await expect(caller.ia.propose()).rejects.toThrow(/not found/);
  });
});

describe('setup.preflight', () => {
  it('records the outcome on the draft so the Generate step can show it without re-billing', async () => {
    await saveOnboardingDraft(repoRoot, { agents: { transport: 'claude-cli' } });
    const caller = createControlPlaneCaller({
      repoRoot,
      preflight: async () => ({ ok: true, skipped: false, transport: 'claude-cli', model: 'sonnet', detail: 'ok' })
    });
    const result = await caller.setup.preflight();
    expect(result.ok).toBe(true);
    expect((await readOnboardingDraft(repoRoot))?.preflight?.ok).toBe(true);
  });

  it('fails cleanly when the host injected no preflight capability', async () => {
    await saveOnboardingDraft(repoRoot, { agents: { transport: 'claude-cli' } });
    const caller = createControlPlaneCaller({ repoRoot });
    await expect(caller.setup.preflight()).rejects.toThrow(/agent runner not configured/);
  });
});

describe('setup.commit is one atomic action', () => {
  it('preflights, writes both files, and starts the generate run', async () => {
    const launchRun = vi.fn<() => Promise<{ runId: string }>>(async () => ({ runId: 'run_abc' }));
    const preflight = vi.fn<() => Promise<PreflightResult>>(async () => ({
      ok: true,
      skipped: false,
      transport: 'claude-cli',
      model: 'sonnet',
      detail: 'claude-cli answered'
    }));
    const caller = createControlPlaneCaller({ repoRoot, launchRun, preflight });

    const result = await caller.setup.commit({ config: configInput, ia: iaInput });
    expect(result.runId).toBe('run_abc');
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(launchRun).toHaveBeenCalledWith('generate');
    expect(await readFile(join(repoRoot, 'docstube.yml'), 'utf8')).toContain('docType: external-library');
    expect(await readFile(join(repoRoot, 'ia.yml'), 'utf8')).toContain('getting-started');
    // Setup is over: the draft must not linger and shadow the committed files.
    expect(await readOnboardingDraft(repoRoot)).toBeUndefined();
  });

  it('writes NOTHING when the preflight fails — a bad credential must not half-set-up the repo', async () => {
    const launchRun = vi.fn<() => Promise<{ runId: string }>>(async () => ({ runId: 'run_abc' }));
    const caller = createControlPlaneCaller({
      repoRoot,
      launchRun,
      preflight: async () => ({
        ok: false,
        skipped: false,
        transport: 'anthropic-api',
        model: 'claude-sonnet-5',
        detail: 'missing API key: set the ANTHROPIC_API_KEY environment variable'
      })
    });

    await expect(caller.setup.commit({ config: configInput, ia: iaInput })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    await expect(readFile(join(repoRoot, 'docstube.yml'), 'utf8')).rejects.toThrow(/ENOENT/);
    expect(launchRun).not.toHaveBeenCalled();
  });

  it('rejects an invalid config before touching disk', async () => {
    const caller = createControlPlaneCaller({ repoRoot, launchRun: async () => ({ runId: 'run_abc' }) });
    await expect(caller.setup.commit({ config: { ...configInput, docType: 'nonsense' }, ia: iaInput })).rejects.toThrow(
      /docType/
    );
    await expect(readFile(join(repoRoot, 'docstube.yml'), 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('preserves hand-written comments when setup rewrites a pre-existing config', async () => {
    await writeFile(
      join(repoRoot, 'docstube.yml'),
      [
        '# Keep this note — it explains why we document this repo the way we do.',
        'schemaVersion: 1',
        'docType: external-library',
        '# The personas below were argued about at length.',
        'personas:',
        '  - id: app-developer',
        '    description: Builds apps',
        'site:',
        '  title: Old Title',
        ''
      ].join('\n'),
      'utf8'
    );
    await writeFile(join(repoRoot, 'ia.yml'), 'schemaVersion: 1\ntree: []\n', 'utf8');

    const caller = createControlPlaneCaller({ repoRoot, launchRun: async () => ({ runId: 'run_abc' }) });
    await caller.setup.commit({
      config: { ...configInput, site: { title: 'New Title' } },
      ia: iaInput,
      updates: [{ path: ['site', 'title'], value: 'New Title' }]
    });

    const written = await readFile(join(repoRoot, 'docstube.yml'), 'utf8');
    expect(written).toContain('# Keep this note');
    expect(written).toContain('# The personas below were argued about at length.');
    expect(written).toContain('title: New Title');
  });
});
