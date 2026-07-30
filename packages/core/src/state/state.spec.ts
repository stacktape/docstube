import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManifestIndex, PageShard, StructuralGroupShard } from '@docstube/contracts';
import { buildFixturePage, buildFixturePageShard } from '@docstube/contracts';
import { createManifestStore } from './manifest-store.ts';
import { createRunJournal, summarizeRun } from './run-journal.ts';

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-state-'));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

const indexFor = (shards: PageShard[], overrides: Partial<ManifestIndex> = {}): ManifestIndex => ({
  schemaVersion: 1,
  docstubeVersion: '0.0.2',
  sourceLocale: 'en',
  locales: ['en'],
  versions: [{ label: 'latest', status: 'current' }],
  pages: shards.map((shard) => ({
    id: shard.page.id,
    slug: shard.page.slug,
    title: shard.page.title,
    path: `content/en/${shard.page.slug}.mdx`
  })),
  configHash: '0'.repeat(64),
  iaHash: '0'.repeat(64),
  structuralGroups: [],
  systemFlags: [],
  ...overrides
});

const shardDir = (locale: string): string => join(repoRoot, '.docstube', 'manifest', 'pages', locale);

const groupShardFor = (groupId: string, pageIds: string[]): StructuralGroupShard => ({
  schemaVersion: 1,
  groupId,
  generatedAt: '2026-07-12T00:00:00.000Z',
  pageIds,
  findings: []
});

describe('structural group shards', () => {
  it('round-trips a group shard with no locale dimension and lists it', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const shard = groupShardFor('compute-resources', ['pg_00000000000000000001']);
    await store.writeStructuralShard(shard);
    expect(await store.readStructuralShard('compute-resources')).toEqual(shard);
    expect(await store.listStructuralGroupIds()).toEqual(['compute-resources']);
    expect(await stat(join(repoRoot, '.docstube', 'manifest', 'structure', 'compute-resources.json'))).toBeTruthy();
  });

  it('reconciles away the shard of a group the index no longer declares', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const page = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(page);
    await store.writeStructuralShard(groupShardFor('compute-resources', [page.page.id]));
    await store.writeStructuralShard(groupShardFor('networking', [page.page.id]));

    const { pruned } = await store.writeIndex(indexFor([page], { structuralGroups: ['compute-resources'] }));
    expect(pruned).toContain('structure/networking.json');
    expect(await store.listStructuralGroupIds()).toEqual(['compute-resources']);
  });

  it('refuses an index that lists a group whose shard is missing', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const page = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(page);
    // Written straight to disk so the index outruns the shard tree, the exact corruption the
    // strict read exists to catch.
    await mkdir(join(repoRoot, '.docstube', 'manifest'), { recursive: true });
    await writeFile(
      join(repoRoot, '.docstube', 'manifest', 'manifest.json'),
      JSON.stringify(indexFor([page], { structuralGroups: ['compute-resources'] })),
      'utf8'
    );
    await expect(store.readIndex()).rejects.toThrow(/structural findings shard is missing/u);
  });
});

