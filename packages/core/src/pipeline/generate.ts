import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PageArtifact } from '@docstube/plugin-sdk';
import type {
  Finding,
  Flag,
  FlagKind,
  IaNodeV2,
  IaPageNodeV2,
  ManifestIndex,
  PageShard,
  ProvenanceV2,
  StructuralGroupShard
} from '@docstube/contracts';
import { convertIaToV2, hashValue, idPrefixes, mintId, walkIaV2Nodes } from '@docstube/contracts';
import { buildCodemap, buildFingerprintSnapshot } from '@docstube/codemap';
import { loadConfigFamily } from '../config/config-io.ts';
import { docstubeVersion } from '../version.ts';
import { createPluginHost } from '../plugins/plugin-host.ts';
import { loadConfiguredPlugins, registerBuiltinPlugins } from '../plugins/load-plugins.ts';
import { createManifestStore } from '../state/manifest-store.ts';
import type { ManifestStore } from '../state/manifest-store.ts';
import { createRunJournal, journalRunFailure } from '../state/run-journal.ts';
import type { RunJournal } from '../state/run-journal.ts';
import { errorFindings, runVerifiers } from './verify-page.ts';
import { loadContextFiles } from './context-files.ts';
import { openKnowledgeForRun } from '../knowledge/knowledge-lifecycle.ts';
import { contentRelativePath, generatePage } from './page-runner.ts';
import type { PageOutcome, PageRunContext, TaskRunner } from './page-runner.ts';
import { translateArtifact } from './translate-page.ts';
import type { TranslationOutcome } from './translate-page.ts';
import { createRunCostTracker, freezeReason } from './run-cost.ts';
import type { RoleSpend } from './run-cost.ts';
import { compareLedgerSnapshots, readLedgerSnapshot, resolveDeterministicGate } from './publication-decision.ts';
import type { PublicationDecisionInputs } from './publication-decision.ts';
import {
  finishInterruptedPublish,
  interruptedPublishFinding,
  openPublishStaging,
  planFingerprint
} from './publish-staging.ts';
import type { SitePublisher } from './publish-staging.ts';
import { resolveRoleRouting } from './agent-role-routing.ts';
import { runStructurePass, structuralSummaryLine } from '../structure/structure-pass.ts';
import type { StructurePassResult } from '../structure/structure-pass.ts';
import { createStructuralAssessmentCache } from '../structure/assessment-cache.ts';
import { createRiskCriticCache } from './risk-critic-cache.ts';
import type { ToolDescriptor } from '@docstube/contracts';

const execFileAsync = promisify(execFile);

// The generate pipeline (PRODUCT §3.5): codemap → per-page (context → write ⇄ review∥verify →
// gate) → assemble. Pages stream out as they land ("the waiting room is the review room"); every
// step is journaled; agent work goes through the injected TaskRunner so core stays
// transport-agnostic. The per-page loop lives in page-runner.ts (shared with maintain/refresh).

export type { PageOutcome, TaskRunner } from './page-runner.ts';
export { unwrapMdxFence, contentRelativePath } from './page-runner.ts';

export type GenerateOptions = {
  repoRoot: string;
  runTask: TaskRunner;
  toolDescriptors: ToolDescriptor[];
  runId?: string | undefined;
  maxAttemptsPerPage?: number | undefined;
  // CI mode (PRODUCT §3.3): the run additionally computes the fail-closed PublicationDecision
  // inputs — plan reconciliation, deterministic gate, and the base-vs-candidate ledger comparison
  // against the committed manifest the run started from.
  ci?: boolean | undefined;
  // THE SITE EMISSION STEP, injected (ARCHITECTURE §2: core must not depend on @docstube/theme).
  // It runs INSIDE the staged-atomic publish — routes, twins, shards and the index all land in one
  // ordered step, or none of them do. A run without a publisher still publishes content, shards and
  // the index; it simply renders no routes (the shape core's own tests use).
  publishSite?: SitePublisher | undefined;
};

export type GenerateSummary = {
  runId: string;
  outcome: 'passed' | 'flagged' | 'frozen' | 'failed';
  pages: PageOutcome[];
  translations: TranslationOutcome[];
  siteFindings: Finding[];
  warnings: string[];
  // Total task cost reported this run; present whenever any task carried a costUsd.
  spentUsd?: number;
  // Conservative token-derived spend for tasks that carried no costUsd; present when any task's
  // spend had to be estimated. Display totals as "(partly estimated)" when set.
  estimatedUsd?: number;
  // Spend attributed to the routing role that incurred it (agents.roles) — the input to "where did
  // the money go?", and to deciding which role is worth moving to a cheaper model.
  spendByRole: RoleSpend[];
  // Kinds of the open flags raised this run — telemetry input (coarse failure modes).
  openFlagKinds: FlagKind[];
  // TRUE only when the whole plan completed and the staged work was published (pipeline-v2
  // decision 3). False means the published tree is byte-identical to what it was before the run:
  // a freeze, or a plan that produced nothing. A crashed run never reaches this summary at all.
  published: boolean;
  // Pages this run reused verbatim from a previous frozen run's staged work — nothing re-billed.
  resumedPages: number;
  // Latest subscription plan usage (0-100) reported by the transport this run, when available.
  planUsedPercent?: number;
  // Structural quality (PRODUCT §4.1). Counts only — NONBLOCKING work items that never touch the
  // run outcome, the flag queue, or the publication decision. Absent when the pass did not run
  // (a frozen run publishes nothing, so there is no staged site to judge).
  structural?: {
    openPageFindings: number;
    openGroupFindings: number;
    pendingGroups: number;
    assessmentsRequested: number;
    assessmentsFromCache: number;
  };
  // Present only under `ci: true` — everything the RUN knows about publishability. The decision
  // itself is minted after site emission, when the output inventory it binds to exists.
  publicationInputs?: PublicationDecisionInputs;
};

