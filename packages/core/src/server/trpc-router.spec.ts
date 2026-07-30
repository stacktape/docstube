import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TRPCError } from '@trpc/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { AgentTaskSpec, Codemap, Flag, ManifestIndex, PageEntity, Transcript } from '@docstube/contracts';
import {
  buildFixturePage,
  buildFixturePageShard,
  buildFixtureStructuralFinding,
  contentHash,
  fixtureConfigInput,
  idPrefixes,
  mintId,
  transcriptSchema
} from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { createRunJournal } from '../state/run-journal.ts';
import { createControlPlaneCaller } from './trpc-router.ts';

const now = '2026-07-12T00:00:00.000Z';

const buildFlag = (overrides: Partial<Flag>): Flag => ({
  id: mintId(idPrefixes.flag),
  kind: 'tribal-knowledge',
  status: 'open',
  summary: 'Why is the retry cap three?',
  createdAt: now,
  ...overrides
});

describe('control plane router', () => {
  let repoRoot: string;
  let page: PageEntity;
  let runId: string;
  let pageFlag: Flag;
  let systemFlag: Flag;
  let caller: ReturnType<typeof createControlPlaneCaller>;

  beforeAll(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'docstube-control-plane-'));
    caller = createControlPlaneCaller({ repoRoot });

    const configText = stringify(fixtureConfigInput);
    await writeFile(join(repoRoot, 'docstube.yml'), configText, 'utf8');
    const iaText = stringify({ schemaVersion: 1, tree: [{ title: 'Installation', slug: 'installation' }] });
    await writeFile(join(repoRoot, 'ia.yml'), iaText, 'utf8');

    page = buildFixturePage();
    pageFlag = buildFlag({
      question: 'Why is the retry cap three?',
      entity: { version: 'latest', locale: 'en', pageId: page.id }
    });
    systemFlag = buildFlag({ kind: 'system', summary: 'Build system looks like Bazel and pnpm at once' });

    const pageStructuralFinding = {
      ...buildFixtureStructuralFinding(['pg_00000000000000000009', page.id]),
      key: 'structure.empty-section:page',
      code: 'structure.empty-section',
      scope: { kind: 'entity' as const, pageId: page.id },
      detector: { kind: 'deterministic' as const, id: 'outline-integrity', version: '1' },
      authority: { kind: 'builtin-rule' as const, ruleCode: 'outline-integrity.empty-section' },
      repairTargets: [page.id]
    };
    const shard = {
      ...buildFixturePageShard(page),
      flags: [pageFlag],
      structuralFindings: [pageStructuralFinding]
    };
    const index: ManifestIndex = {
      schemaVersion: 1,
      docstubeVersion: '0.0.2',
      sourceLocale: 'en',
      locales: ['en'],
      versions: [{ label: 'latest', status: 'current' }],
      pages: [{ id: page.id, slug: page.slug, title: page.title, path: 'getting-started/installation.mdx' }],
      configHash: contentHash(configText),
      iaHash: contentHash(iaText),
      structuralGroups: ['compute-resources'],
      systemFlags: [systemFlag]
    };
    const store = createManifestStore(repoRoot, 'latest');
    await store.writePageShard(shard);
    await store.writeStructuralShard({
      schemaVersion: 1,
      groupId: 'compute-resources',
      generatedAt: '2026-07-12T00:00:00.000Z',
      pageIds: [page.id],
      findings: [
        buildFixtureStructuralFinding(['pg_00000000000000000009', page.id]),
        {
          ...buildFixtureStructuralFinding(['pg_00000000000000000009', page.id]),
          key: 'resolved',
          status: { state: 'resolved' }
        }
      ]
    });
    await store.writeIndex(index);

    runId = mintId(idPrefixes.run);
    const journal = await createRunJournal(repoRoot, runId);
    await journal.append({ type: 'run-started', mode: 'generate', commit: 'a1b2c3d' });
    await journal.append({ type: 'page-status', pageId: page.id, status: 'writing' });
    await journal.append({
      type: 'task-completed',
      taskId: mintId(idPrefixes.task),
      pageId: page.id,
      usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.12, cacheHit: false }
    });
    await journal.append({ type: 'page-status', pageId: page.id, status: 'passed' });
    await journal.append({ type: 'run-completed', outcome: 'passed' });
  });

  it('lists runs with head/tail journal info', async () => {
    const runs = await caller.runs.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runId, eventCount: 5, mode: 'generate', commit: 'a1b2c3d', outcome: 'passed' });
    expect(runs[0]?.startedAt).toBeDefined();
    expect(runs[0]?.updatedAt).toBeDefined();
  });

  it('returns the full journal for a run', async () => {
    const events = await caller.runs.events({ runId });
    expect(events).toHaveLength(5);
    expect(events[0]?.type).toBe('run-started');
    expect(events[4]?.type).toBe('run-completed');
  });

  it('summarizes a run via the shared fold', async () => {
    const summary = await caller.runs.summary({ runId });
    expect(summary.outcome).toBe('passed');
    expect(summary.pageStatus[page.id]).toBe('passed');
  });

  it('rejects path-shaped run ids', async () => {
    await expect(caller.runs.events({ runId: '../escape' })).rejects.toThrow(/expected a run id/);
  });

  it('serves the manifest index and page shards', async () => {
    const index = await caller.manifest.index();
    expect(index?.pages).toHaveLength(1);
    expect(index?.pages[0]?.title).toBe('Installation');

    const shard = await caller.manifest.page({ locale: 'en', pageId: page.id });
    expect(shard?.page.title).toBe('Installation');
    expect(shard?.flags).toHaveLength(1);

    const missing = await caller.manifest.page({ locale: 'en', pageId: mintId(idPrefixes.page) });
    expect(missing).toBeNull();
  });

  it('folds page-shard flags and system flags into the flag queue', async () => {
    const entries = await caller.flags.list();
    expect(entries).toHaveLength(2);
    const pageEntry = entries.find((entry) => entry.scope === 'page');
    expect(pageEntry?.flag.id).toBe(pageFlag.id);
    expect(pageEntry?.pageTitle).toBe('Installation');
    expect(pageEntry?.flag.entity?.pageId).toBe(page.id);
    const systemEntry = entries.find((entry) => entry.scope === 'system');
    expect(systemEntry?.flag.id).toBe(systemFlag.id);
    expect(systemEntry?.pageId).toBeUndefined();
  });

  it('keeps structural findings out of the flag queue and on their own surface', async () => {
    const entries = await caller.flags.list();
    // The queue is unchanged by the structural work items written into the same shard.
    expect(entries).toHaveLength(2);

    const view = await caller.structural.list();
    expect(view.summary).toBe('Structural quality: 2 open · nonblocking');
    expect(view.open.map((entry) => entry.scope).toSorted()).toEqual(['nav-group', 'page']);
    // A group finding badges the pages it actually names, so the NavTree can point at real work.
    expect(view.openByPageId[page.id]).toBe(2);
    expect(view.openByGroupId['compute-resources']).toBe(1);
    // A resolved finding is committed history, not work.
    expect(view.open.every((entry) => entry.finding.status.state === 'open')).toBe(true);
  });

  it('returns the parsed config family without raw file contents', async () => {
    const family = await caller.config.family();
    expect(family.config.docType).toBe('external-library');
    expect(family.ia.tree).toHaveLength(1);
    expect(family).not.toHaveProperty('raw');
  });
});

