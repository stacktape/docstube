import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageStatus, RunEvent } from '@docstube/contracts';
import { runEventSchema } from '@docstube/contracts';

// Append-only run journal (.docstube/runs/<runId>/journal.jsonl) — the source of truth for run
// state. Dashboard timelines and status views are pure folds over it; resume reads it back
// (PRODUCT §3.5, §3.9.3). Runs are machine-local, uploaded as CI artifacts for debugging.

// Plain Omit collapses a discriminated union to its common keys; distribute it instead.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type RunJournal = {
  runId: string;
  append: (event: DistributiveOmit<RunEvent, 'seq' | 'at' | 'runId'>) => Promise<RunEvent>;
  readAll: () => Promise<RunEvent[]>;
};

export const runsDir = (repoRoot: string): string => join(repoRoot, '.docstube', 'runs');

export const createRunJournal = async (repoRoot: string, runId: string): Promise<RunJournal> => {
  const dir = join(runsDir(repoRoot), runId);
  await mkdir(dir, { recursive: true });
  const journalPath = join(dir, 'journal.jsonl');
  let seq = 0;

  // Continue the sequence when resuming an existing run.
  try {
    const existing = await readFile(journalPath, 'utf8');
    const lines = existing.split('\n').filter((line) => line.length > 0);
    seq = lines.length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return {
    runId,
    append: async (partial) => {
      const event = runEventSchema.parse({
        ...partial,
        runId,
        seq,
        at: new Date().toISOString()
      }) as RunEvent;
      seq += 1;
      await appendFile(journalPath, `${JSON.stringify(event)}\n`, 'utf8');
      return event;
    },
    readAll: async () => {
      try {
        const text = await readFile(journalPath, 'utf8');
        return text
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => runEventSchema.parse(JSON.parse(line)) as RunEvent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }
        throw error;
      }
    }
  };
};

export type RunStatusSummary = {
  pageStatus: Map<string, PageStatus>;
  completedStageInputs: Map<string, string>;
  outcome: 'running' | 'passed' | 'flagged' | 'frozen' | 'failed';
};

// Pure fold over journal events — the same summary the dashboard renders.
export const summarizeRun = (events: RunEvent[]): RunStatusSummary => {
  const pageStatus = new Map<string, PageStatus>();
  const completedStageInputs = new Map<string, string>();
  let outcome: RunStatusSummary['outcome'] = 'running';
  for (const event of events) {
    if (event.type === 'page-status') {
      pageStatus.set(event.pageId, event.status);
    } else if (event.type === 'stage-completed') {
      completedStageInputs.set(`${event.stage}:${event.pageId ?? '<run>'}`, event.inputHash);
    } else if (event.type === 'run-completed') {
      outcome = event.outcome;
    }
  }
  return { pageStatus, completedStageInputs, outcome };
};