// Site-scope verify only journals findings and flips the run outcome; without this, the named
// page's shard stays 'passed' with no flag and `docstube status` disagrees with the run summary.
// Every site finding that names a page becomes an open system flag on that page's shard.
// Deduped within the run and against identical open flags already on the shard (refresh re-runs
// site verify, so an unfixed finding must not stack a new flag every run). Shared with maintain.
export const attachSiteFindingsToShards = async (input: {
  store: ManifestStore;
  journal: RunJournal;
  siteFindings: Finding[];
}): Promise<Flag[]> => {
  const raised: Flag[] = [];
  const seenThisRun = new Set<string>();
  for (const finding of input.siteFindings) {
    const entity = finding.entity;
    if (entity === undefined) {
      continue;
    }
    const summary = `[${finding.check}] ${finding.message}`;
    const dedupKey = `${entity.locale}\u0000${entity.pageId}\u0000${summary}`;
    if (seenThisRun.has(dedupKey)) {
      continue;
    }
    seenThisRun.add(dedupKey);
    const shard = await input.store.readPageShard({ locale: entity.locale, pageId: entity.pageId });
    if (shard === undefined) {
      continue;
    }
    if (shard.flags.some((flag) => flag.kind === 'system' && flag.status === 'open' && flag.summary === summary)) {
      continue;
    }
    const flag: Flag = {
      id: mintId(idPrefixes.flag),
      kind: 'system',
      status: 'open',
      summary,
      entity,
      runId: input.journal.runId,
      createdAt: new Date().toISOString()
    };
    await input.store.writePageShard({ ...shard, flags: [...shard.flags, flag] });
    await input.journal.append({ type: 'flag-raised', flag });
    raised.push(flag);
  }
  return raised;
};

export const resolveCommit = async (repoRoot: string): Promise<string> => {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    return stdout.trim();
  } catch {
    return '0'.repeat(40);
  }
};

// WHAT GIT ACTUALLY SAID (wave 2b close final — the run-diagnostics finding): 'dirty' means
// porcelain RAN and reported non-output changes; 'unknown' means it could not be believed at all —
// no HEAD, no repository, or a `git status` that failed. The two collapse to the same TRUST
// decision (both mark the run), but they must never collapse to the same SENTENCE: telling an
// operator that `git status` reported the tree dirty when porcelain never ran sends them to debug a
// diff that does not exist.
export type WorkingTreeState = 'clean' | 'dirty' | 'unknown';

export type SourceRevisionState = {
  commit: string;
  // True when HEAD may never have contained the bytes this run reads: uncommitted changes in the
  // working tree, or no git repository/HEAD at all (impl-07 finding 7). sourceRevision fields
  // still record HEAD (the contracts require a git commit); GenerationLineage.dirtyWorkingTree
  // persists the honest marker and the run journals a warning. Full immutable-snapshot reads —
  // evidence bound to the exact tree object rather than the mutable checkout — land with the
  // reconciler wave.
  dirtyWorkingTree: boolean;
  // The OBSERVATION behind that boolean — what the warnings are allowed to claim git said.
  treeState: WorkingTreeState;
};

// docstube's OWN declared output prefixes (impl-10 finding 4): the generated site under
// config.outDir plus everything under .docstube/ (the committed manifest/criteria/instructions
// and the gitignored machine-local state) — the same path set the output inventory declares as
// docstube-owned at the commit boundary. The dirty-tree porcelain probes must ignore these: a
// normal successful run WRITES them, so counting them as dirt would make every meaningful run
// self-mark dirty. Only non-output dirt (the user's source tree) counts, at start AND end.
export const docstubeOwnOutputPrefixes = (config: { outDir: string }): string[] => {
  const outDir = config.outDir.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  return [...(outDir === '' || outDir === '.' ? [] : [outDir]), '.docstube'];
};

// Paths reported by `git status --porcelain -z`: NUL-separated `XY <path>` entries; rename/copy
// entries carry the original path as an extra NUL-separated field — both sides count as dirt.
const porcelainPaths = (stdout: string): string[] => {
  const parts = stdout.split('\0').filter((part) => part !== '');
  const paths: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index]!;
    paths.push(entry.slice(3));
    if (entry.startsWith('R') || entry.startsWith('C')) {
      index += 1;
      const origin = parts[index];
      if (origin !== undefined) {
        paths.push(origin);
      }
    }
  }
  return paths;
};

const underPrefix = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

// One porcelain probe, shared by the run-start resolution and the run-END recheck. A `git status`
// that cannot run is 'unknown', NEVER clean. Paths under docstube's own declared output prefixes
// are excluded — they are the run's expected writes, not tree dirtiness.
export const probeWorkingTree = async (
  repoRoot: string,
  ownOutputPrefixes: string[] = []
): Promise<WorkingTreeState> => {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z'], { cwd: repoRoot });
    const dirty = porcelainPaths(stdout).some(
      (path) => !ownOutputPrefixes.some((prefix) => underPrefix(path.replaceAll('\\', '/'), prefix))
    );
    return dirty ? 'dirty' : 'clean';
  } catch {
    return 'unknown';
  }
};

// The TRUST question ("must this run be marked?"), which answers the same for 'dirty' and
// 'unknown'. Callers that also PHRASE a warning must read probeWorkingTree instead.
export const checkWorkingTreeDirty = async (repoRoot: string, ownOutputPrefixes: string[] = []): Promise<boolean> =>
  (await probeWorkingTree(repoRoot, ownOutputPrefixes)) !== 'clean';

// UNVERSIONED SOURCES ARE UNCOMMITTED (wave 2b close — the spine finding): `git status
// --porcelain` never reports IGNORED files, so a run could check evidence against bytes that exist
// in NO commit while the tree reported clean. Trackedness is resolved with ONE `git ls-files` call,
// set-diffed in memory — never a probe per file.
//
// STILL LOAD-BEARING AFTER walkRepoFiles STOPPED WALKING GITIGNORED PATHS. The original trigger was
// the codemap scanning ignored build output (this repo's own dist-dogfood/** and apps/cli/local-ui/**
// reproduced it); the walker now excludes those, which is why this check is no longer a blanket
// "every repo with a dist/ is dirty" rule. Two genuine causes remain and MUST keep marking the run:
// an untracked-but-not-ignored source file the author has not added yet (real source, absent from
// every commit — porcelain reports it too, so the tree also reads dirty), and an agent observed-read
// of a gitignored path, which porcelain never reports at all.
const gitTrackedPaths = async (repoRoot: string): Promise<Set<string> | undefined> => {
  try {
    // -z: NUL-separated and never quoted, so paths with spaces/UTF-8 survive verbatim. Run from
    // repoRoot, git lists the paths relative to it — the same shape walkRepoFiles produces.
    const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
    return new Set(stdout.split('\0').filter((path) => path !== ''));
  } catch {
    return undefined;
  }
};