describe('control plane router on an empty repo', () => {
  it('returns empty views instead of failing', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'docstube-control-plane-empty-'));
    const caller = createControlPlaneCaller({ repoRoot: emptyRoot });
    expect(await caller.runs.list()).toEqual([]);
    expect(await caller.runs.events({ runId: 'run_00000000000000000000' })).toEqual([]);
    expect(await caller.manifest.index()).toBeNull();
    expect(await caller.flags.list()).toEqual([]);
    expect(await caller.structural.list()).toMatchObject({
      open: [],
      summary: 'Structural quality: 0 open · nonblocking'
    });
    await expect(caller.config.family()).rejects.toThrowError(TRPCError);
  });
});

// --- write surface (wizard + flag queue + review UI) ---

const annotatedConfigText = ['# wizard must keep me', stringify(fixtureConfigInput).trimEnd(), ''].join('\n');

type WriteRepo = {
  repoRoot: string;
  page: PageEntity;
  tribalFlag: Flag;
  systemFlag: Flag;
};

const setupWriteRepo = async (): Promise<WriteRepo> => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-control-plane-write-'));
  await writeFile(join(repoRoot, 'docstube.yml'), annotatedConfigText, 'utf8');
  await writeFile(
    join(repoRoot, 'ia.yml'),
    stringify({ schemaVersion: 1, tree: [{ title: 'Installation', slug: 'installation' }] }),
    'utf8'
  );
  const page = buildFixturePage();
  const tribalFlag: Flag = {
    id: mintId(idPrefixes.flag),
    kind: 'tribal-knowledge',
    status: 'open',
    summary: 'writer question: why is the retry cap three?',
    question: 'Why is the retry cap three?',
    entity: { version: 'latest', locale: 'en', pageId: page.id },
    createdAt: '2026-07-12T00:00:00.000Z'
  };
  const systemFlag: Flag = {
    id: mintId(idPrefixes.flag),
    kind: 'system',
    status: 'open',
    summary: 'Build system looks like Bazel and pnpm at once',
    createdAt: '2026-07-12T00:00:00.000Z'
  };
  const store = createManifestStore(repoRoot, 'latest');
  await store.writeIndex({
    schemaVersion: 1,
    docstubeVersion: '0.0.2',
    sourceLocale: 'en',
    locales: ['en'],
    versions: [{ label: 'latest', status: 'current' }],
    pages: [{ id: page.id, slug: page.slug, title: page.title, path: 'getting-started/installation.mdx' }],
    configHash: contentHash(annotatedConfigText),
    iaHash: contentHash('ia'),
    structuralGroups: [],
    systemFlags: [systemFlag]
  });
  await store.writePageShard({ ...buildFixturePageShard(page), flags: [tribalFlag] });
  return { repoRoot, page, tribalFlag, systemFlag };
};

