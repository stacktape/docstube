import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TRPCError } from '@trpc/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { Flag, ManifestIndex, PageEntity } from '@docstube/contracts';
import {
  buildFixturePage,
  buildFixturePageShard,
  contentHash,
  fixtureConfigInput,
  idPrefixes,
  mintId
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

    const shard = { ...buildFixturePageShard(page), flags: [pageFlag] };
    const index: ManifestIndex = {
      schemaVersion: 1,
      docstubeVersion: '0.0.2',
      sourceLocale: 'en',
      locales: ['en'],
      versions: [{ label: 'latest', status: 'current' }],
      pages: [{ id: page.id, slug: page.slug, title: page.title, path: 'getting-started/installation.mdx' }],
      configHash: contentHash(configText),
      iaHash: contentHash(iaText),
      systemFlags: [systemFlag]
    };
    const store = createManifestStore(repoRoot, 'latest');
    await store.writeIndex(index);
    await store.writePageShard(shard);

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
    await expect(caller.config.family()).rejects.toThrowError(TRPCError);
  });
});