// The BOUNDED set of source files a run actually parsed or read: codemap symbol files (parsed by a
// language pack), the fingerprint snapshot's whole-file fallbacks (read and content-hashed), and
// the writer's observed reads. Never a fresh whole-tree scan — only bytes this run consumed.
export const readSourceFiles = (input: {
  codemap?: { symbols: ReadonlyArray<{ file: string }> } | undefined;
  fingerprints?: { unparsedFiles: ReadonlyArray<{ file: string }> } | undefined;
  observedReads?: ReadonlyArray<{ file: string }> | undefined;
}): string[] => [
  ...new Set([
    ...(input.codemap?.symbols ?? []).map((symbol) => symbol.file),
    ...(input.fingerprints?.unparsedFiles ?? []).map((entry) => entry.file),
    ...(input.observedReads ?? []).map((read) => read.file)
  ])
];

// Which of those files git does not version — untracked OR ignored. Paths under docstube's own
// declared outputs are excluded for the same reason the porcelain probe excludes them: a run WRITES
// them, so counting them would make every meaningful run self-mark dirty.
export const unversionedReadSources = async (input: {
  repoRoot: string;
  files: readonly string[];
  ownOutputPrefixes?: string[] | undefined;
}): Promise<string[]> => {
  const ownOutputPrefixes = input.ownOutputPrefixes ?? [];
  const candidates = [...new Set(input.files.map((file) => file.replaceAll('\\', '/')))]
    .filter((file) => !ownOutputPrefixes.some((prefix) => underPrefix(file, prefix)))
    .toSorted();
  if (candidates.length === 0) {
    return [];
  }
  const tracked = await gitTrackedPaths(input.repoRoot);
  // Unknown state is NEVER reported clean — the same rule the porcelain probe follows.
  return tracked === undefined ? candidates : candidates.filter((file) => !tracked.has(file));
};

// Resolved ONCE at run start: fingerprinting/codemap/verification all read the working tree, so
// the honesty marker must describe the tree state the whole run saw. The tree is RE-CHECKED at
// run end (dirtyTreeEndOfRunSweep): a tree that mutated mid-run is dirty for honesty purposes
// even when the start looked clean.
export const resolveSourceRevision = async (
  repoRoot: string,
  ownOutputPrefixes: string[] = []
): Promise<SourceRevisionState> => {
  const commit = await resolveCommit(repoRoot);
  if (commit === '0'.repeat(40)) {
    // No HEAD (or no repository): porcelain was never consulted, so the state is UNKNOWN, not
    // observed-dirty. The run is marked either way.
    return { commit, dirtyWorkingTree: true, treeState: 'unknown' };
  }
  const treeState = await probeWorkingTree(repoRoot, ownOutputPrefixes);
  return { commit, dirtyWorkingTree: treeState !== 'clean', treeState };
};

// `unversionedSources` names the second, quieter cause (wave 2b close): the run READ files git does
// not version, so HEAD cannot contain the checked bytes either.
//
// THE WORDING MATCHES WHAT WAS OBSERVED (wave 2b close final — the run-diagnostics finding, twice
// over). First: the sampled warning used to say the tree "looked clean" unconditionally, including
// for an UNTRACKED file, which porcelain reports loudly — an operator reading that would conclude
// the probe was broken. Second: a missing HEAD or an unreadable `git status` used to arrive here as
// the same `true` an observed dirty tree does, so the warning claimed porcelain reported the tree
// dirty even when porcelain never ran. The state is now the tri-state git actually produced, and
// each of the three gets its own sentence; the actionable path samples ride along in every case.
export const dirtyWorkingTreeWarning = (
  commit: string,
  unversionedSources: readonly string[] = [],
  treeState: WorkingTreeState = 'clean'
): Finding => {
  const sample = unversionedSources.slice(0, 3).join(', ');
  const unversionedCause =
    `this run read ${unversionedSources.length} source file${unversionedSources.length === 1 ? '' : 's'} that ` +
    `git does not version — untracked or ignored (${sample}${unversionedSources.length > 3 ? ', …' : ''})`;
  const unknownTree =
    'the working tree state is UNKNOWN — git reported no HEAD, or `git status` could not be read, so no porcelain ' +
    'result exists to trust';
  const cause =
    unversionedSources.length === 0
      ? treeState === 'unknown'
        ? unknownTree
        : 'the working tree is dirty'
      : treeState === 'dirty'
        ? `${unversionedCause}, and \`git status\` reported the working tree dirty as well`
        : treeState === 'unknown'
          ? `${unversionedCause}, and ${unknownTree}`
          : `${unversionedCause}, and \`git status\` never reports ignored files, so the tree looked clean — the ` +
            'codemap no longer walks gitignored paths, so these were read outside the versioned source tree';
  return {
    source: 'verifier',
    check: 'source-revision',
    severity: 'warning',
    message:
      `${cause}: generation reads working-tree bytes, but evidence is labeled with ` +
      `commit ${commit.slice(0, 12)} — provenance carries dirtyWorkingTree: true, so every page persisted this run ` +
      'renders its true claim counts with a "checked against uncommitted changes" note and never the complete state ' +
      '(PRODUCT §1.2); commit your changes and rerun for evidence HEAD can vouch for'
  };
};

// Writing the index reconciles the committed shard tree against it (manifest-store). What that
// reconciliation DELETED is committed state leaving the repo, so it is journaled by name — a silent
// prune is how an operator ends up staring at a diff nothing in the run explains.
export const prunedShardsFinding = (pruned: readonly string[]): Finding => ({
  source: 'verifier',
  check: 'manifest-integrity',
  severity: 'info',
  message:
    `reconciled the committed manifest: ${pruned.length} shard file${pruned.length === 1 ? '' : 's'} under ` +
    `.docstube/manifest/ ${pruned.length === 1 ? 'was' : 'were'} not referenced by the index this run recorded and ` +
    `${pruned.length === 1 ? 'was' : 'were'} removed (${pruned.join(', ')})`
});

