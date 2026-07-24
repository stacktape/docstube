import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TRPCError, initTRPC } from '@trpc/server';
import { z } from 'zod';
import type {
  AgentTaskSpec,
  Codemap,
  DocstubeConfigInput,
  Flag,
  Ia,
  ManifestIndex,
  PageShard,
  PageStatus,
  RunEvent,
  ToolDescriptor,
  Transcript
} from '@docstube/contracts';
import {
  entityAddressSchema,
  flagIdSchema,
  iaSchema,
  localeCodeSchema,
  pageIdSchema,
  runEventSchema,
  versionLabelSchema
} from '@docstube/contracts';
import { loadConfigFamily } from '../config/config-io.ts';
import { scaffoldConfigFamily, updateConfigValues, writeIaFile } from '../config/write-config.ts';
import { detectProject } from '../detect/detect-project.ts';
import { suggestPersonas } from '../detect/personas.ts';
import { CoreError } from '../errors.ts';
import { buildExtractThemeTokensTask, tokensFromTranscript } from '../pipeline/extract-theme-tokens.ts';
import { buildProposeIaTask, proposalsFromTranscript } from '../pipeline/propose-ia.ts';
import { applyFlagAnswers } from '../pipeline/tribal-knowledge.ts';
import type { ManifestStore } from '../state/manifest-store.ts';
import { createManifestStore } from '../state/manifest-store.ts';
import { runsDir, summarizeRun } from '../state/run-journal.ts';
import {
  appendFeedbackEntry,
  buildCategorizeFeedbackTask,
  categorizationFromTranscript,
  feedbackCategories
} from './feedback.ts';

// The local control plane API (PRODUCT §3.9). Read procedures are pure views over the run journal
// and the committed manifest; write procedures cover the wizard (config/ia/scaffold/theme), the
// flag queue (answer/dismiss) and the review UI (entity-anchored feedback). Anything that needs an
// agent goes through the injected task runner — when the host did not inject one, those mutations
// fail with a clean "agent runner not configured" error the UI can show.

// `refresh` is removed (pipeline-v2 decision 1): generate is the one reconciling run mode.
export type RunMode = 'generate' | 'refine';

// Same shape as the pipeline TaskRunner minus extraTools — kept local so the server never imports
// from the pipeline entry files owned by the generation workstream.
export type ControlPlaneTaskRunner = (spec: AgentTaskSpec) => Promise<Transcript>;

// Injected by the CLI wizard command (or tests); every field is optional so a read-only control
// plane still works without any agent/pipeline wiring.
export type ControlPlaneInjection = {
  runTask?: ControlPlaneTaskRunner | undefined;
  // The standard read tools handed to repo-inspecting tasks (theme extraction).
  toolDescriptors?: ToolDescriptor[] | undefined;
  codemapProvider?: (() => Promise<Codemap>) | undefined;
  // Fire-and-forget run launcher: returns the run id immediately, the run continues in the host.
  launchRun?: ((mode: RunMode) => Promise<{ runId: string }>) | undefined;
};

export type ControlPlaneContext = { repoRoot: string } & ControlPlaneInjection;

const t = initTRPC.context<ControlPlaneContext>().create();

// Run ids double as directory names under .docstube/runs/ — reject anything path-shaped.
const runIdInputSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, 'expected a run id');

const parseJournalLine = (line: string): RunEvent | undefined => {
  try {
    return runEventSchema.parse(JSON.parse(line)) as RunEvent;
  } catch {
    return undefined;
  }
};

