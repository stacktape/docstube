import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { PageArtifact } from '@docstube/plugin-sdk';
import type { Finding, ManifestIndex, PageShard } from '@docstube/contracts';
import { findingSchema, hashValue, manifestIndexSchema } from '@docstube/contracts';
import { CoreError } from '../errors.ts';
import { createManifestStore } from '../state/manifest-store.ts';
import type { ManifestStore } from '../state/manifest-store.ts';

// STAGED-ATOMIC PUBLISH (pipeline-v2 decision 3, PRODUCT §3.5 stage 10, ARCHITECTURE §9.4).
//
// A run no longer writes each page into the published tree as it lands. Completed pages accumulate
// HERE — machine-local, gitignored, never committed — and the whole plan publishes in ONE ordered
// step or not at all. A budget freeze, a crash, or a failed page therefore leaves the published
// site byte-identical to what it was, instead of a tree where half the pages describe the new
// source and half the old one.
//
// WHERE: `.docstube/staging/` — a sibling of `runs/` and `cache/`, machine-local for the same
// reason (ARCHITECTURE §5.2). It is gitignored, excluded from the output inventory's declared
// paths (publication-decision.ts `isMachineLocal`) and from the Action's commit-path selection, and
// it sits under the `.docstube` prefix the dirty-tree probes already ignore — so staging can never
// be committed as if it were docs state, and can never self-mark the working tree dirty.
//
//   .docstube/staging/state.json          the staged plan: fingerprint, phase, per-page records
//   .docstube/staging/manifest/**         staged shards (a ManifestStore rooted here)
//   .docstube/staging/out/<mdxPath>       staged page MDX, keyed by its outDir-relative path
//
// THE GUARANTEE, EXACTLY (do not overstate it): publish is a single ordered replay from a COMPLETE
// staging area, and the manifest index — the thing every reader treats as the authority on what
// exists — is the LAST write, performed as a temp-file + rename so the index itself never appears
// half-written. There is no cross-file filesystem atomicity on any platform we target, so the
// honest statement is: nothing partial from a PLAN ever publishes, and an interruption during the
// publish REPLAY is detected by the next run (the `publishing` phase marker) and finished forward
// from the same staging area, byte-for-byte. See finishInterruptedPublish for the failure window.

export const stagingRelativeDir = '.docstube/staging';

export const stagingDir = (repoRoot: string): string => join(repoRoot, '.docstube', 'staging');

const stagingStatePath = (repoRoot: string): string => join(stagingDir(repoRoot), 'state.json');
const stagingManifestDir = (repoRoot: string): string => join(stagingDir(repoRoot), 'manifest');
const stagingOutDir = (repoRoot: string): string => join(stagingDir(repoRoot), 'out');

const stagedPageRecordSchema = z.object({
  // 'source' is a canonical source-locale page; 'translation' is one locale rendition of it.
  kind: z.enum(['source', 'translation']),
  locale: z.string(),
  slug: z.string(),
  pageId: z.string(),
  // outDir-relative path of the staged MDX. Absent when only the shard was staged — a FAILED
  // translation persists its flags but must never emit MDX under a locale path.
  mdxPath: z.string().optional(),
  status: z.enum(['passed', 'flagged']),
  findings: z.array(findingSchema).default([]),
  attempts: z.number().int().nonnegative().optional()
});

export type StagedPageRecord = z.infer<typeof stagedPageRecordSchema>;

export const stagedRunStateSchema = z.object({
  schemaVersion: z.literal(1),
  // Identity of the PLAN this staging area belongs to (see planFingerprint). A staging area whose
  // fingerprint does not match the current run describes a world that no longer exists, so it is
  // discarded rather than resumed — never silently mixed with fresh work.
  planFingerprint: z.string(),
  // 'staging' — work is accumulating, nothing has been published.
  // 'publishing' — the commit replay started; the published tree may be mid-transition.
  phase: z.enum(['staging', 'publishing']),
  runId: z.string(),
  // The run's current-version label. Shard paths are relative to it, so the replay must resolve
  // them exactly as the staging writes did — never re-derive it from the index.
  version: z.string(),
  pages: z.array(stagedPageRecordSchema).default([]),
  // The index the publish replay commits LAST. Recorded only when phase flips to 'publishing', so
  // its presence is exactly "a publish was started and may not have finished".
  index: manifestIndexSchema.optional()
});

