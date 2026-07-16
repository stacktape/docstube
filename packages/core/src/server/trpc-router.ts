import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TRPCError, initTRPC } from '@trpc/server';
import { z } from 'zod';
import type { Flag, ManifestIndex, PageStatus, RunEvent } from '@docstube/contracts';
import { localeCodeSchema, pageIdSchema, runEventSchema, versionLabelSchema } from '@docstube/contracts';
import { loadConfigFamily } from '../config/config-io.ts';
import { CoreError } from '../errors.ts';
import { createManifestStore } from '../state/manifest-store.ts';
import { runsDir, summarizeRun } from '../state/run-journal.ts';

// The local control plane API (PRODUCT §3.9). Every procedure in this wave is read-only: the
// generation dashboard and flag queue are pure views over the run journal and the committed
// manifest. Mutating procedures (wizard config writes, flag answers, review feedback) arrive with
// the wizard/review waves.

export type ControlPlaneContext = { repoRoot: string };

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
    list: t.procedure.query(({ ctx }) => listFlags(ctx.repoRoot))
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
    })
  })
});

export type ControlPlaneRouter = typeof controlPlaneRouter;

export const createControlPlaneCaller = t.createCallerFactory(controlPlaneRouter);