const readJournalLines = async (repoRoot: string, runId: string): Promise<string[]> => {
  let text: string;
  try {
    text = await readFile(join(runsDir(repoRoot), runId, 'journal.jsonl'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return text.split('\n').filter((line) => line.length > 0);
};

const readJournalEvents = async (repoRoot: string, runId: string): Promise<RunEvent[]> => {
  const lines = await readJournalLines(repoRoot, runId);
  const events: RunEvent[] = [];
  for (const line of lines) {
    const event = parseJournalLine(line);
    if (event === undefined) {
      throw new CoreError('state-corrupt', `run ${runId} has a corrupt journal line`, { runId });
    }
    events.push(event);
  }
  return events;
};

export type RunListEntry = {
  runId: string;
  eventCount: number;
  startedAt: string | undefined;
  updatedAt: string | undefined;
  mode: string | undefined;
  commit: string | undefined;
  outcome: 'running' | 'passed' | 'flagged' | 'frozen' | 'failed';
};

// Head/tail parse only — the runs list must stay cheap even with large journals.
const listRuns = async (repoRoot: string): Promise<RunListEntry[]> => {
  let entries: Dirent[];
  try {
    entries = await readdir(runsDir(repoRoot), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const runs: RunListEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const lines = await readJournalLines(repoRoot, entry.name);
    const head = lines[0] === undefined ? undefined : parseJournalLine(lines[0]);
    const tailLine = lines[lines.length - 1];
    const tail = tailLine === undefined ? undefined : parseJournalLine(tailLine);
    runs.push({
      runId: entry.name,
      eventCount: lines.length,
      startedAt: head?.at,
      updatedAt: tail?.at,
      mode: head?.type === 'run-started' ? head.mode : undefined,
      commit: head?.type === 'run-started' ? head.commit : undefined,
      outcome: tail?.type === 'run-completed' ? tail.outcome : 'running'
    });
  }
  runs.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return runs;
};

const readManifestIndex = async (repoRoot: string): Promise<ManifestIndex | undefined> =>
  createManifestStore(repoRoot, 'latest').readIndex();

const currentVersionOf = (index: ManifestIndex): string =>
  index.versions.find((version) => version.status === 'current')?.label ?? 'latest';

export type FlagQueueEntry = {
  flag: Flag;
  scope: 'page' | 'system';
  locale?: string;
  pageId?: string;
  pageTitle?: string;
};

// The flag queue is a derived view (ARCHITECTURE.md §5.1): fold entity-scoped flags out of every
// current page shard plus the system-level flags from the manifest index.
const listFlags = async (repoRoot: string): Promise<FlagQueueEntry[]> => {
  const index = await readManifestIndex(repoRoot);
  if (index === undefined) {
    return [];
  }
  const store = createManifestStore(repoRoot, currentVersionOf(index));
  const flagEntries: FlagQueueEntry[] = index.systemFlags.map((flag) => ({ flag, scope: 'system' as const }));
  const locales = [...new Set([index.sourceLocale, ...index.locales])];
  for (const locale of locales) {
    for (const pageId of await store.listShardPageIds(locale)) {
      const shard = await store.readPageShard({ locale, pageId });
      if (shard === undefined) {
        continue;
      }
      for (const flag of shard.flags) {
        flagEntries.push({ flag, scope: 'page', locale, pageId: shard.page.id, pageTitle: shard.page.title });
      }
    }
  }
  flagEntries.sort((a, b) => b.flag.createdAt.localeCompare(a.flag.createdAt));
  return flagEntries;
};

const notConfigured = (capability: string): TRPCError =>
  new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: `agent runner not configured — ${capability} is unavailable in this control plane session`
  });

const requireRunTask = (ctx: ControlPlaneContext): ControlPlaneTaskRunner => {
  if (ctx.runTask === undefined) {
    throw notConfigured('running agent tasks');
  }
  return ctx.runTask;
};

const requireCodemap = async (ctx: ControlPlaneContext): Promise<Codemap> => {
  if (ctx.codemapProvider === undefined) {
    throw notConfigured('reading the codemap');
  }
  return ctx.codemapProvider();
};

// CoreError -> transport error at the procedure boundary; the UI keys off the HTTP-ish codes.
const mapCoreError = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CoreError && error.code === 'config-missing') {
      throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
    }
    if (error instanceof CoreError && error.code === 'config-invalid') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    }
    throw error;
  }
};

type LocatedFlag =
  | { scope: 'page'; store: ManifestStore; shard: PageShard; flag: Flag }
  | { scope: 'system'; store: ManifestStore; index: ManifestIndex; flag: Flag };

// Flags live either in a page shard (any locale, current version) or in the manifest index
// (system scope) — the queue is a derived view, so mutations go back to the owning file.
const locateFlag = async (repoRoot: string, flagId: string): Promise<LocatedFlag | undefined> => {
  const index = await readManifestIndex(repoRoot);
  if (index === undefined) {
    return undefined;
  }
  const store = createManifestStore(repoRoot, currentVersionOf(index));
  const systemFlag = index.systemFlags.find((flag) => flag.id === flagId);
  if (systemFlag !== undefined) {
    return { scope: 'system', store, index, flag: systemFlag };
  }
  for (const locale of new Set([index.sourceLocale, ...index.locales])) {
    for (const pageId of await store.listShardPageIds(locale)) {
      const shard = await store.readPageShard({ locale, pageId });
      const flag = shard?.flags.find((entry) => entry.id === flagId);
      if (shard !== undefined && flag !== undefined) {
        return { scope: 'page', store, shard, flag };
      }
    }
  }
  return undefined;
};

