import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { idPrefixes, mintId } from '@docstube/contracts';
import { CoreError } from '../errors.ts';

// ONE RUN AT A TIME PER WORKSPACE.
//
// A run is not a pure function of the repo: it owns `.docstube/staging/` (a single shared mutable
// area with a phase machine — publish-staging.ts) and it writes the committed manifest store. Two
// runs in that area is exactly what staged-atomic publish cannot survive: they interleave staged
// pages under one `state.json`, and both can reach the publish replay, so the site can be published
// twice from two different plans. Double-clicking "start run" in the local UI, or running
// `docstube generate` in a terminal while the UI is open, is all it takes.
//
// THE GUARD IS A FILE, NOT A VARIABLE. In-memory tracking cannot see the other process, and two
// processes is the normal case (CLI + local UI). The lock is `.docstube/run.lock`, machine-local
// like `runs/` and `staging/` — gitignored, excluded from the output inventory and from the
// Action's commit-path selection, so it can never be committed or mark the tree dirty.
//
// ACQUISITION IS ONE ATOMIC STEP: `open(..., 'wx')` — O_CREAT|O_EXCL. Two processes racing there,
// one wins; there is no read-then-write window to lose.
//
// IT MUST SELF-HEAL. A `kill -9`d run leaves the file behind, and a lock nobody can clear would
// wedge the workspace forever — worse than the bug it prevents, because the repair path for an
// interrupted publish is THE NEXT RUN (publish-staging.ts §finish-forward). So a lock is taken over when it
// is stale, and the takeover is journaled by the caller rather than done silently. See
// `runLockStaleness` for the exact rule.

export const runLockRelativePath = '.docstube/run.lock';

export const runLockPath = (repoRoot: string): string => join(repoRoot, '.docstube', 'run.lock');

// The holder rewrites its own lock this often while the run is alive…
export const runLockHeartbeatMs = 5_000;

// …and a lock whose last heartbeat is older than this is presumed abandoned. Twelve missed beats:
// long enough that no live run is ever robbed of its lock by a slow moment, short enough that a
// crashed run on ANOTHER machine (where the pid check below means nothing) does not wedge a shared
// checkout for a coffee break. On the SAME machine — the case that actually happens — a dead pid is
// detected immediately and the age never matters.
export const runLockStaleMs = 60_000;

export const runLockRecordSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  mode: z.string().min(1),
  pid: z.number().int().positive(),
  // Whose pid that is. A pid from another machine is meaningless here, so the liveness probe is
  // only trusted when the host matches.
  host: z.string(),
  startedAt: z.string(),
  heartbeatAt: z.string()
});

export type RunLockRecord = z.infer<typeof runLockRecordSchema>;

// Why a lock was considered abandoned. Carried into the journal so a takeover is never silent.
export type RunLockStaleReason = 'dead-process' | 'heartbeat-expired' | 'unreadable';