export type StagedRunState = z.infer<typeof stagedRunStateSchema>;

// The staged work is only reusable while the world it was generated against is unchanged. The
// fingerprint covers the config/IA the plan came from and a content fingerprint of every source
// file the run parsed or hashed — so a freeze followed by an immediate rerun reuses everything
// (nothing re-billed), while any source edit in between invalidates the staging area wholesale.
// Per-page invalidation is the typed-fingerprint ladder's job (pipeline-v2 decision 4), not this.
export const planFingerprint = (input: {
  configHash: string;
  iaHash: string;
  docstubeVersion: string;
  locale: string;
  targetLocales: readonly string[];
  version: string;
  sourceFingerprint: unknown;
}): string =>
  hashValue({
    configHash: input.configHash,
    iaHash: input.iaHash,
    docstubeVersion: input.docstubeVersion,
    locale: input.locale,
    targetLocales: [...input.targetLocales],
    version: input.version,
    source: hashValue(input.sourceFingerprint)
  });

// Every state write goes temp-file + rename: the marker that decides whether a publish is in
// flight must never be readable in a half-written state.
const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
  await rename(temporary, path);
};

export const readStagedRun = async (repoRoot: string): Promise<StagedRunState | undefined> => {
  let text: string;
  try {
    text = await readFile(stagingStatePath(repoRoot), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  // A staging area that cannot be read is not evidence of anything — it is machine-local,
  // rebuildable state, so it is discarded (the work is regenerated) rather than crashing a run.
  const parsed = stagedRunStateSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : undefined;
};

export const discardStaging = async (repoRoot: string): Promise<void> => {
  await rm(stagingDir(repoRoot), { recursive: true, force: true });
};

// The site emission step, injected. Core cannot depend on @docstube/theme (ARCHITECTURE §2), so
// the CLI hands the publisher the one function that renders routes/twins from a manifest index.
// It is called INSIDE the publish replay, between the shard writes and the index write, so routes
// and shards land together and the index still commits last.
export type SitePublisher = (input: { index: ManifestIndex }) => Promise<void>;

export type PublishResult = {
  // Shard files the index write reconciled away, relative to `.docstube/manifest/`.
  pruned: string[];
};

export type StagedArtifactInput = {
  kind: 'source' | 'translation';
  shard: PageShard;
  // Absent for a failed translation: the shard (with its flags) stages, the MDX does not.
  artifact?: PageArtifact | undefined;
  status: 'passed' | 'flagged';
  findings: Finding[];
  attempts?: number | undefined;
};

export type PublishStaging = {
  // The staging manifest store — same ManifestStore contract, rooted under `.docstube/staging/`.
  // Everything the run would have written to the committed manifest writes here instead.
  store: ManifestStore;
  // Staged pages from a PREVIOUS frozen run of this same plan, by `<kind> <locale> <slug>`.
  // Empty when there was nothing to resume or the plan fingerprint moved.
  // A source page a PREVIOUS frozen run of this same plan already completed, if any. Undefined when
  // there was nothing to resume or the plan fingerprint moved. Key construction lives here, never
  // in the caller — two spellings of the same key is how a resume silently stops resuming.
  resumableSourcePage: (slug: string) => StagedPageRecord | undefined;
  // Its already-staged locale renditions, so a resumed page carries its translations with it.
  resumableTranslations: (slug: string) => StagedPageRecord[];
  // Reads a resumable page's staged MDX bytes back.
  readStagedMdx: (record: StagedPageRecord) => Promise<string | undefined>;
  stagePage: (input: StagedArtifactInput) => Promise<void>;
  records: () => StagedPageRecord[];
  // THE COMMIT POINT. Flips the staging area to 'publishing' (so an interruption is recoverable),
  // then replays the publish in the fixed order below and clears staging on success.
  publish: (input: { index: ManifestIndex; publishSite?: SitePublisher | undefined }) => Promise<PublishResult>;
  discard: () => Promise<void>;
};

const resumeKey = (record: { kind: string; locale: string; slug: string }): string =>
  `${record.kind} ${record.locale} ${record.slug}`;

// The ordered replay. Idempotent by construction — every step rewrites the same bytes from the
// same staging area — which is what makes finishing an interrupted publish forward safe.
const replayPublish = async (input: {
  repoRoot: string;
  outDir: string;
  store: ManifestStore;
  state: StagedRunState;
  publishSite?: SitePublisher | undefined;
}): Promise<PublishResult> => {
  const { repoRoot, state } = input;
  const index = state.index;
  if (index === undefined) {
    throw new CoreError(
      'state-corrupt',
      `the staged run ${state.runId} is marked as publishing but records no manifest index — it cannot be finished ` +
        'or trusted. Delete `.docstube/staging/` and re-run `docstube generate`.',
      { repoRoot, runId: state.runId }
    );
  }
  const stagingStore = createManifestStore(repoRoot, state.version, { manifestDir: stagingManifestDir(repoRoot) });

  // 1. Page MDX — the canonical bytes every route and every binding hash is derived from.
  for (const record of state.pages) {
    if (record.mdxPath === undefined) {
      continue;
    }
    const target = join(repoRoot, input.outDir, record.mdxPath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(stagingOutDir(repoRoot), record.mdxPath), target);
  }

  // 2. Shards — through the store, never around it, so validation and canonical serialization are
  // exactly what every other writer gets.
  for (const record of state.pages) {
    const shard = await stagingStore.readPageShard({ locale: record.locale, pageId: record.pageId });
    if (shard === undefined) {
      throw new CoreError(
        'state-corrupt',
        `the staged run ${state.runId} lists page ${record.pageId} (${record.locale}) but its staged shard is ` +
          'missing — publishing it would record an index that outruns the shards on disk. Delete ' +
          '`.docstube/staging/` and re-run `docstube generate`.',
        { repoRoot, pageId: record.pageId, locale: record.locale }
      );
    }
    await input.store.writePageShard(shard);
  }

  // 3. Routes, twins, and the rest of the emitted site — rendered against the STAGED index (passed
  // in memory), because the committed index does not describe this state yet and must not until
  // every file it advertises exists.
  await input.publishSite?.({ index });

  // 4. THE INDEX, LAST. Everything it names is already on disk, so a partial publish can never
  // advertise a page that is not there. writeIndex also reconciles the committed shard tree — the
  // integrity work stays in the store.
  const { pruned } = await input.store.writeIndex(index);

  // 5. Only now is the staged work redundant.
  await discardStaging(repoRoot);
  return { pruned };
};

// Called at the START of every run, before anything reads the committed manifest. A staging area
// left in the 'publishing' phase means a previous publish replay was interrupted: the published
// tree may hold new page bytes and routes while the index still describes the previous state.
//
// FINISH FORWARD, never discard: the staging area is complete (a publish only starts once the plan
// completed), and the replay is idempotent, so re-running it is a byte-for-byte completion of the
// publish that was already committed to. Discarding instead would require a snapshot of the prior
// published tree, which nothing writes.
//
// THE FAILURE WINDOW, stated honestly: between the first published byte and the index rename, a
// reader looking at `<outDir>/src/pages/**` directly (an Astro dev server already running, say)
// can see new routes while `.docstube/manifest/manifest.json` still describes the previous state.
// Everything that goes THROUGH the manifest — status, the local UI, the CI decision, the next
// generate — still sees the previous state, and the window closes on the next `generate`.
export const finishInterruptedPublish = async (input: {
  repoRoot: string;
  outDir: string;
  store: ManifestStore;
  publishSite?: SitePublisher | undefined;
}): Promise<{ recovered: boolean; runId?: string; pruned: string[] }> => {
  const state = await readStagedRun(input.repoRoot);
  if (state === undefined || state.phase !== 'publishing') {
    return { recovered: false, pruned: [] };
  }
  const { pruned } = await replayPublish({ ...input, state });
  return { recovered: true, runId: state.runId, pruned };
};

export const interruptedPublishFinding = (runId: string): Finding => ({
  source: 'verifier',
  check: 'staged-publish',
  severity: 'info',
  message:
    `a previous publish (run ${runId}) was interrupted part-way through: the staged work was still complete, so it ` +
    'was replayed to completion before this run started. The published tree and the manifest index now describe the ' +
    'same state again'
});

// Opens (or resumes) the staging area for a run. A staged plan whose fingerprint still matches is
// RESUMED — its pages are reused verbatim, so a frozen run's completed work is never re-billed.
// Anything else is discarded: stale staged pages describe a source tree that no longer exists.
export const openPublishStaging = async (input: {
  repoRoot: string;
  outDir: string;
  runId: string;
  version: string;
  // The source locale, so resumable-page lookups are addressed the same way they were staged.
  sourceLocale: string;
  planFingerprint: string;
  publishedStore: ManifestStore;
}): Promise<PublishStaging> => {
  const sourceLocale = input.sourceLocale;
  const { repoRoot } = input;
  const existing = await readStagedRun(repoRoot);
  const resumed =
    existing !== undefined && existing.phase === 'staging' && existing.planFingerprint === input.planFingerprint
      ? existing
      : undefined;
  if (existing !== undefined && resumed === undefined) {
    await discardStaging(repoRoot);
  }

  const records: StagedPageRecord[] = resumed === undefined ? [] : [...resumed.pages];
  const resumable = new Map(records.map((record) => [resumeKey(record), record]));
  const store = createManifestStore(repoRoot, input.version, { manifestDir: stagingManifestDir(repoRoot) });

  const persistState = async (state: Partial<StagedRunState> = {}): Promise<StagedRunState> => {
    const next = stagedRunStateSchema.parse({
      schemaVersion: 1,
      planFingerprint: input.planFingerprint,
      phase: 'staging',
      runId: input.runId,
      version: input.version,
      pages: records,
      ...state
    });
    await writeJsonAtomic(stagingStatePath(repoRoot), next);
    return next;
  };
  // Recorded up front so a run that dies before its first page still leaves a well-formed staging
  // area (which the next run then discards on fingerprint mismatch, or resumes as empty).
  await persistState();

  return {
    store,
    resumableSourcePage: (slug) => resumable.get(resumeKey({ kind: 'source', locale: sourceLocale, slug })),
    resumableTranslations: (slug) =>
      [...resumable.values()].filter((record) => record.kind === 'translation' && record.slug === slug),
    readStagedMdx: async (record) => {
      if (record.mdxPath === undefined) {
        return undefined;
      }
      try {
        return await readFile(join(stagingOutDir(repoRoot), record.mdxPath), 'utf8');
      } catch {
        return undefined;
      }
    },
    stagePage: async ({ kind, shard, artifact, status, findings, attempts }) => {
      await store.writePageShard(shard);
      if (artifact !== undefined) {
        const target = join(stagingOutDir(repoRoot), artifact.mdxPath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, artifact.mdx, 'utf8');
      }
      const record = stagedPageRecordSchema.parse({
        kind,
        locale: shard.locale,
        slug: shard.page.slug,
        pageId: shard.page.id,
        ...(artifact === undefined ? {} : { mdxPath: artifact.mdxPath }),
        status,
        findings,
        ...(attempts === undefined ? {} : { attempts })
      });
      const index = records.findIndex((entry) => resumeKey(entry) === resumeKey(record));
      if (index === -1) {
        records.push(record);
      } else {
        records[index] = record;
      }
      await persistState();
    },
    records: () => [...records],
    publish: async ({ index, publishSite }) => {
      const state = await persistState({ phase: 'publishing', index });
      return replayPublish({ repoRoot, outDir: input.outDir, store: input.publishedStore, state, publishSite });
    },
    discard: () => discardStaging(repoRoot)
  };
};