const structuredTranscript = (value: unknown): Transcript =>
  transcriptSchema.parse({
    schemaVersion: 1,
    taskId: mintId(idPrefixes.task),
    cacheKey: 'test',
    transport: 'replay',
    model: 'replay',
    turns: [],
    usage: {},
    stopReason: 'complete',
    result: { type: 'structured', value }
  });

const createStubRunner = (respond: (spec: AgentTaskSpec) => unknown) => {
  const specs: AgentTaskSpec[] = [];
  return {
    specs,
    runTask: async (spec: AgentTaskSpec): Promise<Transcript> => {
      specs.push(spec);
      return structuredTranscript(respond(spec));
    }
  };
};

const fixtureCodemap: Codemap = {
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
const threeProposalsValue = {
  proposals: [
    { id: 'task-oriented', label: 'Task-oriented', rationale: 'Readers come with jobs.', tree: proposalTree },
    { id: 'by-module', label: 'By module', rationale: 'Clear module seams.', tree: proposalTree },
    { id: 'user-journey', label: 'User journey', rationale: 'Zero to prod.', tree: proposalTree }
  ]
};

describe('flag mutations', () => {
  it('answers a tribal-knowledge flag end-to-end: knowledge file written, flag resolved', async () => {
    const { repoRoot, page, tribalFlag } = await setupWriteRepo();
    const caller = createControlPlaneCaller({ repoRoot });

    const updated = await caller.flags.answer({ flagId: tribalFlag.id, text: 'Three keeps p99 under a second.' });
    expect(updated.status).toBe('resolved');
    expect(updated.answer?.text).toBe('Three keeps p99 under a second.');

    // The answer is committed as a KnowledgeNeed + KnowledgeFact pair, not a question-hash file.
    const needFiles = await readdir(join(repoRoot, '.docstube', 'knowledge', 'needs'));
    const factFiles = await readdir(join(repoRoot, '.docstube', 'knowledge', 'facts'));
    expect(needFiles).toHaveLength(1);
    expect(factFiles).toHaveLength(1);
    const need = await readFile(join(repoRoot, '.docstube', 'knowledge', 'needs', needFiles[0]!), 'utf8');
    const fact = await readFile(join(repoRoot, '.docstube', 'knowledge', 'facts', factFiles[0]!), 'utf8');
    expect(need).toContain('Why is the retry cap three?');
    expect(fact).toContain('Three keeps p99 under a second.');
    expect(JSON.parse(fact).author.startsWith('local-ui')).toBe(true);

    const shard = await createManifestStore(repoRoot, 'latest').readPageShard({ locale: 'en', pageId: page.id });
    expect(shard?.flags[0]?.status).toBe('resolved');
  });

  it('answers a system flag in the manifest index', async () => {
    const { repoRoot, systemFlag } = await setupWriteRepo();
    const caller = createControlPlaneCaller({ repoRoot });
    const updated = await caller.flags.answer({ flagId: systemFlag.id, text: 'It is pnpm; Bazel files are vendored.' });
    expect(updated.status).toBe('answered');
    const entries = await caller.flags.list();
    expect(entries.find((entry) => entry.flag.id === systemFlag.id)?.flag.status).toBe('answered');
  });

  it('dismisses a flag', async () => {
    const { repoRoot, tribalFlag } = await setupWriteRepo();
    const caller = createControlPlaneCaller({ repoRoot });
    const updated = await caller.flags.dismiss({ flagId: tribalFlag.id });
    expect(updated.status).toBe('dismissed');
    const entries = await caller.flags.list();
    expect(entries.find((entry) => entry.flag.id === tribalFlag.id)?.flag.status).toBe('dismissed');
  });

  it('reports NOT_FOUND for an unknown flag id', async () => {
    const { repoRoot } = await setupWriteRepo();
    const caller = createControlPlaneCaller({ repoRoot });
    await expect(caller.flags.dismiss({ flagId: mintId(idPrefixes.flag) })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });
});

describe('wizard config writes', () => {
  it('updates config values while preserving hand comments', async () => {
    const { repoRoot } = await setupWriteRepo();
    const caller = createControlPlaneCaller({ repoRoot });
    const updated = await caller.config.update({ updates: [{ path: ['site', 'title'], value: 'Renamed Docs' }] });
    expect(updated.site.title).toBe('Renamed Docs');
    const text = await readFile(join(repoRoot, 'docstube.yml'), 'utf8');
    expect(text).toContain('# wizard must keep me');
    expect((await caller.config.family()).config.site.title).toBe('Renamed Docs');
  });

  it('rejects invalid config updates without touching the file', async () => {
    const { repoRoot } = await setupWriteRepo();
    const caller = createControlPlaneCaller({ repoRoot });
    await expect(caller.config.update({ updates: [{ path: ['docType'], value: 'nonsense' }] })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    });
    expect(await readFile(join(repoRoot, 'docstube.yml'), 'utf8')).toBe(annotatedConfigText);
  });

  it('round-trips an ia update', async () => {
    const { repoRoot } = await setupWriteRepo();
    const caller = createControlPlaneCaller({ repoRoot });
    const ia = {
      schemaVersion: 1 as const,
      tree: [{ title: 'Quickstart', slug: 'quickstart', brief: 'Get running in five minutes.' }]
    };
    const written = await caller.ia.update({ ia });
    expect(written.tree[0]?.slug).toBe('quickstart');
    const family = await caller.config.family();
    expect(family.ia.tree).toHaveLength(1);
    expect(family.ia.tree[0]?.title).toBe('Quickstart');
  });

  it('scaffolds the config family once and refuses to overwrite', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'docstube-control-plane-scaffold-'));
    const caller = createControlPlaneCaller({ repoRoot: emptyRoot });
    const ia = { schemaVersion: 1, tree: [{ title: 'Home', slug: 'home' }] };
    const result = await caller.setup.scaffold({ config: fixtureConfigInput as Record<string, unknown>, ia });
    expect(result.configPath).toBe(join(emptyRoot, 'docstube.yml'));
    expect((await caller.config.family()).config.docType).toBe('external-library');
    await expect(
      caller.setup.scaffold({ config: fixtureConfigInput as Record<string, unknown>, ia })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('serves the deterministic detection with persona suggestions', async () => {
    const { repoRoot } = await setupWriteRepo();
    await writeFile(
      join(repoRoot, 'package.json'),
      JSON.stringify({ name: 'fixture-lib', description: 'A fixture library.', main: 'dist/lib.js' }),
      'utf8'
    );
    const caller = createControlPlaneCaller({ repoRoot });
    const result = await caller.detect.project();
    // A public package with a `main` entry is unambiguously a library.
    expect(result.detection.docType).toBe('external-library');
    expect(result.detection.projectContext).toBe('A fixture library.');
    expect(result.suggestedPersonas.map((persona) => persona.id)).toContain('app-developer');
  });
});

describe('review feedback intake', () => {
  it('appends explicitly categorized feedback with a durable entity anchor', async () => {
    const { repoRoot, page } = await setupWriteRepo();
    const caller = createControlPlaneCaller({ repoRoot });
    const result = await caller.feedback.submit({
      entity: { version: 'latest', locale: 'en', pageId: page.id },
      text: 'Stop using marketing adjectives in install steps.',
      category: 'instructions'
    });
    expect(result).toMatchObject({ category: 'instructions', file: '.docstube/instructions/ui-feedback.md' });
    const text = await readFile(join(repoRoot, '.docstube', 'instructions', 'ui-feedback.md'), 'utf8');
    expect(text).toContain(`<!-- entity: version=latest locale=en page=${page.id} -->`);
    expect(text).toContain('Stop using marketing adjectives in install steps.');
  });

  it('routes uncategorized feedback through the categorizer task', async () => {
    const { repoRoot, page } = await setupWriteRepo();
    const stub = createStubRunner(() => ({ category: 'criteria', refined: 'Install steps must be adjective-free.' }));
    const caller = createControlPlaneCaller({ repoRoot, runTask: stub.runTask });
    const entityId = page.sections[0]?.id;
    const result = await caller.feedback.submit({
      entity: { version: 'latest', locale: 'en', pageId: page.id, ...(entityId ? { entityId } : {}) },
      text: 'too much fluff here'
    });
    expect(stub.specs[0]?.kind).toBe('categorize-feedback');
    expect(result.category).toBe('criteria');
    const text = await readFile(join(repoRoot, '.docstube', 'criteria', 'ui-feedback.md'), 'utf8');
    expect(text).toContain('Install steps must be adjective-free.');
    expect(text).toContain(`entity=${entityId}`);
  });

  it('fails cleanly when no agent runner is configured', async () => {
    const { repoRoot, page } = await setupWriteRepo();
    const caller = createControlPlaneCaller({ repoRoot });
    await expect(
      caller.feedback.submit({ entity: { version: 'latest', locale: 'en', pageId: page.id }, text: 'fluff' })
    ).rejects.toThrow(/agent runner not configured/);
  });
});

describe('agent-backed wizard mutations', () => {
  it('proposes three IAs through the injected runner and codemap provider', async () => {
    const { repoRoot } = await setupWriteRepo();
    const stub = createStubRunner(() => threeProposalsValue);
    const caller = createControlPlaneCaller({
      repoRoot,
      runTask: stub.runTask,
      codemapProvider: async () => fixtureCodemap
    });
    const result = await caller.ia.propose();
    expect(stub.specs[0]?.kind).toBe('propose-ia');
    expect(stub.specs[0]?.userPrompt).toContain('greet');
    expect(result.proposals).toHaveLength(3);
    expect(result.proposals[0]?.ia.schemaVersion).toBe(1);
  });

  it('rejects ia.propose without an injected runner', async () => {
    const { repoRoot } = await setupWriteRepo();
    const caller = createControlPlaneCaller({ repoRoot });
    await expect(caller.ia.propose()).rejects.toThrow(/agent runner not configured/);
  });

  it('extracts theme tokens with the injected read tools', async () => {
    const { repoRoot } = await setupWriteRepo();
    const stub = createStubRunner(() => ({ tokens: { accent: '#123456', bogus: 'nope' } }));
    const readTools = [{ name: 'read_file', description: 'Read a file', paramsJsonSchema: { type: 'object' } }];
    const caller = createControlPlaneCaller({ repoRoot, runTask: stub.runTask, toolDescriptors: readTools });
    const result = await caller.theme.extractTokens();
    expect(stub.specs[0]?.kind).toBe('extract-theme-tokens');
    expect(stub.specs[0]?.tools).toEqual(readTools);
    expect(result.tokens).toEqual({ accent: '#123456' });
    expect(result.warnings[0]).toMatch(/bogus/);
  });

  it('starts runs through the injected launcher', async () => {
    const { repoRoot } = await setupWriteRepo();
    const launched: string[] = [];
    const runId = mintId(idPrefixes.run);
    const caller = createControlPlaneCaller({
      repoRoot,
      launchRun: async (mode) => {
        launched.push(mode);
        return { runId };
      }
    });
    expect(await caller.runs.start({ mode: 'refine' })).toEqual({ runId });
    expect(launched).toEqual(['refine']);
    // 'refresh' is not a run mode anymore (pipeline-v2 decision 1) — the input schema rejects it.
    await expect(caller.runs.start({ mode: 'refresh' as never })).rejects.toThrow(/invalid|refresh/i);
    const bare = createControlPlaneCaller({ repoRoot });
    await expect(bare.runs.start({ mode: 'generate' })).rejects.toThrow(/agent runner not configured/);
  });
});