const processIsAlive = (pid: number): boolean => {
  try {
    // Signal 0 tests for existence and permission without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists, this user simply does not own it. That is still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

// THE STALENESS RULE, in full:
//   1. an unparseable timestamp is stale — the record cannot be believed at all;
//   2. on THIS host, a pid that no longer exists is stale IMMEDIATELY (no waiting): the run that
//      held it is gone, and the next run is what repairs its interrupted publish;
//   3. otherwise (a live pid, or a lock written by another machine) the heartbeat decides: older
//      than `runLockStaleMs` means abandoned. This is what defends against pid reuse, a wedged
//      holder, and a crash on a host whose pids we cannot probe.
// A live pid with a fresh heartbeat is NEVER stale — a long agent run keeps its lock indefinitely.
export const runLockStaleness = (record: RunLockRecord, now: number = Date.now()): RunLockStaleReason | undefined => {
  const beat = Date.parse(record.heartbeatAt);
  if (Number.isNaN(beat)) {
    return 'unreadable';
  }
  if (record.host === hostname() && !processIsAlive(record.pid)) {
    return 'dead-process';
  }
  return now - beat > runLockStaleMs ? 'heartbeat-expired' : undefined;
};

export const readRunLock = async (repoRoot: string): Promise<RunLockRecord | undefined> => {
  let text: string;
  try {
    text = await readFile(runLockPath(repoRoot), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  try {
    return runLockRecordSchema.parse(JSON.parse(text));
  } catch {
    // A lock nobody can parse is not evidence of a live run — it is machine-local junk, and
    // treating it as authoritative would wedge the workspace on a truncated write.
    return undefined;
  }
};

const serialize = (record: RunLockRecord): string => `${JSON.stringify(record, undefined, 2)}\n`;

// Temp file + rename: a reader must never see a half-written lock, and rename is the only write
// that guarantees it. Used for the heartbeat and for a stale takeover — never for first acquisition,
// which has to be `wx` to be exclusive at all.
const replaceRecord = async (repoRoot: string, record: RunLockRecord): Promise<void> => {
  const path = runLockPath(repoRoot);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, serialize(record), 'utf8');
  await rename(temporary, path);
};

export type HeldRunLock = {
  record: RunLockRecord;
  // The lock this one replaced, when it was taken over from a process that is gone.
  tookOverFrom?: RunLockRecord | undefined;
  staleReason?: RunLockStaleReason | undefined;
  // MUST be called once the run and everything that trails it has settled — success or failure.
  // Idempotent, and it never deletes a lock some other run has since taken over.
  release: () => Promise<void>;
};

export type AcquireRunLockResult = { acquired: true; lock: HeldRunLock } | { acquired: false; holder: RunLockRecord };

const hold = (
  repoRoot: string,
  record: RunLockRecord,
  takeover: { tookOverFrom?: RunLockRecord | undefined; staleReason?: RunLockStaleReason | undefined }
): HeldRunLock => {
  let released = false;
  const beat = async (): Promise<void> => {
    if (released) {
      return;
    }
    try {
      const current = await readRunLock(repoRoot);
      if (current !== undefined && current.runId !== record.runId) {
        // Someone took this lock over. Stop pretending to hold it — rewriting the file here would
        // steal it back from a run that is legitimately going.
        released = true;
        clearInterval(timer);
        return;
      }
      await replaceRecord(repoRoot, { ...record, heartbeatAt: new Date().toISOString() });
    } catch {
      // A missed heartbeat is not fatal: the next one catches up, and a run that stops beating
      // entirely is exactly what the staleness rule is for.
    }
  };
  const timer = setInterval(() => void beat(), runLockHeartbeatMs);
  // Never keep the process alive for a heartbeat.
  timer.unref?.();
  return {
    record,
    ...takeover,
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      clearInterval(timer);
      const current = await readRunLock(repoRoot);
      if (current !== undefined && current.runId !== record.runId) {
        return;
      }
      await rm(runLockPath(repoRoot), { force: true });
    }
  };
};

export const acquireRunLock = async (input: {
  repoRoot: string;
  runId: string;
  mode: string;
}): Promise<AcquireRunLockResult> => {
  const path = runLockPath(input.repoRoot);
  await mkdir(dirname(path), { recursive: true });
  const now = new Date().toISOString();
  const record: RunLockRecord = {
    schemaVersion: 1,
    runId: input.runId,
    mode: input.mode,
    pid: process.pid,
    host: hostname(),
    startedAt: now,
    heartbeatAt: now
  };

  try {
    await writeFile(path, serialize(record), { flag: 'wx', encoding: 'utf8' });
    return { acquired: true, lock: hold(input.repoRoot, record, {}) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  const holder = await readRunLock(input.repoRoot);
  const staleReason = holder === undefined ? 'unreadable' : runLockStaleness(holder);
  if (holder !== undefined && staleReason === undefined) {
    return { acquired: false, holder };
  }

  // TAKEOVER. Two processes can find the same corpse at the same moment, so the rename is not the
  // decision — the read-back is. Both write, one record survives, and whoever does not see its own
  // run id backs off. rename is atomic, so the read can only ever return one whole record.
  await replaceRecord(input.repoRoot, record);
  const confirmed = await readRunLock(input.repoRoot);
  if (confirmed !== undefined && confirmed.runId !== record.runId) {
    return { acquired: false, holder: confirmed };
  }
  return {
    acquired: true,
    lock: hold(input.repoRoot, record, { ...(holder === undefined ? {} : { tookOverFrom: holder }), staleReason })
  };
};

export const runInProgressError = (holder: RunLockRecord): CoreError =>
  new CoreError(
    'run-in-progress',
    `another docstube run is already in flight in this workspace: run ${holder.runId} (${holder.mode}), started ` +
      `${holder.startedAt} by process ${holder.pid} on ${holder.host}. Runs share \`.docstube/staging/\` and the ` +
      'manifest store, so a second one would clobber the first and could publish the site twice — wait for it to ' +
      'finish, or stop that process (a lock left behind by a process that died is taken over automatically)',
    { runId: holder.runId, mode: holder.mode, pid: holder.pid, host: holder.host }
  );

export type RunLockHandle = {
  // The run id the workspace lock is held under. The run MUST be journaled under exactly this id,
  // or "what is running?" and "which run holds the lock?" answer differently.
  runId: string;
  release: () => Promise<void>;
};

export type ExclusiveRunStart = {
  runId: string;
  mode: string;
  // TRUE when THIS call started the pipeline. FALSE when a run was already in flight — `runId` is
  // then that run's id, so a double-click simply follows the run already going.
  started: boolean;
  // What was already running. Present only when `started` is false.
  alreadyRunning?: RunLockRecord;
  // Set when this start took a lock over from a process that is gone — surfaced so a takeover is
  // reported rather than silently assumed.
  tookOverFrom?: RunLockRecord;
  staleReason?: RunLockStaleReason;
};

// The one-run-at-a-time gate, shared by every start path (the control plane's `runs.start` and
// `setup.commit`, the wizard host, and the CLI run commands via `withRunLock`).
//
// IT RETURNS THE RUNNING RUN INSTEAD OF THROWING. A second start is not an error the user made —
// it is a double-click, or a browser tab they left open. Handing back the id of the run already
// going means every caller follows the same run without special-casing anything; `started: false`
// is what lets the UI say "a run was already going" instead of "your run started".
export const startExclusiveRun = async (input: {
  repoRoot: string;
  mode: string;
  runId?: string | undefined;
  // Called ONLY when the lock was acquired. Fire-and-forget by contract: it must return once the
  // run is launched, and call `handle.release()` when the run finally settles.
  launch: (handle: RunLockHandle) => Promise<unknown>;
}): Promise<ExclusiveRunStart> => {
  const runId = input.runId ?? mintId(idPrefixes.run);
  const result = await acquireRunLock({ repoRoot: input.repoRoot, runId, mode: input.mode });
  if (!result.acquired) {
    return { runId: result.holder.runId, mode: result.holder.mode, started: false, alreadyRunning: result.holder };
  }
  try {
    await input.launch({ runId, release: result.lock.release });
  } catch (error) {
    // A launcher that never started anything must not leave the workspace locked.
    await result.lock.release();
    throw error;
  }
  return {
    runId,
    mode: input.mode,
    started: true,
    ...(result.lock.tookOverFrom === undefined ? {} : { tookOverFrom: result.lock.tookOverFrom }),
    ...(result.lock.staleReason === undefined ? {} : { staleReason: result.lock.staleReason })
  };
};

// The blocking form, for callers that OWN the whole run in-process (the CLI `generate`/`refine`
// commands): the lock is held for the duration of `work` and always released. Contention here is a
// real error — a second CLI run cannot "follow" the first, it has nowhere to report to — so it
// throws the typed `run-in-progress` error the CLI prints verbatim.
export const withRunLock = async <T>(
  input: { repoRoot: string; mode: string; runId?: string | undefined },
  work: (handle: RunLockHandle) => Promise<T>
): Promise<T> => {
  const runId = input.runId ?? mintId(idPrefixes.run);
  const result = await acquireRunLock({ repoRoot: input.repoRoot, runId, mode: input.mode });
  if (!result.acquired) {
    throw runInProgressError(result.holder);
  }
  try {
    return await work({ runId, release: result.lock.release });
  } finally {
    await result.lock.release();
  }
};