describe('manifest store', () => {
  it('round-trips page shards and lists them', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const shard = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(shard);
    const loaded = await store.readPageShard({ locale: 'en', pageId: shard.page.id });
    expect(loaded?.page.slug).toBe(shard.page.slug);
    expect(await store.listShardPageIds('en')).toEqual([shard.page.id]);
    expect(await store.readPageShard({ locale: 'en', pageId: 'pg_00000000000000000000' })).toBeUndefined();
  });

  it('has no manifest on a first run — absence is the first-run state, not a contradiction', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    expect(await store.readIndex()).toBeUndefined();
    expect(await store.listShardPageIds('en')).toEqual([]);
  });

  it('loads cleanly when every indexed page has its shard', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const first = buildFixturePageShard(buildFixturePage());
    const second = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(first);
    await store.writePageShard(second);
    await store.writeIndex(indexFor([first, second]));

    const index = await store.readIndex();
    expect(index?.pages.map((entry) => entry.id).toSorted()).toEqual([first.page.id, second.page.id].toSorted());
  });

  it('REJECTS an index that outruns its shards, naming the pages and the remedy', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const present = buildFixturePageShard(buildFixturePage());
    const missing = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(present);
    await store.writePageShard(missing);
    await store.writeIndex(indexFor([present, missing]));
    // The shard disappears behind the index's back (an interrupted run, a bad merge, a stale
    // format left the tree half-present).
    await rm(join(shardDir('en'), `${missing.page.id}.json`));

    await expect(store.readIndex()).rejects.toMatchObject({ name: 'CoreError', code: 'state-corrupt' });
    await expect(store.readIndex()).rejects.toThrow(missing.page.id);
    await expect(store.readIndex()).rejects.toThrow(/docstube generate/);
    // The reconcilers must still be able to READ the broken state — they are the remedy.
    expect((await store.readIndex({ requireShards: false }))?.pages).toHaveLength(2);
  });

  it('tolerates a translated rendition that does not exist yet — the source shard IS the page', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const shard = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(shard);
    await store.writeIndex(indexFor([shard], { locales: ['en', 'de'] }));

    expect((await store.readIndex())?.pages).toHaveLength(1);
  });

  it('prunes orphaned shards left behind by crashed runs when the index is recorded', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const kept = buildFixturePageShard(buildFixturePage());
    const orphan = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(kept);
    await store.writePageShard(orphan);

    const { pruned } = await store.writeIndex(indexFor([kept]));

    expect(pruned).toEqual([`pages/en/${orphan.page.id}.json`]);
    expect(await store.listShardPageIds('en')).toEqual([kept.page.id]);
    expect(await store.readPageShard({ locale: 'en', pageId: kept.page.id })).toBeDefined();
  });

  it('prunes pre-JSON format orphans — a stale .yml shard beside the current .json shards', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const kept = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(kept);
    await mkdir(shardDir('en'), { recursive: true });
    // Same page id, superseded serialization: the index resolves to the .json, so the .yml is
    // referenced by nothing.
    await writeFile(join(shardDir('en'), `${kept.page.id}.yml`), 'page:\n  id: stale\n', 'utf8');
    await writeFile(join(repoRoot, '.docstube', 'manifest', 'manifest.yml'), 'pages: []\n', 'utf8');

    const { pruned } = await store.writeIndex(indexFor([kept]));

    expect(pruned).toEqual(['manifest.yml', `pages/en/${kept.page.id}.yml`]);
    expect(await store.readPageShard({ locale: 'en', pageId: kept.page.id })).toBeDefined();
    expect(await store.readIndex()).toBeDefined();
  });

  it('prunes a whole locale directory that left the index, and leaves the tree hollow-free', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const source = buildFixturePageShard(buildFixturePage());
    const rendition = { ...buildFixturePageShard(source.page), locale: 'de' };
    await store.writePageShard(source);
    await store.writePageShard(rendition);

    const { pruned } = await store.writeIndex(indexFor([source], { locales: ['en'] }));

    expect(pruned).toEqual([`pages/de/${source.page.id}.json`]);
    await expect(stat(shardDir('de'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('NEVER touches files it does not own — foreign names and anything outside the shard dirs', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const kept = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(kept);
    await mkdir(join(repoRoot, '.docstube', 'runs', 'run_00000000000000000000'), { recursive: true });
    await mkdir(join(repoRoot, '.docstube', 'cache'), { recursive: true });
    const foreign = [
      join(shardDir('en'), 'notes.md'),
      join(shardDir('en'), 'pg_not-an-id.json'),
      join(repoRoot, '.docstube', 'runs', 'run_00000000000000000000', 'journal.jsonl'),
      join(repoRoot, '.docstube', 'cache', `${kept.page.id}.json`)
    ];
    for (const path of foreign) {
      await writeFile(path, 'keep me\n', 'utf8');
    }

    // An index that keeps NOTHING: the widest prune the store can be asked to do.
    const { pruned } = await store.writeIndex(indexFor([]));

    expect(pruned).toEqual([`pages/en/${kept.page.id}.json`]);
    for (const path of foreign) {
      expect(await readFile(path, 'utf8')).toBe('keep me\n');
    }
    // A file with a foreign name is not a shard, so it never surfaces as a page id either.
    expect(await store.listShardPageIds('en')).toEqual([]);
  });

  it('leaves frozen version snapshots alone — they are immutable history, not orphans', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const shard = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(shard);
    await store.writePageShard({ ...shard, version: '1.x' });

    await store.writeIndex(indexFor([]));

    expect(await store.readPageShard({ locale: 'en', pageId: shard.page.id, version: '1.x' })).toBeDefined();
  });

  it('prunes nothing on a repeat write of the same index — idempotent reconciliation', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const shard = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(shard);
    await store.writeIndex(indexFor([shard]));

    expect((await store.writeIndex(indexFor([shard]))).pruned).toEqual([]);
  });
});

