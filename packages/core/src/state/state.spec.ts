import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('prunes orphaned shards left behind by crashed runs, keeping indexed pages', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const kept = buildFixturePageShard(buildFixturePage());
    const orphan = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(kept);
    await store.writePageShard(orphan);

    const pruned = await store.pruneOrphanShards({ keepPageIds: [kept.page.id], locales: ['en', 'de'] });

    expect(pruned).toEqual([`en/${orphan.page.id}`]);
    expect(await store.listShardPageIds('en')).toEqual([kept.page.id]);
    expect(await store.readPageShard({ locale: 'en', pageId: kept.page.id })).toBeDefined();
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
});
