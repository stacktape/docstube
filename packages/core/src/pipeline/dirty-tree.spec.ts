import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import {
  checkWorkingTreeDirty,
  dirtyTreeEndOfRunSweep,
  dirtyWorkingTreeWarning,
  docstubeOwnOutputPrefixes,
  headMovedDuringRunWarning,
  resolveCommit,
  resolveSourceRevision
} from './generate.ts';

const execFileAsync = promisify(execFile);

// Dirty-tree honesty, end-of-run recheck (impl-07 finding 7 interim, scoped by impl-10 finding 4):
// a tree that was clean at run start but mutated mid-run must still end with the dirtyWorkingTree
// marker on every shard the run persisted, plus a journal warning — but docstube's OWN declared
// outputs (the committed manifest under .docstube/ and the generated site under config.outDir)
// are the run's expected writes and must NEVER self-mark a successful run dirty. Only the
// machine-local .docstube paths are gitignored here, mirroring real projects: the committed
// manifest IS visible to porcelain, so the production exclusion — not the .gitignore — is what
// keeps a normal run clean. Full immutable-snapshot reads are reconciler work.

let repoRoot: string;
// The run-start HEAD every sweep below is given. HEAD STABILITY (wave 2b close): the sweep now
// re-reads HEAD, so the commit a run reports must be the repository's real one — a fixture commit
// would (correctly) read as "HEAD moved mid-run".
let headCommit: string;

const OWN_OUTPUTS = docstubeOwnOutputPrefixes({ outDir: 'docs-site' });