describe('run journal', () => {
  it('appends events, reads them back, and resumes the sequence', async () => {
    const journal = await createRunJournal(repoRoot, 'run_00000000000000000000');
    await journal.append({ type: 'run-started', mode: 'generate', commit: 'a'.repeat(40) });
    await journal.append({ type: 'page-status', pageId: 'pg_00000000000000000000', status: 'writing' });
    const resumed = await createRunJournal(repoRoot, 'run_00000000000000000000');
    const event = await resumed.append({ type: 'run-completed', outcome: 'passed' });
    expect(event.seq).toBe(2);

    const events = await resumed.readAll();
    expect(events).toHaveLength(3);
    const summary = summarizeRun(events);
    expect(summary.outcome).toBe('passed');
    expect(summary.pageStatus.get('pg_00000000000000000000')).toBe('writing');
  });

  it('tolerates one truncated FINAL line (crash mid-write): warns, drops it, resumes cleanly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const journal = await createRunJournal(repoRoot, 'run_00000000000000000001');
      await journal.append({ type: 'run-started', mode: 'generate', commit: 'a'.repeat(40) });
      const journalPath = join(repoRoot, '.docstube', 'runs', 'run_00000000000000000001', 'journal.jsonl');
      await appendFile(journalPath, '{"type":"page-status","pageId":"pg_0', 'utf8');

      expect(await journal.readAll()).toHaveLength(1);

      const resumed = await createRunJournal(repoRoot, 'run_00000000000000000001');
      const event = await resumed.append({ type: 'run-completed', outcome: 'passed' });
      expect(event.seq).toBe(1);
      // Resume rewrote the file without the truncated tail: a later read must not hit a stranded
      // invalid line in the middle.
      expect(await resumed.readAll()).toHaveLength(2);
      expect((await readFile(journalPath, 'utf8')).includes('page-status')).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('an invalid line in the MIDDLE stays a hard error — that is real corruption', async () => {
    const journal = await createRunJournal(repoRoot, 'run_00000000000000000002');
    await journal.append({ type: 'run-started', mode: 'generate', commit: 'a'.repeat(40) });
    const journalPath = join(repoRoot, '.docstube', 'runs', 'run_00000000000000000002', 'journal.jsonl');
    await appendFile(journalPath, 'not json at all\n', 'utf8');
    await appendFile(
      journalPath,
      `${JSON.stringify({ type: 'run-completed', outcome: 'passed', runId: 'run_00000000000000000002', seq: 2, at: new Date().toISOString() })}\n`,
      'utf8'
    );
    await expect(journal.readAll()).rejects.toThrow(/Unexpected token|not valid JSON/);
    await expect(createRunJournal(repoRoot, 'run_00000000000000000002')).rejects.toThrow(
      /Unexpected token|not valid JSON/
    );
  });
});