// Same honesty rule at the END sweep: an unreadable `git status` is not an observed dirty tree.
const dirtyAtRunEndWarning = (commit: string, treeState: WorkingTreeState = 'dirty'): Finding => ({
  source: 'verifier',
  check: 'source-revision',
  severity: 'warning',
  message:
    (treeState === 'unknown'
      ? 'the working tree state became UNKNOWN during the run (git reported no HEAD, or `git status` could not be ' +
        'read): '
      : 'the working tree became dirty DURING the run: ') +
    `the bytes this run read may not be the bytes now on disk (or in ` +
    `commit ${commit.slice(0, 12)}) — provenance for every page persisted this run now carries dirtyWorkingTree: ` +
    'true, so those pages render their true claim counts with a "checked against uncommitted changes" note and ' +
    'never the complete state (PRODUCT §1.2); commit/settle the tree and rerun generate'
});

// HEAD STABILITY (wave 2b close — the clean-mid-run-commit finding): the end sweep re-checked
// porcelain but never re-read HEAD, so a commit landing mid-run — which leaves the tree perfectly
// CLEAN — let evidence be labeled with a revision that never contained the bytes the run actually
// read. HEAD is recorded at run start and re-read at the end; any movement marks the run exactly
// like tree dirt, and the warning names BOTH revisions so the mismatch is diagnosable.
//
// THE SENTENCE DESCRIBES BOTH ENDS OF THE RUN (wave 2b close — the run-diagnostics finding, third
// pass). A single `startedDirty` boolean threw away two facts and produced contradictions: a run
// that STARTED clean and ended dirty (or unknown) still claimed the commit "left the tree clean",
// and a run whose start state was UNKNOWN — porcelain never ran — was relabeled "ALREADY dirty" the
// moment HEAD became readable, sending an operator to look for a diff nobody ever observed. The
// warning now takes the start tri-state AND the end state and words each combination for what was
// actually seen. Both revisions are named in every case (that is what makes the mismatch
// diagnosable), and the provenance TENSE follows whether this sweep marked the shards or found them
// already marked. Trust behavior is unchanged: HEAD movement marks the run either way.
export const headMovedDuringRunWarning = (input: {
  startCommit: string;
  endCommit: string;
  // What `git status` reported at run START.
  startState: WorkingTreeState;
  // What it reported at the END sweep. Undefined when the sweep deliberately did not re-probe (the
  // already-marked path) — the warning then claims nothing about the end state.
  endState?: WorkingTreeState | undefined;
  // True when the run was already marked before HEAD moved — decides "already carries" vs "now
  // carries". Defaults to whether the start state alone had already marked it.
  alreadyMarked?: boolean | undefined;
}): Finding => {
  const unknownTree = '(git reported no HEAD, or `git status` could not be read)';
  const cause =
    input.startState === 'dirty'
      ? 'on a working tree that was ALREADY dirty when the run started'
      : input.startState === 'unknown'
        ? `while the working tree state was ALREADY UNKNOWN at run start ${unknownTree}`
        : input.endState === undefined
          ? 'on a working tree `git status` reported clean at run start'
          : input.endState === 'dirty'
            ? 'and left the tree DIRTY — `git status` reported it clean at run start and dirty at the end'
            : input.endState === 'unknown'
              ? `and left the working tree state UNKNOWN ${unknownTree} — \`git status\` reported it clean at run start`
              : 'and left the tree clean';
  const alreadyMarked = input.alreadyMarked ?? input.startState !== 'clean';
  return {
    source: 'verifier',
    check: 'source-revision',
    severity: 'warning',
    message:
      `HEAD MOVED during the run: this run read the working tree at commit ${input.startCommit.slice(0, 12)} but ` +
      `HEAD is now ${input.endCommit.slice(0, 12)} — a commit (or checkout, rebase, or branch switch) landed ` +
      `mid-run ${cause}, so the evidence this run recorded is labeled with a revision that need not contain the ` +
      `bytes it checked; provenance for every page persisted this run ${alreadyMarked ? 'already' : 'now'} carries ` +
      'dirtyWorkingTree: true, so those pages render their true claim counts with a "checked against uncommitted ' +
      'changes" note and never the complete state (PRODUCT §1.2); rerun generate on a settled HEAD for evidence ' +
      'that revision can vouch for'
  };
};

