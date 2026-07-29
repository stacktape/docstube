import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  ProvenanceV2
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
import { applyFlagAnswers, collectOpenQuestions, loadKnowledge } from './tribal-knowledge.ts';
import { generatePage } from './page-runner.ts';
import type { PageOutcome, PageRunContext, TaskRunner } from './page-runner.ts';
import { translateArtifact } from './translate-page.ts';
import type { TranslationOutcome } from './translate-page.ts';
import { createRunCostTracker, freezeReason } from './run-cost.ts';
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
  // Kinds of the open flags raised this run — telemetry input (coarse failure modes).
  openFlagKinds: FlagKind[];
  // Latest subscription plan usage (0-100) reported by the transport this run, when available.
  planUsedPercent?: number;
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

    const store = createManifestStore(repoRoot, version);
    // generate IS the remedy for an index that outruns its shards, so it must be able to READ one:
    // it rewrites the index and reconciles the shard tree at the end of the run. Every consumer
    // that would publish or reason from the manifest keeps the strict read.
    const previousIndex = await store.readIndex({ requireShards: false });
    const slugToPageId = new Map((previousIndex?.pages ?? []).map((entry) => [entry.slug, entry.id]));

    // Tribal-knowledge lifecycle: persist any human-answered flags into the knowledge store, then
    // load answers (writer context) and open-question keys (ask-once dedup) for this run.
    const previousPageIds = (previousIndex?.pages ?? []).map((entry) => entry.id);
    const allLocales = [locale, ...config.locales.targets];
    await applyFlagAnswers({ repoRoot, store, locales: allLocales, pageIds: previousPageIds });
    const knowledge = await loadKnowledge(repoRoot);
    const openQuestions = await collectOpenQuestions({
      store,
      locales: allLocales,
      pageIds: previousPageIds,
      knowledge
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
        maxAttemptsPerPage: options.maxAttemptsPerPage
      },
      config,
      glossary,
      criteria: contextFiles.criteria,
      instructions: contextFiles.instructions,
      knowledge,
      openQuestions,
      costTracker,
      commit,
      dirtyWorkingTree,
      locale,
      version
    };
    const outcomes: PageOutcome[] = [];
    const translations: TranslationOutcome[] = [];
    const artifacts: PageArtifact[] = [];

    const openFlagKinds: FlagKind[] = [];
    // Every shard persisted this run — the end-of-run dirty-tree sweep re-marks exactly these.
    const persistedShards: Array<{ locale: string; pageId: string }> = [];
    const persistShard = async (shard: Parameters<typeof store.writePageShard>[0]) => {
      await store.writePageShard(shard);
      persistedShards.push({ locale: shard.locale, pageId: shard.page.id });
      for (const flag of shard.flags) {
        await journal.append({ type: 'flag-raised', flag });
        if (flag.status === 'open') {
          openFlagKinds.push(flag.kind);
        }
      }
    };
    const persistArtifact = async (artifact: PageArtifact, shard: Parameters<typeof store.writePageShard>[0]) => {
      const mdxTarget = join(repoRoot, config.outDir, artifact.mdxPath);
      await mkdir(dirname(mdxTarget), { recursive: true });
      await writeFile(mdxTarget, artifact.mdx, 'utf8');
      await persistShard(shard);
    };

    // Cap-freeze (PRODUCT §3.5): checked only BETWEEN pages (and before translations) — never
    // mid-page, because a half-verified page would ship state the gate never approved. Pages that
    // already landed stay shipped; remaining pages are simply not generated.
    let frozen = false;
    for (const node of pageNodes(iaV2.tree)) {
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

      // Assemble per page as it lands: MDX into the site content dir, shard into the manifest.
      await persistArtifact(artifact, shard);
      await journal.append({ type: 'page-status', pageId: outcome.pageId, status: outcome.status });

      // Verified translations stream out right behind their source page (PRODUCT §4.1 i18n).
      if (config.locales.targets.length > 0 && outcome.status === 'passed') {
        if (costTracker.shouldFreeze()) {
          frozen = true;
          break;
        }
        for (const translation of await translateArtifact(ctx, artifact)) {
          translations.push(translation.outcome);
          // A failed translation must never emit MDX under a locale path — the fallback artifact
          // is the untranslated source page. The shard (with its flags) still persists so status
          // and the flag queue see the failure.
          if (translation.outcome.status === 'passed') {
            await persistArtifact(translation.artifact, translation.shard);
          } else {
            await persistShard(translation.shard);
          }
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
      for (const flag of await attachSiteFindingsToShards({ store, journal, siteFindings })) {
        openFlagKinds.push(flag.kind);
      }
    }
    await journal.append({
      type: 'stage-completed',
      stage: 'verify',
      inputHash: hashValue(artifacts.map((artifact) => artifact.page.id)),
      durationMs: 0
    });

    // A frozen run stopped BEFORE reaching some pages: their previous entries (and shards) must
    // survive, or the freeze would silently delete finished docs (live-hit: the first cap-freeze
    // pruned three committed shards). Only pages this run actually regenerated replace their entry.
    const reachedSlugs = new Set(artifacts.map((artifact) => artifact.page.slug));
    const carriedCandidates = frozen
      ? (previousIndex?.pages ?? []).filter((entry) => !reachedSlugs.has(entry.slug))
      : [];
    // …but only entries whose shard actually survives: carrying an entry with no shard would
    // record an index that outruns the shards on disk, which every reader is now entitled to
    // reject. A dropped entry is regenerated from its IA node on the next unfrozen run.
    const carriedEntries: typeof carriedCandidates = [];
    for (const entry of carriedCandidates) {
      if ((await store.readPageShard({ locale, pageId: entry.id })) !== undefined) {
        carriedEntries.push(entry);
      }
    }
    const index: ManifestIndex = {
      schemaVersion: 1,
      docstubeVersion,
      sourceLocale: locale,
      locales: [locale, ...config.locales.targets],
      versions: [
        { label: version, status: 'current', commit },
        ...config.versions.frozen.map((label) => ({ label, status: 'frozen' as const }))
      ],
      pages: [
        ...artifacts.map((artifact) => ({
          id: artifact.page.id,
          slug: artifact.page.slug,
          title: artifact.page.title,
          path: artifact.mdxPath
        })),
        ...carriedEntries
      ],
      configHash: hashValue(family.raw.config),
      iaHash: hashValue(family.raw.ia),
      systemFlags: []
    };
    const { pruned } = await store.writeIndex(index);
    if (pruned.length > 0) {
      await journal.append({ type: 'findings', findings: [prunedShardsFinding(pruned)] });
    }

    // Dirty-tree honesty, end-of-run recheck (impl-07 finding 7 interim): a clean-at-start tree
    // that mutated mid-run still gets the marker + journal warning.
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store,
      journal,
      commit,
      dirtyAtStart: dirtyWorkingTree,
      treeStateAtStart: treeState,
      ownOutputPrefixes: ownOutputs,
      persistedShards
    });

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
      warnings: host.warnings(),
      openFlagKinds,
      ...(costTracker.hasReportedCost() ? { spentUsd: costTracker.spentUsd() } : {}),
      ...(costTracker.hasEstimates() ? { estimatedUsd: costTracker.estimatedUsd() } : {}),
      ...(costTracker.planUsedPercent() !== undefined ? { planUsedPercent: costTracker.planUsedPercent() } : {})
    };
  } catch (error) {
    return journalRunFailure(journal, error);
  }
};