const writeFlagUpdate = async (repoRoot: string, located: LocatedFlag, updated: Flag): Promise<Flag> => {
  if (located.scope === 'system') {
    await located.store.writeIndex({
      ...located.index,
      systemFlags: located.index.systemFlags.map((flag) => (flag.id === updated.id ? updated : flag))
    });
    return updated;
  }
  await located.store.writePageShard({
    ...located.shard,
    flags: located.shard.flags.map((flag) => (flag.id === updated.id ? updated : flag))
  });
  // Persist answered tribal-knowledge flags to .docstube/knowledge/ immediately (instead of
  // waiting for the next run) — the answer becomes durable writer context and the flag resolves.
  await applyFlagAnswers({
    repoRoot,
    store: located.store,
    locales: [located.shard.locale],
    pageIds: [located.shard.page.id]
  });
  const reread = await located.store.readPageShard({ locale: located.shard.locale, pageId: located.shard.page.id });
  return reread?.flags.find((flag) => flag.id === updated.id) ?? updated;
};

export const controlPlaneRouter = t.router({
  runs: t.router({
    list: t.procedure.query(({ ctx }) => listRuns(ctx.repoRoot)),
    events: t.procedure
      .input(z.object({ runId: runIdInputSchema }))
      .query(({ ctx, input }) => readJournalEvents(ctx.repoRoot, input.runId)),
    summary: t.procedure.input(z.object({ runId: runIdInputSchema })).query(async ({ ctx, input }) => {
      const summary = summarizeRun(await readJournalEvents(ctx.repoRoot, input.runId));
      // Maps do not survive JSON serialization — flatten to records for the wire.
      return {
        outcome: summary.outcome,
        pageStatus: Object.fromEntries(summary.pageStatus) as Record<string, PageStatus>,
        completedStageInputs: Object.fromEntries(summary.completedStageInputs) as Record<string, string>
      };
    }),
    // Fire-and-forget: the injected launcher starts the pipeline in the host process and returns
    // the run id; the dashboard then follows it through runs.events/runs.summary.
    start: t.procedure.input(z.object({ mode: z.enum(['generate', 'refine']) })).mutation(async ({ ctx, input }) => {
      if (ctx.launchRun === undefined) {
        throw notConfigured('starting runs');
      }
      return ctx.launchRun(input.mode);
    })
  }),
  manifest: t.router({
    index: t.procedure.query(async ({ ctx }) => (await readManifestIndex(ctx.repoRoot)) ?? null),
    page: t.procedure
      .input(z.object({ locale: localeCodeSchema, pageId: pageIdSchema, version: versionLabelSchema.optional() }))
      .query(async ({ ctx, input }) => {
        const index = await readManifestIndex(ctx.repoRoot);
        if (index === undefined) {
          return null;
        }
        const store = createManifestStore(ctx.repoRoot, currentVersionOf(index));
        return (await store.readPageShard(input)) ?? null;
      })
  }),
  flags: t.router({
    list: t.procedure.query(({ ctx }) => listFlags(ctx.repoRoot)),
    answer: t.procedure
      .input(z.object({ flagId: flagIdSchema, text: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const located = await locateFlag(ctx.repoRoot, input.flagId);
        if (located === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `flag ${input.flagId} not found` });
        }
        return writeFlagUpdate(ctx.repoRoot, located, {
          ...located.flag,
          status: 'answered',
          answer: { text: input.text, answeredAt: new Date().toISOString(), author: 'local-ui' }
        });
      }),
    dismiss: t.procedure.input(z.object({ flagId: flagIdSchema })).mutation(async ({ ctx, input }) => {
      const located = await locateFlag(ctx.repoRoot, input.flagId);
      if (located === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `flag ${input.flagId} not found` });
      }
      return writeFlagUpdate(ctx.repoRoot, located, { ...located.flag, status: 'dismissed' });
    })
  }),
  feedback: t.router({
    // Review-UI intake (PRODUCT §3.9.4): explicit category routes directly; otherwise the
    // categorizer task decides and refines the wording. Either way the entry lands in a committed
    // learning file with the entity address as a durable anchor.
    submit: t.procedure
      .input(
        z.object({
          entity: entityAddressSchema,
          text: z.string().min(1),
          category: z.enum(feedbackCategories).optional()
        })
      )
      .mutation(async ({ ctx, input }) => {
        const warnings: string[] = [];
        let category = input.category;
        let text = input.text;
        if (category === undefined) {
          const runTask = requireRunTask(ctx);
          const transcript = await runTask(buildCategorizeFeedbackTask({ text: input.text, entity: input.entity }));
          const categorization = categorizationFromTranscript(transcript);
          category = categorization.category;
          text = categorization.refined ?? input.text;
          warnings.push(...categorization.warnings);
        }
        const { file } = await appendFeedbackEntry(ctx.repoRoot, { category, entity: input.entity, text });
        return { category, file, text, warnings };
      })
  }),
  config: t.router({
    // Parsed intent only — never the environment, never secrets (secrets are banned from config
    // by contract; this procedure still never widens beyond the parsed schema output).
    family: t.procedure.query(async ({ ctx }) => {
      try {
        const family = await loadConfigFamily(ctx.repoRoot);
        return { config: family.config, ia: family.ia, glossary: family.glossary };
      } catch (error) {
        if (error instanceof CoreError && error.code === 'config-missing') {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
        }
        throw error;
      }
    }),
    // Batched comment-preserving writes; rejects atomically when the result would be invalid.
    update: t.procedure
      .input(
        z.object({
          updates: z
            .array(z.object({ path: z.array(z.union([z.string(), z.number()])).min(1), value: z.unknown() }))
            .min(1)
        })
      )
      .mutation(({ ctx, input }) =>
        mapCoreError(() =>
          updateConfigValues(
            ctx.repoRoot,
            input.updates.map((update) => ({ path: update.path, value: update.value }))
          )
        )
      )
  }),
  ia: t.router({
    update: t.procedure
      .input(z.object({ ia: iaSchema }))
      .mutation(({ ctx, input }) => mapCoreError(() => writeIaFile(ctx.repoRoot, input.ia))),
    // The three wizard IA proposals (task-oriented / by-module / user-journey). Needs the injected
    // task runner + codemap provider; detection is deterministic and always available.
    propose: t.procedure.mutation(async ({ ctx }) => {
      const runTask = requireRunTask(ctx);
      const codemap = await requireCodemap(ctx);
      const family = await mapCoreError(() => loadConfigFamily(ctx.repoRoot));
      const detection = await detectProject(ctx.repoRoot);
      const transcript = await runTask(buildProposeIaTask({ codemap, config: family.config, detection }));
      return proposalsFromTranscript(transcript);
    })
  }),
  setup: t.router({
    // First-run scaffold; validates both files and refuses to overwrite existing ones.
    scaffold: t.procedure
      .input(z.object({ config: z.record(z.string(), z.unknown()), ia: z.record(z.string(), z.unknown()) }))
      .mutation(({ ctx, input }) =>
        mapCoreError(() =>
          scaffoldConfigFamily(ctx.repoRoot, {
            config: input.config as DocstubeConfigInput,
            ia: input.ia as unknown as Ia
          })
        )
      )
  }),
  detect: t.router({
    // Deterministic pre-fill for wizard steps 1-3 (never agent-based; ambiguous fields stay
    // undefined so the wizard shows them blank).
    project: t.procedure.query(async ({ ctx }) => {
      const detection = await detectProject(ctx.repoRoot);
      return {
        detection,
        suggestedPersonas: detection.docType === undefined ? [] : suggestPersonas(detection.docType)
      };
    })
  }),
  theme: t.router({
    // Wizard step 7 "Match my existing project": agent inspects Tailwind/CSS/token files and maps
    // them onto the docstube token vocabulary.
    extractTokens: t.procedure.mutation(async ({ ctx }) => {
      const runTask = requireRunTask(ctx);
      const task = await buildExtractThemeTokensTask({
        repoRoot: ctx.repoRoot,
        toolDescriptors: ctx.toolDescriptors ?? []
      });
      return tokensFromTranscript(await runTask(task));
    })
  })
});

export type ControlPlaneRouter = typeof controlPlaneRouter;

export const createControlPlaneCaller = t.createCallerFactory(controlPlaneRouter);