const git = (...args: string[]) => execFileAsync('git', args, { cwd: repoRoot });

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-dirty-tree-'));
  await git('init');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(repoRoot, 'file.txt'), 'committed\n');
  // Only the MACHINE-LOCAL docstube state is gitignored (mirroring real projects) — the committed
  // manifest and the generated site stay visible to porcelain on purpose.
  await writeFile(join(repoRoot, '.gitignore'), '.docstube/db.sqlite*\n.docstube/cache/\n.docstube/runs/\n');
  await git('add', '.');
  await git('commit', '-m', 'init');
  headCommit = await resolveCommit(repoRoot);
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('working-tree dirtiness', () => {
  it('reports clean after a commit, dirty after a mutation (both probes: start + end)', async () => {
    expect(await checkWorkingTreeDirty(repoRoot, OWN_OUTPUTS)).toBe(false);
    const start = await resolveSourceRevision(repoRoot, OWN_OUTPUTS);
    expect(start.dirtyWorkingTree).toBe(false);

    await writeFile(join(repoRoot, 'file.txt'), 'mutated mid-run\n');
    expect(await checkWorkingTreeDirty(repoRoot, OWN_OUTPUTS)).toBe(true);

    await git('checkout', '--', 'file.txt');
    expect(await checkWorkingTreeDirty(repoRoot, OWN_OUTPUTS)).toBe(false);
  });

  it("IGNORES docstube's own declared outputs — a normal successful run never self-marks dirty (impl-10)", async () => {
    // Simulate what every meaningful run writes: the committed manifest shard and site output.
    const store = createManifestStore(repoRoot, 'latest');
    const page = buildFixturePage();
    const ledger = buildFixtureClaimLedger(page);
    const shard = { ...buildFixturePageShard(page), ledger, provenance: buildFixtureProvenanceV2(ledger) };
    await store.writePageShard(shard);
    await mkdir(join(repoRoot, 'docs-site', 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'docs-site', 'src', 'index.mdx'), '# generated\n');

    // The plain probe DOES see the output writes (the committed manifest is not gitignored) —
    // proving the production exclusion, not the test setup, is what keeps the run clean.
    expect(await checkWorkingTreeDirty(repoRoot)).toBe(true);
    expect(await checkWorkingTreeDirty(repoRoot, OWN_OUTPUTS)).toBe(false);
    expect((await resolveSourceRevision(repoRoot, OWN_OUTPUTS)).dirtyWorkingTree).toBe(false);

    // The end-of-run sweep is a no-op on own outputs alone: no marker, no journal warning.
    const journal = await createRunJournal(repoRoot, mintId(idPrefixes.run));
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store,
      journal,
      commit: headCommit,
      dirtyAtStart: false,
      ownOutputPrefixes: OWN_OUTPUTS,
      persistedShards: [{ locale: shard.locale, pageId: page.id }]
    });
    const untouched = await store.readPageShard({ locale: shard.locale, pageId: page.id });
    expect(untouched?.provenance?.lineage.dirtyWorkingTree).toBeUndefined();

    // Real SOURCE dirt is still detected even while the own-output writes are present.
    await writeFile(join(repoRoot, 'file.txt'), 'real source dirt\n');
    expect(await checkWorkingTreeDirty(repoRoot, OWN_OUTPUTS)).toBe(true);
    await git('checkout', '--', 'file.txt');
  });

  it('marks persisted shards + journals a warning when the tree became dirty DURING the run', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const page = buildFixturePage();
    const ledger = buildFixtureClaimLedger(page);
    const shard = { ...buildFixturePageShard(page), ledger, provenance: buildFixtureProvenanceV2(ledger) };
    await store.writePageShard(shard);
    expect(shard.provenance.lineage.dirtyWorkingTree).toBeUndefined();

    const journal = await createRunJournal(repoRoot, mintId(idPrefixes.run));
    // Simulate a mid-run SOURCE mutation: clean at start, dirty at the end-of-run recheck —
    // detected even though the run's own manifest/site writes are also present.
    await writeFile(join(repoRoot, 'file.txt'), 'mutated mid-run\n');
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store,
      journal,
      commit: headCommit,
      dirtyAtStart: false,
      ownOutputPrefixes: OWN_OUTPUTS,
      persistedShards: [{ locale: shard.locale, pageId: page.id }]
    });

    const updated = await store.readPageShard({ locale: shard.locale, pageId: page.id });
    expect(updated?.provenance?.lineage.dirtyWorkingTree).toBe(true);
    const journalRaw = await readFile(join(repoRoot, '.docstube', 'runs', journal.runId, 'journal.jsonl'), 'utf8');
    expect(journalRaw).toContain('became dirty DURING the run');
    // The warning states the READER-FACING consequence (PRODUCT §1.2, spine finding): those pages
    // keep their true counts but can never render the complete state.
    expect(journalRaw).toContain('checked against uncommitted changes');
    expect(journalRaw).toContain('never the complete state');
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
      commit: headCommit,
      dirtyAtStart: false,
      ownOutputPrefixes: OWN_OUTPUTS,
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
      commit: headCommit,
      dirtyAtStart: true,
      ownOutputPrefixes: OWN_OUTPUTS,
      persistedShards: [{ locale: shard.locale, pageId: page.id }]
    });
    const stillUntouched = await store.readPageShard({ locale: shard.locale, pageId: page.id });
    expect(stillUntouched?.provenance?.lineage.dirtyWorkingTree).toBeUndefined();
    // The sweep appended NO events at all (a never-appended journal file does not even exist).
    const journalRaw = await readFile(
      join(repoRoot, '.docstube', 'runs', journal.runId, 'journal.jsonl'),
      'utf8'
    ).catch(() => '');
    expect(journalRaw).not.toContain('became dirty DURING the run');
    await git('checkout', '--', 'file.txt');
  });

  it('marks shards whose OBSERVED READS name a file git does not version, on a clean tree', async () => {
    // The run-start probe covers what the codemap PARSED; the writer can additionally read files
    // through its tools. An untracked or ignored file read that way is bytes no commit contains,
    // and porcelain says nothing about it — so the end-of-run sweep resolves trackedness over the
    // observed reads the persisted shards recorded.
    const store = createManifestStore(repoRoot, 'latest');
    const page = buildFixturePage();
    const ledger = buildFixtureClaimLedger(page);
    const provenance = buildFixtureProvenanceV2(ledger);
    const shard = {
      ...buildFixturePageShard(page),
      ledger,
      provenance: {
        ...provenance,
        lineage: { ...provenance.lineage, observedReads: [{ file: 'scratch/notes.ts', contentHash: 'a'.repeat(64) }] }
      }
    };
    await store.writePageShard(shard);
    expect(await checkWorkingTreeDirty(repoRoot, OWN_OUTPUTS)).toBe(false);

    const journal = await createRunJournal(repoRoot, mintId(idPrefixes.run));
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store,
      journal,
      commit: headCommit,
      dirtyAtStart: false,
      ownOutputPrefixes: OWN_OUTPUTS,
      persistedShards: [{ locale: shard.locale, pageId: page.id }]
    });

    const updated = await store.readPageShard({ locale: shard.locale, pageId: page.id });
    expect(updated?.provenance?.lineage.dirtyWorkingTree).toBe(true);
    const journalRaw = await readFile(join(repoRoot, '.docstube', 'runs', journal.runId, 'journal.jsonl'), 'utf8');
    expect(journalRaw).toContain('git does not version');
    expect(journalRaw).toContain('scratch/notes.ts');
  });

  it('marks the run when HEAD MOVED mid-run, even though the tree stayed perfectly clean', async () => {
    // THE CLEAN-MID-RUN-COMMIT CLASS (wave 2b close): a commit landing while the run works leaves
    // `git status` clean, so the porcelain-only sweep saw nothing — and the evidence this run
    // recorded stayed labeled with a revision that need not contain the bytes it checked. HEAD is
    // recorded at start and re-read at the end; any movement marks every persisted shard.
    const store = createManifestStore(repoRoot, 'latest');
    const page = buildFixturePage();
    const ledger = buildFixtureClaimLedger(page);
    const shard = { ...buildFixturePageShard(page), ledger, provenance: buildFixtureProvenanceV2(ledger) };
    await store.writePageShard(shard);

    // A mid-run commit: the tree is CLEAN afterwards, only the revision changed.
    await writeFile(join(repoRoot, 'landed-mid-run.txt'), 'a colleague pushed\n');
    await git('add', 'landed-mid-run.txt');
    await git('commit', '-m', 'landed mid-run');
    const movedHead = await resolveCommit(repoRoot);
    expect(movedHead).not.toBe(headCommit);
    expect(await checkWorkingTreeDirty(repoRoot, OWN_OUTPUTS)).toBe(false);

    const journal = await createRunJournal(repoRoot, mintId(idPrefixes.run));
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store,
      journal,
      commit: headCommit,
      dirtyAtStart: false,
      ownOutputPrefixes: OWN_OUTPUTS,
      persistedShards: [{ locale: shard.locale, pageId: page.id }]
    });

    // The run is marked, so no page persisted this run can ever render the complete state.
    const updated = await store.readPageShard({ locale: shard.locale, pageId: page.id });
    expect(updated?.provenance?.lineage.dirtyWorkingTree).toBe(true);
    const journalRaw = await readFile(join(repoRoot, '.docstube', 'runs', journal.runId, 'journal.jsonl'), 'utf8');
    expect(journalRaw).toContain('HEAD MOVED during the run');
    // Both revisions are named, so the mismatch is diagnosable without guessing.
    expect(journalRaw).toContain(headCommit.slice(0, 12));
    expect(journalRaw).toContain(movedHead.slice(0, 12));
    expect(journalRaw).toContain('never the complete state');

    headCommit = movedHead;
  });

  it('names BOTH revisions in the HEAD-moved warning', () => {
    const warning = headMovedDuringRunWarning('a'.repeat(40), 'b'.repeat(40));
    expect(warning.severity).toBe('warning');
    expect(warning.message).toContain('a'.repeat(12));
    expect(warning.message).toContain('b'.repeat(12));
    expect(warning.message).toContain('never the complete state');
  });

  it('derives the own-output prefix set from config outDir plus the .docstube tree', () => {
    expect(docstubeOwnOutputPrefixes({ outDir: 'docs-site' })).toEqual(['docs-site', '.docstube']);
    expect(docstubeOwnOutputPrefixes({ outDir: './docs/site/' })).toEqual(['docs/site', '.docstube']);
    // A prefix never swallows sibling paths that merely share the leading characters.
    expect(docstubeOwnOutputPrefixes({ outDir: 'docs' })).toEqual(['docs', '.docstube']);
  });
});

// The badge rule is a PRODUCT rule, so the run-start warning says it in words too: a dirty run
// still produces genuine, content-hash-bound checks — what it cannot produce is the complete state.
describe('dirtyWorkingTreeWarning', () => {
  it('names the commit AND the reader-facing consequence', () => {
    const warning = dirtyWorkingTreeWarning('a'.repeat(40));
    expect(warning.severity).toBe('warning');
    expect(warning.message).toContain('checked against uncommitted changes');
    expect(warning.message).toContain('never the complete state');
  });

  it('names the UNVERSIONED sources as the cause when that is what made the run dirty', () => {
    const warning = dirtyWorkingTreeWarning('b'.repeat(40), ['dist-dogfood/a.ts', 'dist-dogfood/b.ts']);
    expect(warning.message).toContain('read 2 source files that git does not version');
    expect(warning.message).toContain('dist-dogfood/a.ts');
    expect(warning.message).toContain('never reports ignored files');
    // The reader-facing consequence is identical whatever made the run dirty.
    expect(warning.message).toContain('never the complete state');
  });
});
