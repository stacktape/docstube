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
  probeWorkingTree,
  resolveCommit,
  resolveSourceRevision
} from './generate.ts';
import type { WorkingTreeState } from './generate.ts';

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
      treeStateAtStart: 'clean',
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
      treeStateAtStart: 'clean',
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
      treeStateAtStart: 'clean',
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
      treeStateAtStart: 'dirty',
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
      treeStateAtStart: 'clean',
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
      treeStateAtStart: 'clean',
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
    // A clean→clean run is the ONE case that may say the commit left the tree clean.
    expect(journalRaw).toContain('and left the tree clean');

    headCommit = movedHead;
  });

  it('does not claim a clean-start run "left the tree clean" when it ended DIRTY', async () => {
    // THE CONTRADICTION (wave 2b close — the run-diagnostics finding, third pass): the sweep knows
    // both the start tri-state and the end state, but the warning was given only a boolean — so a
    // run that started clean and ended dirty journaled the end-of-run dirt warning and, in the very
    // same batch, a HEAD-moved warning claiming the mid-run commit "left the tree clean".
    const store = createManifestStore(repoRoot, 'latest');
    const page = buildFixturePage();
    const ledger = buildFixtureClaimLedger(page);
    const shard = { ...buildFixturePageShard(page), ledger, provenance: buildFixtureProvenanceV2(ledger) };
    await store.writePageShard(shard);

    await writeFile(join(repoRoot, 'landed-then-dirtied.txt'), 'a colleague pushed\n');
    await git('add', 'landed-then-dirtied.txt');
    await git('commit', '-m', 'landed then dirtied');
    const movedHead = await resolveCommit(repoRoot);
    // …and the tree is left DIRTY afterwards.
    await writeFile(join(repoRoot, 'file.txt'), 'dirtied after the mid-run commit\n');
    expect(await probeWorkingTree(repoRoot, OWN_OUTPUTS)).toBe('dirty');

    const journal = await createRunJournal(repoRoot, mintId(idPrefixes.run));
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store,
      journal,
      commit: headCommit,
      dirtyAtStart: false,
      treeStateAtStart: 'clean',
      ownOutputPrefixes: OWN_OUTPUTS,
      persistedShards: [{ locale: shard.locale, pageId: page.id }]
    });

    const journalRaw = await readFile(join(repoRoot, '.docstube', 'runs', journal.runId, 'journal.jsonl'), 'utf8');
    expect(journalRaw).toContain('HEAD MOVED during the run');
    expect(journalRaw).toContain('became dirty DURING the run');
    expect(journalRaw).toContain('left the tree DIRTY');
    expect(journalRaw).not.toContain('and left the tree clean');

    await git('checkout', '--', 'file.txt');
    headCommit = movedHead;
  });

  it('reports HEAD movement even on a run that was ALREADY DIRTY at start (diagnostics, not trust)', async () => {
    // ALWAYS RE-READ HEAD (wave 2b close final — the run-diagnostics finding): the sweep used to
    // return immediately when the run started dirty, so a commit landing mid-run produced NO
    // revision-pair warning at all. The shards need no further marking (they were marked at
    // assembly time, so trust is unaffected) — but the operator still has to be able to see WHICH
    // two revisions the run straddled, which is exactly when a dirty tree makes it hardest to guess.
    const store = createManifestStore(repoRoot, 'latest');
    const page = buildFixturePage();
    const ledger = buildFixtureClaimLedger(page);
    const provenance = buildFixtureProvenanceV2(ledger);
    const shard = {
      ...buildFixturePageShard(page),
      ledger,
      provenance: { ...provenance, lineage: { ...provenance.lineage, dirtyWorkingTree: true } }
    };
    await store.writePageShard(shard);

    // Dirty at start AND a commit lands mid-run.
    await writeFile(join(repoRoot, 'file.txt'), 'dirty from the very start\n');
    await writeFile(join(repoRoot, 'landed-during-a-dirty-run.txt'), 'a colleague pushed again\n');
    await git('add', 'landed-during-a-dirty-run.txt');
    await git('commit', '-m', 'landed during a dirty run');
    const movedHead = await resolveCommit(repoRoot);
    expect(movedHead).not.toBe(headCommit);

    const journal = await createRunJournal(repoRoot, mintId(idPrefixes.run));
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store,
      journal,
      commit: headCommit,
      dirtyAtStart: true,
      treeStateAtStart: 'dirty',
      ownOutputPrefixes: OWN_OUTPUTS,
      persistedShards: [{ locale: shard.locale, pageId: page.id }]
    });

    const journalRaw = await readFile(join(repoRoot, '.docstube', 'runs', journal.runId, 'journal.jsonl'), 'utf8');
    expect(journalRaw).toContain('HEAD MOVED during the run');
    expect(journalRaw).toContain(headCommit.slice(0, 12));
    expect(journalRaw).toContain(movedHead.slice(0, 12));
    // …and it says what actually happened on THIS path: the tree was already dirty, so the
    // clean-tree sentence must not be reused (wave 2b close final, run-diagnostics finding).
    expect(journalRaw).toContain('ALREADY dirty when the run started');
    expect(journalRaw).not.toContain('left the tree clean');
    // The run was already dirty, so the porcelain/unversioned causes are NOT re-journaled — run
    // start said them once already.
    expect(journalRaw).not.toContain('became dirty DURING the run');

    await git('checkout', '--', 'file.txt');
    headCommit = movedHead;
  });

  // BOTH ENDS OF THE RUN, NOT A BOOLEAN (wave 2b close — the run-diagnostics finding, third pass):
  // the warning used to collapse the start tri-state and the end state into one `startedDirty`
  // flag, which made two sentences contradict what actually happened — a clean-start run whose
  // tree ended dirty still claimed the commit "left the tree clean", and an unknown start (where
  // porcelain NEVER RAN) was relabeled "ALREADY dirty" as soon as HEAD became readable. Each
  // combination now gets its own wording, and none of them carries another combination's phrase.
  const START = 'a'.repeat(40);
  const END = 'b'.repeat(40);
  const headWarning = (startState: WorkingTreeState, endState?: WorkingTreeState, alreadyMarked?: boolean) =>
    headMovedDuringRunWarning({
      startCommit: START,
      endCommit: END,
      startState,
      ...(endState === undefined ? {} : { endState }),
      ...(alreadyMarked === undefined ? {} : { alreadyMarked })
    }).message;

  it('names BOTH revisions and the reader-facing consequence in every combination', () => {
    const combinations: Array<[WorkingTreeState, WorkingTreeState | undefined]> = [
      ['clean', 'clean'],
      ['clean', 'dirty'],
      ['clean', 'unknown'],
      ['dirty', 'clean'],
      ['dirty', 'dirty'],
      ['dirty', 'unknown'],
      ['dirty', undefined],
      ['unknown', 'clean'],
      ['unknown', 'dirty'],
      ['unknown', 'unknown'],
      ['unknown', undefined]
    ];
    for (const [startState, endState] of combinations) {
      const message = headWarning(startState, endState);
      expect(message).toContain('HEAD MOVED during the run');
      expect(message).toContain(START.slice(0, 12));
      expect(message).toContain(END.slice(0, 12));
      expect(message).toContain('never the complete state');
    }
    expect(headMovedDuringRunWarning({ startCommit: START, endCommit: END, startState: 'clean' }).severity).toBe(
      'warning'
    );
  });

  it('says "left the tree clean" ONLY for a run that started clean and ended clean', () => {
    // On a clean→clean run that sentence is the POINT — it is why porcelain saw nothing.
    expect(headWarning('clean', 'clean')).toContain('and left the tree clean');
    expect(headWarning('clean', 'clean')).toContain('now carries dirtyWorkingTree: true');

    // Every other combination must not reuse it.
    for (const message of [
      headWarning('clean', 'dirty'),
      headWarning('clean', 'unknown'),
      headWarning('dirty', 'clean'),
      headWarning('dirty', 'dirty'),
      headWarning('unknown', 'clean'),
      headWarning('unknown', undefined)
    ]) {
      expect(message).not.toContain('and left the tree clean');
    }
  });

  it('reports a clean-start run whose tree ended DIRTY or UNKNOWN as exactly that', () => {
    const endedDirty = headWarning('clean', 'dirty');
    expect(endedDirty).toContain('left the tree DIRTY');
    expect(endedDirty).toContain('reported it clean at run start');
    expect(endedDirty).not.toContain('ALREADY');
    expect(endedDirty).toContain('now carries dirtyWorkingTree: true');

    const endedUnknown = headWarning('clean', 'unknown');
    expect(endedUnknown).toContain('left the working tree state UNKNOWN');
    expect(endedUnknown).toContain('no HEAD, or `git status` could not be read');
    expect(endedUnknown).toContain('reported it clean at run start');
    expect(endedUnknown).not.toContain('ALREADY');
    expect(endedUnknown).not.toContain('left the tree DIRTY');
  });

  it('says ALREADY DIRTY only for a dirty start, whatever the tree did afterwards', () => {
    for (const endState of ['clean', 'dirty', 'unknown', undefined] as const) {
      const message = headWarning('dirty', endState);
      expect(message).toContain('ALREADY dirty when the run started');
      expect(message).not.toContain('ALREADY UNKNOWN');
      // Those shards were marked at assembly time, not by this sweep.
      expect(message).toContain('already carries dirtyWorkingTree: true');
      expect(message).not.toContain('now carries dirtyWorkingTree: true');
    }
  });

  it('never relabels an UNKNOWN start as dirty, even once HEAD becomes readable again', () => {
    for (const endState of ['clean', 'dirty', 'unknown', undefined] as const) {
      const message = headWarning('unknown', endState);
      expect(message).toContain('ALREADY UNKNOWN at run start');
      expect(message).toContain('no HEAD, or `git status` could not be read');
      // Porcelain never ran, so the warning must claim no porcelain result in either direction.
      expect(message).not.toContain('ALREADY dirty');
      expect(message).not.toContain('reported it clean at run start');
      expect(message).toContain('already carries dirtyWorkingTree: true');
    }
  });

  it('claims nothing about the end state when the sweep deliberately did not re-probe it', () => {
    // The already-marked path re-reads HEAD only; a clean-reporting start there means the run was
    // marked by unversioned reads, so the tense is "already" and no end state is asserted.
    const unprobed = headWarning('clean', undefined, true);
    expect(unprobed).toContain('reported clean at run start');
    expect(unprobed).not.toContain('at the end');
    expect(unprobed).not.toContain('and left the tree');
    expect(unprobed).toContain('already carries dirtyWorkingTree: true');
  });

  it('probes a TRI-STATE: clean, observed-dirty, and unknown when git cannot be believed', async () => {
    // The boolean the trust decision uses ("must this run be marked?") answers the same for dirty
    // and unknown, which is exactly why the OBSERVATION has to be carried separately.
    expect(await probeWorkingTree(repoRoot, OWN_OUTPUTS)).toBe('clean');
    expect(await checkWorkingTreeDirty(repoRoot, OWN_OUTPUTS)).toBe(false);

    await writeFile(join(repoRoot, 'file.txt'), 'observed dirt\n');
    expect(await probeWorkingTree(repoRoot, OWN_OUTPUTS)).toBe('dirty');
    await git('checkout', '--', 'file.txt');

    // A directory git knows nothing about: `git status` fails, so nothing was observed at all.
    const notARepo = await mkdtemp(join(tmpdir(), 'docstube-not-a-repo-'));
    try {
      expect(await probeWorkingTree(notARepo, OWN_OUTPUTS)).toBe('unknown');
      // Unknown still marks the run — the trust behavior is unchanged.
      expect(await checkWorkingTreeDirty(notARepo, OWN_OUTPUTS)).toBe(true);
    } finally {
      await rm(notARepo, { recursive: true, force: true });
    }
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
    const warning = dirtyWorkingTreeWarning('a'.repeat(40), [], 'dirty');
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

  // THE WORDING MATCHES WHAT WAS OBSERVED (wave 2b close final — run-diagnostics finding): the
  // sampled warning claimed the tree "looked clean" even for an UNTRACKED file, which porcelain
  // reports loudly — a line that reads as a broken probe to anyone who just ran `git status`.
  it('says the tree looked CLEAN only when it did — an ignored file porcelain cannot see', () => {
    const warning = dirtyWorkingTreeWarning('c'.repeat(40), ['dist-dogfood/a.ts'], 'clean');
    expect(warning.message).toContain('never reports ignored files, so the tree looked clean');
    expect(warning.message).toContain('dist-dogfood/a.ts');
  });

  it('says the tree was DIRTY when porcelain said so, and still names the paths', () => {
    const warning = dirtyWorkingTreeWarning('c'.repeat(40), ['src/extra.ts'], 'dirty');
    expect(warning.message).toContain('reported the working tree dirty as well');
    expect(warning.message).not.toContain('looked clean');
    // The actionable detail survives in BOTH cases — the sample is the reason the warning exists.
    expect(warning.message).toContain('read 1 source file that git does not version');
    expect(warning.message).toContain('src/extra.ts');
  });

  // UNKNOWN IS NOT PORCELAIN-DIRTY (wave 2b close final — run-diagnostics finding): a missing HEAD
  // or an unreadable `git status` used to arrive as the same boolean an observed dirty tree does,
  // so the warning claimed porcelain "reported the working tree dirty" when porcelain never ran —
  // sending an operator to debug a diff that does not exist. The trust behavior is unchanged (an
  // unknown state still marks the run); only the sentence is now honest.
  it('gives clean, observed-dirty and UNKNOWN their own wording — with the path samples in all three', () => {
    const clean = dirtyWorkingTreeWarning('d'.repeat(40), ['dist-dogfood/a.ts'], 'clean');
    expect(clean.message).toContain('never reports ignored files, so the tree looked clean');
    expect(clean.message).not.toContain('UNKNOWN');
    expect(clean.message).toContain('dist-dogfood/a.ts');

    const dirty = dirtyWorkingTreeWarning('d'.repeat(40), ['src/extra.ts'], 'dirty');
    expect(dirty.message).toContain('`git status` reported the working tree dirty as well');
    expect(dirty.message).not.toContain('UNKNOWN');
    expect(dirty.message).toContain('src/extra.ts');

    const unknown = dirtyWorkingTreeWarning('d'.repeat(40), ['src/extra.ts'], 'unknown');
    expect(unknown.message).toContain('the working tree state is UNKNOWN');
    expect(unknown.message).toContain('no HEAD, or `git status` could not be read');
    // It must NOT claim porcelain said anything, in either direction.
    expect(unknown.message).not.toContain('reported the working tree dirty');
    expect(unknown.message).not.toContain('looked clean');
    expect(unknown.message).toContain('src/extra.ts');
  });

  it('drops the "(or has no HEAD)" hedge from the sampleless warning and states UNKNOWN outright', () => {
    // The generic run-start line is emitted for BOTH causes, so it too must say which one it saw.
    const observed = dirtyWorkingTreeWarning('e'.repeat(40), [], 'dirty');
    expect(observed.message).toContain('the working tree is dirty');
    expect(observed.message).not.toContain('has no HEAD');

    const unknown = dirtyWorkingTreeWarning('e'.repeat(40), [], 'unknown');
    expect(unknown.message).toContain('the working tree state is UNKNOWN');
    expect(unknown.message).not.toContain('the working tree is dirty:');
    expect(unknown.message).toContain('never the complete state');
  });
});
