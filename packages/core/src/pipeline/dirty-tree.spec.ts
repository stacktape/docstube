import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildFixtureClaimLedger,
  buildFixturePage,
  buildFixturePageShard,
  buildFixtureProvenanceV2,
  idPrefixes,
  mintId
} from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { createRunJournal } from '../state/run-journal.ts';
import { checkWorkingTreeDirty, dirtyTreeEndOfRunSweep, resolveSourceRevision } from './generate.ts';

const execFileAsync = promisify(execFile);

// Dirty-tree honesty, end-of-run recheck (impl-07 finding 7 interim): a tree that was clean at
// run start but mutated mid-run must still end with the dirtyWorkingTree marker on every shard
// the run persisted, plus a journal warning. Full immutable-snapshot reads are reconciler work.

let repoRoot: string;

const git = (...args: string[]) => execFileAsync('git', args, { cwd: repoRoot });

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-dirty-tree-'));
  await git('init');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(repoRoot, 'file.txt'), 'committed\n');
  // Machine-local docstube state is gitignored in real projects; mirror that so store/journal
  // writes do not read as tree dirtiness.
  await writeFile(join(repoRoot, '.gitignore'), '.docstube/\n');
  await git('add', '.');
  await git('commit', '-m', 'init');
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('working-tree dirtiness', () => {
  it('reports clean after a commit, dirty after a mutation (both probes: start + end)', async () => {
    expect(await checkWorkingTreeDirty(repoRoot)).toBe(false);
    const start = await resolveSourceRevision(repoRoot);
    expect(start.dirtyWorkingTree).toBe(false);

    await writeFile(join(repoRoot, 'file.txt'), 'mutated mid-run\n');
    expect(await checkWorkingTreeDirty(repoRoot)).toBe(true);

    await git('checkout', '--', 'file.txt');
    expect(await checkWorkingTreeDirty(repoRoot)).toBe(false);
  });

  it('marks persisted shards + journals a warning when the tree became dirty DURING the run', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const page = buildFixturePage();
    const ledger = buildFixtureClaimLedger(page);
    const shard = { ...buildFixturePageShard(page), ledger, provenance: buildFixtureProvenanceV2(ledger) };
    await store.writePageShard(shard);
    expect(shard.provenance.lineage.dirtyWorkingTree).toBeUndefined();

    const journal = await createRunJournal(repoRoot, mintId(idPrefixes.run));
    // Simulate a mid-run mutation: clean at start, dirty at the end-of-run recheck.
    await writeFile(join(repoRoot, 'file.txt'), 'mutated mid-run\n');
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store,
      journal,
      commit: shard.sourceCommit,
      dirtyAtStart: false,
      persistedShards: [{ locale: shard.locale, pageId: page.id }]
    });

    const updated = await store.readPageShard({ locale: shard.locale, pageId: page.id });
    expect(updated?.provenance?.lineage.dirtyWorkingTree).toBe(true);
    const journalRaw = await readFile(join(repoRoot, '.docstube', 'runs', journal.runId, 'journal.jsonl'), 'utf8');
    expect(journalRaw).toContain('became dirty DURING the run');
    await git('checkout', '--', 'file.txt');
  });

  it('is a no-op when the tree stays clean, and does not double-journal when dirty at start', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const page = buildFixturePage();
    const ledger = buildFixtureClaimLedger(page);
    const shard = { ...buildFixturePageShard(page), ledger, provenance: buildFixtureProvenanceV2(ledger) };
    await store.writePageShard(shard);

    const journal = await createRunJournal(repoRoot, mintId(idPrefixes.run));
    // Clean tree at both probes: nothing marked, nothing journaled.
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store,
      journal,
      commit: shard.sourceCommit,
      dirtyAtStart: false,
      persistedShards: [{ locale: shard.locale, pageId: page.id }]
    });
    const untouched = await store.readPageShard({ locale: shard.locale, pageId: page.id });
    expect(untouched?.provenance?.lineage.dirtyWorkingTree).toBeUndefined();

    // Dirty at start: the run already journaled the warning and marked lineage at assembly time —
    // the end sweep must not re-journal.
    await writeFile(join(repoRoot, 'file.txt'), 'still dirty\n');
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store,
      journal,
      commit: shard.sourceCommit,
      dirtyAtStart: true,
      persistedShards: [{ locale: shard.locale, pageId: page.id }]
    });
    const stillUntouched = await store.readPageShard({ locale: shard.locale, pageId: page.id });
    expect(stillUntouched?.provenance?.lineage.dirtyWorkingTree).toBeUndefined();
    // The sweep appended NO events at all (a never-appended journal file does not even exist).
    const journalRaw = await readFile(join(repoRoot, '.docstube', 'runs', journal.runId, 'journal.jsonl'), 'utf8').catch(
      () => ''
    );
    expect(journalRaw).not.toContain('became dirty DURING the run');
    await git('checkout', '--', 'file.txt');
  });
});