// Interim dirty-tree honesty (impl-07 finding 7): git porcelain is re-checked at run END as well
// as start — a tree that was clean at start but mutated mid-run marks every shard this run
// persisted with the dirtyWorkingTree lineage marker and journals a warning. The probe ignores
// docstube's OWN declared outputs (impl-10 finding 4): the run just wrote the manifest and the
// site, so those paths are expected — only non-output dirt marks. Full immutable-snapshot reads
// (evidence bound to the exact git tree object rather than the mutable checkout) remain
// RECONCILER-WAVE work.
export const dirtyTreeEndOfRunSweep = async (input: {
  repoRoot: string;
  store: ManifestStore;
  journal: RunJournal;
  commit: string;
  dirtyAtStart: boolean;
  // The tri-state porcelain actually reported at run START. `dirtyAtStart` is the TRUST answer and
  // can be true on a clean-reporting tree (unversioned reads); the warnings need the observation.
  treeStateAtStart: WorkingTreeState;
  ownOutputPrefixes: string[];
  persistedShards: Array<{ locale: string; pageId: string }>;
}): Promise<void> => {
  if (input.dirtyAtStart) {
    // HEAD MOVEMENT IS ALWAYS REPORTED (wave 2b close final — the run-diagnostics finding): an
    // already-dirty run needs no further MARKING (every shard it persisted already carries
    // dirtyWorkingTree, so trust is unaffected), but it still deserves the DIAGNOSIS. Returning
    // before re-reading HEAD meant a commit landing mid-run — or a HEAD that became unreadable —
    // left no revision-pair warning at all, exactly when an operator most needs to know which two
    // revisions the run straddled. The porcelain/ls-files probes stay skipped: they would only
    // repeat what run start already journaled — which is also why the warning is given NO end
    // state: nothing observed it, so it must claim nothing about it.
    const endCommit = await resolveCommit(input.repoRoot);
    if (endCommit !== input.commit) {
      await input.journal.append({
        type: 'findings',
        findings: [
          headMovedDuringRunWarning({
            startCommit: input.commit,
            endCommit,
            startState: input.treeStateAtStart,
            alreadyMarked: true
          })
        ]
      });
    }
    return;
  }
  // The shards are read up front because the sweep needs their OBSERVED READS to decide: a writer
  // that read an untracked or ignored file consumed bytes no commit contains, which porcelain
  // cannot see. The same shards are what the sweep then marks.
  const seen = new Set<string>();
  const marked: Array<{ shard: PageShard; provenance: ProvenanceV2 }> = [];
  for (const target of input.persistedShards) {
    const key = `${target.locale} ${target.pageId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const shard = await input.store.readPageShard(target);
    if (shard === undefined || shard.provenance === undefined) {
      continue;
    }
    marked.push({ shard, provenance: shard.provenance });
  }
  const unversioned = await unversionedReadSources({
    repoRoot: input.repoRoot,
    files: readSourceFiles({ observedReads: marked.flatMap((entry) => entry.provenance.lineage.observedReads) }),
    ownOutputPrefixes: input.ownOutputPrefixes
  });
  const treeState = await probeWorkingTree(input.repoRoot, input.ownOutputPrefixes);
  const treeDirty = treeState !== 'clean';
  // HEAD is re-read, not just porcelain: a mid-run commit leaves the tree CLEAN while changing the
  // revision the evidence is labeled with. resolveCommit's unknown-state sentinel differs from any
  // real commit, so an unreadable HEAD marks too — never silently clean.
  const endCommit = await resolveCommit(input.repoRoot);
  const headMoved = endCommit !== input.commit;
  if (!treeDirty && !headMoved && unversioned.length === 0) {
    return;
  }
  // Each cause states ITSELF: the untracked-source warning is journaled only when there are actual
  // paths to name, so no warning ever promises samples it does not carry.
  const findings: Finding[] = [
    ...(headMoved
      ? [
          headMovedDuringRunWarning({
            startCommit: input.commit,
            endCommit,
            startState: input.treeStateAtStart,
            endState: treeState,
            alreadyMarked: false
          })
        ]
      : []),
    ...(treeDirty ? [dirtyAtRunEndWarning(input.commit, treeState)] : []),
    ...(unversioned.length > 0 ? [dirtyWorkingTreeWarning(input.commit, unversioned, treeState)] : [])
  ];
  await input.journal.append({ type: 'findings', findings });
  for (const { shard, provenance } of marked) {
    await input.store.writePageShard({
      ...shard,
      provenance: { ...provenance, lineage: { ...provenance.lineage, dirtyWorkingTree: true } }
    });
  }
};

const pageNodes = (nodes: IaNodeV2[]): IaPageNodeV2[] =>
  walkIaV2Nodes(nodes).filter((node): node is IaPageNodeV2 => node.kind === 'page');

export const runGenerate = async (options: GenerateOptions): Promise<GenerateSummary> => {
  const { repoRoot } = options;
  const family = await loadConfigFamily(repoRoot);
  const { config, ia, glossary } = family;
  const locale = config.locales.source;
  const version = config.versions.current;

  // ia.yml enters the pipeline through its v2 shape (finding 6): page nodes carry the PRIMARY
  // persona that gates review; until the wizard writes v2 files natively, the legacy shape
  // upgrades with the first configured persona as the default primary.
  const iaV2 = convertIaToV2(ia, { defaultPrimaryPersona: config.personas[0]?.id ?? 'reader' });

  const host = createPluginHost();
  await registerBuiltinPlugins(host);
  await loadConfiguredPlugins(host, config, repoRoot);
  const contextFiles = await loadContextFiles(repoRoot);

  const journal = await createRunJournal(repoRoot, options.runId ?? mintId(idPrefixes.run));
  // Any escaping error journals a terminal 'failed' outcome first — a crashed run must never
  // read as still running (journalRunFailure rethrows).
  try {
    const ownOutputs = docstubeOwnOutputPrefixes(config);
    const { commit, dirtyWorkingTree: treeDirtyAtStart, treeState } = await resolveSourceRevision(repoRoot, ownOutputs);
    await journal.append({ type: 'run-started', mode: 'generate', commit });
    if (treeDirtyAtStart) {
      await journal.append({ type: 'findings', findings: [dirtyWorkingTreeWarning(commit, [], treeState)] });
    }

    const store = createManifestStore(repoRoot, version);
    // FIRST THING, BEFORE ANYTHING READS THE COMMITTED MANIFEST (pipeline-v2 decision 3): a staging
    // area left in the `publishing` phase means a previous publish replay was interrupted, so the
    // published tree may hold new pages/routes against an index that still describes the previous
    // state. The staged work is complete (a publish only starts once a plan completed) and the
    // replay is idempotent, so it is finished FORWARD — never left mixed, never half-discarded.
    const recovery = await finishInterruptedPublish({
      repoRoot,
      outDir: config.outDir,
      store,
      publishSite: options.publishSite
    });
    if (recovery.recovered) {
      await journal.append({
        type: 'findings',
        findings: [
          interruptedPublishFinding(recovery.runId ?? 'unknown'),
          ...(recovery.pruned.length > 0 ? [prunedShardsFinding(recovery.pruned)] : [])
        ]
      });
    }

    await journal.append({ type: 'stage-started', stage: 'codemap' });
    const codemapStarted = Date.now();
    const packs = host.languagePacks().map((entry) => entry.definition);
    const codemap = await buildCodemap({ repoRoot, commit, packs });
    // The typed-fingerprint snapshot rides with the codemap: claim subscriptions minted during
    // anchoring resolve against it (signature/value/body facets, whole-file fallback).
    const fingerprints = await buildFingerprintSnapshot({ repoRoot, commit, packs });
    await journal.append({
      type: 'stage-completed',
      stage: 'codemap',
      inputHash: hashValue({ commit }),
      durationMs: Date.now() - codemapStarted
    });

    // Unversioned sources count as uncommitted (wave 2b close): the parse/read set is known only
    // now, and a file git ignores is invisible to porcelain — so a clean-reporting tree can still
    // have been read for bytes no commit contains.
    //
    // ALWAYS COMPUTED, even when porcelain already reported dirt (wave 2b close — the diagnostics
    // finding): skipping the ls-files diff on an already-dirty tree left the operator with only
    // the generic "the working tree is dirty" line, while the actionable detail — WHICH source
    // files this run read that no commit contains — was one cheap `git ls-files` away. The diff is
    // a single call over the bounded read set, so the warning always names the paths it claims.
    const unversionedSources = await unversionedReadSources({
      repoRoot,
      files: readSourceFiles({ codemap, fingerprints }),
      ownOutputPrefixes: ownOutputs
    });
    if (unversionedSources.length > 0) {
      await journal.append({
        type: 'findings',
        findings: [dirtyWorkingTreeWarning(commit, unversionedSources, treeState)]
      });
    }
    const dirtyWorkingTree = treeDirtyAtStart || unversionedSources.length > 0;

    // generate IS the remedy for an index that outruns its shards, so it must be able to READ one:
    // it rewrites the index and reconciles the shard tree at the end of the run. Every consumer
    // that would publish or reason from the manifest keeps the strict read.
    const previousIndex = await store.readIndex({ requireShards: false });
    const slugToPageId = new Map((previousIndex?.pages ?? []).map((entry) => [entry.slug, entry.id]));

    // The BASE side of the guarantee-downgrade comparison (quality-ci-reader-v2 decision 12): the
    // committed manifest this run STARTED from, read before a single shard is rewritten. In the
    // Action's flow the workspace is checked out at the base-branch tip before `generate` runs, so
    // this is exactly the manifest at the merge base. No manifest at all is the first-run state —
    // nothing can have regressed; a manifest that cannot be read back is missing evidence and
    // blocks the deterministic gate rather than passing as "no regression".
    const baseLedgers =
      options.ci === true ? await readLedgerSnapshot({ store, index: previousIndex, locale }) : undefined;

    // Knowledge lifecycle (PRODUCT §3.10): commit human-answered flags as KnowledgeFacts, rebind or
    // stale facts against this run's fingerprint snapshot, reconcile propagation, and open the
    // session the page runner reads answers from and captures new needs through.
    const previousPageIds = (previousIndex?.pages ?? []).map((entry) => entry.id);
    const allLocales = [locale, ...config.locales.targets];
    const knowledge = await openKnowledgeForRun({
      repoRoot,
      store,
      locales: allLocales,
      pageIds: previousPageIds,
      fingerprints,
      runId: journal.runId
    });

    const maxRunUsd = config.agents.budgets.maxRunUsd;
    const costTracker = createRunCostTracker(maxRunUsd, config.agents.budgets.maxPlanUsagePercent);

    const ctx: PageRunContext = {
      repoRoot,
      host,
      codemap,
      fingerprints,
      journal,
      options: {
        runTask: options.runTask,
        toolDescriptors: options.toolDescriptors,
        maxAttemptsPerPage: options.maxAttemptsPerPage,
        // The risk critic's own routing (agents.roles.risk-critic) and its content-addressed
        // verdict cache: one call per page, and never a second call for a page whose prose and
        // ledger state did not move.
        riskCriticModel: resolveRoleRouting(config, 'risk-critic').model,
        riskCriticCache: createRiskCriticCache(repoRoot)
      },
      config,
      glossary,
      criteria: contextFiles.criteria,
      instructions: contextFiles.instructions,
      knowledge: knowledge.session,
      costTracker,
      commit,
      dirtyWorkingTree,
      locale,
      version
    };
    const outcomes: PageOutcome[] = [];
    const translations: TranslationOutcome[] = [];
    const artifacts: PageArtifact[] = [];

    // NOTHING PUBLISHES UNTIL THE PLAN COMPLETES (pipeline-v2 decision 3). Completed pages, their
    // shards, and the index accumulate under `.docstube/staging/`; the published tree and the
    // committed manifest are not touched until the single publish step at the end of this run.
    const staging = await openPublishStaging({
      repoRoot,
      outDir: config.outDir,
      runId: journal.runId,
      version,
      sourceLocale: locale,
      planFingerprint: planFingerprint({
        // The PARSED config, minus `agents.budgets`. Budgets are execution policy, not content:
        // raising the cap to finish a frozen run is the canonical resume action, and it must not
        // throw the staged work away. Everything else about the config — personas, docType, project
        // context, theme, outDir, locales — does change what a page says, so it invalidates.
        configHash: hashValue({ ...config, agents: { ...config.agents, budgets: undefined } }),
        iaHash: hashValue(ia),
        docstubeVersion,
        locale,
        targetLocales: config.locales.targets,
        version,
        sourceFingerprint: fingerprints
      }),
      publishedStore: store
    });

    const openFlagKinds: FlagKind[] = [];
    // Every shard staged this run — the end-of-run dirty-tree sweep re-marks exactly these.
    const persistedShards: Array<{ locale: string; pageId: string }> = [];
    const stagePage = async (input: {
      kind: 'source' | 'translation';
      shard: PageShard;
      artifact?: PageArtifact | undefined;
      status: 'passed' | 'flagged';
      findings: Finding[];
      attempts?: number | undefined;
    }) => {
      await staging.stagePage(input);
      persistedShards.push({ locale: input.shard.locale, pageId: input.shard.page.id });
      for (const flag of input.shard.flags) {
        await journal.append({ type: 'flag-raised', flag });
        if (flag.status === 'open') {
          openFlagKinds.push(flag.kind);
        }
      }
    };

    // Cap-freeze (PRODUCT §3.5): checked only BETWEEN pages (and before translations) — never
    // mid-page, because a half-verified page would ship state the gate never approved. Pages the
    // run already finished stay STAGED (and are reused, unbilled, by the run that resumes);
    // remaining pages are simply not generated, and nothing publishes.
    let frozen = false;
    let resumedPages = 0;
    // The PLAN: every page the IA asked this run to produce. `planned` is what the decision must
    // reconcile against — `completed + deferred` — so a freeze can never read as a finished run.
    const plannedNodes = pageNodes(iaV2.tree);
    for (const node of plannedNodes) {
      // RESUME WITHOUT RE-BILLING (pipeline-v2 decision 3): a page a previous frozen run of this
      // same plan already completed is reused verbatim from staging — no writer task, no reviewer
      // task, no cost. The staging area is only offered for reuse while its plan fingerprint (config
      // + IA + a content fingerprint of every source file the run read) still matches, so reuse can
      // never serve prose generated against a source tree that has since changed.
      const staged = staging.resumableSourcePage(node.slug);
      const stagedShard =
        staged === undefined ? undefined : await staging.store.readPageShard({ locale, pageId: staged.pageId });
      const stagedMdx = staged === undefined ? undefined : await staging.readStagedMdx(staged);
      if (staged !== undefined && stagedShard !== undefined && stagedMdx !== undefined) {
        resumedPages += 1;
        outcomes.push({
          pageId: staged.pageId,
          slug: staged.slug,
          status: staged.status,
          findings: staged.findings,
          attempts: staged.attempts ?? 0
        });
        artifacts.push({
          page: stagedShard.page,
          mdx: stagedMdx,
          mdxPath: staged.mdxPath ?? contentRelativePath(locale, staged.slug),
          locale,
          version
        });
        persistedShards.push({ locale, pageId: staged.pageId });
        await journal.append({ type: 'page-status', pageId: staged.pageId, status: staged.status });
        for (const translation of staging.resumableTranslations(staged.slug)) {
          translations.push({
            locale: translation.locale,
            slug: translation.slug,
            status: translation.status,
            findings: translation.findings
          });
          persistedShards.push({ locale: translation.locale, pageId: translation.pageId });
        }
        continue;
      }

      if (costTracker.shouldFreeze()) {
        frozen = true;
        break;
      }
      const previousPageId = slugToPageId.get(node.slug);
      const previousShard =
        previousPageId === undefined ? undefined : await store.readPageShard({ locale, pageId: previousPageId });
      const { outcome, artifact, shard } = await generatePage(ctx, node, previousShard);
      outcomes.push(outcome);
      artifacts.push(artifact);

      // Stage per page as it lands: MDX and shard into the staging area, never the published tree.
      await stagePage({
        kind: 'source',
        artifact,
        shard,
        status: outcome.status,
        findings: outcome.findings,
        attempts: outcome.attempts
      });
      await journal.append({ type: 'page-status', pageId: outcome.pageId, status: outcome.status });

      // Verified translations stage right behind their source page (PRODUCT §4.1 i18n).
      if (config.locales.targets.length > 0 && outcome.status === 'passed') {
        if (costTracker.shouldFreeze()) {
          frozen = true;
          break;
        }
        for (const translation of await translateArtifact(ctx, artifact)) {
          translations.push(translation.outcome);
          // A failed translation must never emit MDX under a locale path — the fallback artifact
          // is the untranslated source page. The shard (with its flags) still stages so status
          // and the flag queue see the failure.
          await stagePage({
            kind: 'translation',
            shard: translation.shard,
            ...(translation.outcome.status === 'passed' ? { artifact: translation.artifact } : {}),
            status: translation.outcome.status,
            findings: translation.outcome.findings
          });
        }
      }
    }
    if (frozen) {
      await journal.append({
        type: 'run-frozen',
        reason: freezeReason({
          maxRunUsd,
          maxPlanUsagePercent: config.agents.budgets.maxPlanUsagePercent,
          planUsedPercent: costTracker.planUsedPercent()
        }),
        spentUsd: costTracker.spentUsd() + costTracker.estimatedUsd()
      });
    }

    // Topology / site-scope verification across all pages (cross-page links, orphans).
    await journal.append({ type: 'stage-started', stage: 'verify' });
    const siteResults = await runVerifiers({
      repoRoot,
      config,
      codemap,
      glossary,
      host,
      artifacts,
      includeSiteScope: true
    });
    const siteFindings = errorFindings(siteResults);
    if (siteFindings.length > 0) {
      await journal.append({ type: 'findings', findings: siteFindings });
      // Site-scope findings must also land on the named page's shard — otherwise `docstube status`
      // (which reads shards) disagrees with the run summary.
      // …on the STAGED shard: a site finding is part of the same publish unit as the page it names.
      for (const flag of await attachSiteFindingsToShards({ store: staging.store, journal, siteFindings })) {
        openFlagKinds.push(flag.kind);
      }
    }
    await journal.append({
      type: 'stage-completed',
      stage: 'verify',
      inputHash: hashValue(artifacts.map((artifact) => artifact.page.id)),
      durationMs: 0
    });

    // THE STRUCTURE PASS (quality-ci-reader-v2 decisions 18/20/21). It runs HERE — over the staged
    // canonical site, after every page landed and before anything publishes — because that is the
    // only moment the whole shape of what the reader is about to get exists in one place. It is
    // strictly non-blocking: it produces committed WORK ITEMS (page findings on page shards, group
    // findings on per-group structural shards), never flags, never claims, never a gate input. A
    // frozen run skips it: nothing is publishing, so judging the shape would only spend money on a
    // site no reader will see.
    let structural: StructurePassResult | undefined;
    if (!frozen) {
      const stagedShards: PageShard[] = [];
      for (const artifact of artifacts) {
        const staged = await staging.store.readPageShard({ locale, pageId: artifact.page.id });
        if (staged !== undefined) {
          stagedShards.push(staged);
        }
      }
      const priorShards = new Map<string, PageShard>();
      for (const entry of previousIndex?.pages ?? []) {
        const shard = await store.readPageShard({ locale, pageId: entry.id });
        if (shard !== undefined) {
          priorShards.set(entry.id, shard);
        }
      }
      const priorGroupShards: StructuralGroupShard[] = [];
      for (const groupId of await store.listStructuralGroupIds()) {
        const shard = await store.readStructuralShard(groupId);
        if (shard !== undefined) {
          priorGroupShards.push(shard);
        }
      }
      const architectModel = resolveRoleRouting(config, 'architect').model;
      structural = await runStructurePass({
        tree: iaV2.tree,
        stagedShards,
        priorShards,
        priorGroupShards,
        runTask: options.runTask,
        ...(architectModel === undefined ? {} : { model: architectModel }),
        cache: createStructuralAssessmentCache(repoRoot),
        journal,
        costTracker
      });
      // Findings ride the STAGED shards: they publish with the pages they describe, in one commit.
      for (const shard of stagedShards) {
        const findings = structural.pageFindings.get(shard.page.id) ?? [];
        if (findings.length > 0 || shard.structuralFindings.length > 0) {
          await staging.store.writePageShard({ ...shard, structuralFindings: findings });
        }
      }
      await staging.stageStructuralGroups(structural.groupShards);
      await journal.append({
        type: 'findings',
        findings: [
          {
            source: 'verifier',
            check: 'structural-quality',
            // INFO, ALWAYS (decision 21): structural findings are nonblocking work items, so this
            // must never reach the deterministic gate or the flag queue.
            severity: 'info',
            message: `${structuralSummaryLine(structural)}${
              structural.pendingScopes.length === 0
                ? ''
                : ` · ${structural.pendingScopes.length} group(s) pending (not assessed this run)`
            }`
          }
        ]
      });
    }

    // The index this run WOULD publish: exactly the pages the plan produced. It is built even for a
    // frozen run (the journal and the decision reason about the same object) but a frozen run never
    // reaches the publish step, so it never reaches disk. The old carry-forward-on-freeze logic is
    // gone with the freeze-publishes-nothing rule: a truncated index can no longer be written, so
    // there is nothing to rescue committed pages FROM.
    const index: ManifestIndex = {
      schemaVersion: 1,
      docstubeVersion,
      sourceLocale: locale,
      locales: [locale, ...config.locales.targets],
      versions: [
        { label: version, status: 'current', commit },
        ...config.versions.frozen.map((label) => ({ label, status: 'frozen' as const }))
      ],
      pages: artifacts.map((artifact) => ({
        id: artifact.page.id,
        slug: artifact.page.slug,
        title: artifact.page.title,
        path: artifact.mdxPath
      })),
      configHash: hashValue(family.raw.config),
      iaHash: hashValue(family.raw.ia),
      // The groups whose structural shards this publish carries. A frozen run never reaches
      // publish, so it never records groups it did not evaluate; a run whose structure pass ran
      // states exactly the set it staged, which is what prunes shards for deleted nav groups.
      structuralGroups: (structural?.groupShards ?? []).map((shard) => shard.groupId),
      systemFlags: []
    };

    // Dirty-tree honesty, end-of-run recheck (impl-07 finding 7 interim): a clean-at-start tree
    // that mutated mid-run still gets the marker + journal warning. It marks the STAGED shards —
    // the ones this run is about to publish — before the publish step reads them.
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store: staging.store,
      journal,
      commit,
      dirtyAtStart: dirtyWorkingTree,
      treeStateAtStart: treeState,
      ownOutputPrefixes: ownOutputs,
      persistedShards
    });

    // THE ONE PUBLISH PATH (pipeline-v2 decision 3). Content MDX → shards → emitted routes/twins →
    // manifest index, in that order, all from the staging area, all or nothing. A frozen run skips
    // it entirely: the published tree stays byte-identical and the staged work waits for the run
    // that finishes the plan.
    let published = false;
    if (!frozen) {
      const result = await staging.publish({
        index,
        ...(options.publishSite === undefined ? {} : { publishSite: options.publishSite })
      });
      published = true;
      if (result.pruned.length > 0) {
        await journal.append({ type: 'findings', findings: [prunedShardsFinding(result.pruned)] });
      }
    }

    // The CANDIDATE side of the comparison, read back from what is actually PUBLISHED — never from
    // in-memory optimism, and never from staged work that no reader can see. A frozen run publishes
    // nothing, so its candidate is the previous published state: the honest statement that this run
    // changed nothing readers can observe.
    const publicationInputs =
      baseLedgers === undefined
        ? undefined
        : await (async (): Promise<PublicationDecisionInputs> => {
            const candidateLedgers = await readLedgerSnapshot({
              store,
              index: published ? index : previousIndex,
              locale
            });
            const { regressions, newBlockingDispositions } = compareLedgerSnapshots(baseLedgers, candidateLedgers);
            const completed = outcomes.length;
            return {
              baseSha: commit,
              sourceSha: commit,
              execution: frozen ? 'paused-budget' : 'completed',
              planned: plannedNodes.length,
              completed,
              deferred: plannedNodes.length - completed,
              deterministicGate: resolveDeterministicGate({
                findings: [...siteFindings, ...outcomes.flatMap((outcome) => outcome.findings)],
                dirtyWorkingTree,
                baseUnreadable: baseLedgers.unreadable || candidateLedgers.unreadable
              }),
              regressions,
              newBlockingDispositions,
              // COVERAGE RATCHET NOT WIRED (quality-ci-reader-v2 decision 13): explicit coverage
              // obligations are contracted but the kernel does not yet own an obligation registry
              // to diff, so this run declares no obligation movement rather than inventing one.
              coverageDelta: []
            };
          })();

    const flagged =
      outcomes.some((outcome) => outcome.status === 'flagged') ||
      translations.some((translation) => translation.status === 'flagged') ||
      openFlagKinds.length > 0 ||
      siteFindings.length > 0;
    const outcome = frozen ? 'frozen' : flagged ? 'flagged' : 'passed';
    await journal.append({ type: 'run-completed', outcome });
    return {
      runId: journal.runId,
      outcome,
      pages: outcomes,
      translations,
      siteFindings,
      warnings: [...host.warnings(), ...knowledge.warnings, ...(structural?.warnings ?? [])],
      openFlagKinds,
      ...(structural === undefined
        ? {}
        : {
            structural: {
              openPageFindings: structural.openPageFindings,
              openGroupFindings: structural.openGroupFindings,
              pendingGroups: structural.pendingScopes.length,
              assessmentsRequested: structural.assessmentsRequested,
              assessmentsFromCache: structural.assessmentsFromCache
            }
          }),
      published,
      resumedPages,
      ...(publicationInputs === undefined ? {} : { publicationInputs }),
      spendByRole: costTracker.spendByRole(),
      ...(costTracker.hasReportedCost() ? { spentUsd: costTracker.spentUsd() } : {}),
      ...(costTracker.hasEstimates() ? { estimatedUsd: costTracker.estimatedUsd() } : {}),
      ...(costTracker.planUsedPercent() !== undefined ? { planUsedPercent: costTracker.planUsedPercent() } : {})
    };
  } catch (error) {
    return journalRunFailure(journal, error);
  }
};
