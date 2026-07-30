import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CoreError } from '../errors.ts';
import {
  acquireRunLock,
  readRunLock,
  runLockPath,
  runLockStaleMs,
  runLockStaleness,
  startExclusiveRun,
  withRunLock
} from './run-lock.ts';
import type { RunLockRecord } from './run-lock.ts';

// ONE RUN AT A TIME PER WORKSPACE (run-lock.ts). Runs share `.docstube/staging/` — a single mutable
// area with a phase machine — and the committed manifest store, so two of them interleave staged
// pages under one `state.json` and can both reach the publish replay. The guard has to be a FILE
// (two processes is the normal case: a CLI `generate` while the local UI is open) and it has to
// self-heal, because the repair path for a crashed run's interrupted publish is the NEXT run.

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-runlock-'));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

// A pid that is definitely gone: spawn a process that exits immediately, then confirm it is dead
// before the test leans on it (pids get reused, and a test that assumes otherwise is a flake).
const deadPid = (): number => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { pid } = spawnSync(process.execPath, ['-e', '']);
    if (pid !== undefined && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch {
        return pid;
      }
    }
  }
  throw new Error('could not obtain a pid that is definitely gone');
};

const plantLock = async (record: Partial<RunLockRecord> & { runId: string }): Promise<RunLockRecord> => {
  const now = new Date().toISOString();
  const full: RunLockRecord = {
    schemaVersion: 1,
    mode: 'generate',
    pid: process.pid,
    host: hostname(),
    startedAt: now,
    heartbeatAt: now,
    ...record
  };
  await mkdir(join(repoRoot, '.docstube'), { recursive: true });
  await writeFile(runLockPath(repoRoot), `${JSON.stringify(full, undefined, 2)}\n`, 'utf8');
  return full;
};

describe('the workspace run lock', () => {
  it('is exclusive: a second acquire while the first is held gets the HOLDER, not a lock', async () => {
    const first = await acquireRunLock({ repoRoot, runId: 'run_one', mode: 'generate' });
    expect(first.acquired).toBe(true);

    const second = await acquireRunLock({ repoRoot, runId: 'run_two', mode: 'refine' });
    expect(second.acquired).toBe(false);
    // The refusal names the run in flight — that is what lets a caller follow it instead of
    // starting a second pipeline against the same staging area.
    expect(second.acquired === false && second.holder.runId).toBe('run_one');
    expect(second.acquired === false && second.holder.mode).toBe('generate');

    if (first.acquired) {
      await first.lock.release();
    }
    const third = await acquireRunLock({ repoRoot, runId: 'run_three', mode: 'generate' });
    expect(third.acquired).toBe(true);
  });

  it('RESPECTS a live holder: an alive pid with a fresh heartbeat is never stale', async () => {
    // This process is, definitionally, alive.
    const holder = await plantLock({ runId: 'run_live' });
    expect(runLockStaleness(holder)).toBeUndefined();
    const attempt = await acquireRunLock({ repoRoot, runId: 'run_second', mode: 'generate' });
    expect(attempt.acquired).toBe(false);
    // Untouched: a live holder's record must not be rewritten by a failed acquire.
    expect((await readRunLock(repoRoot))?.runId).toBe('run_live');
  });

  it('TAKES OVER a lock left by a dead process, immediately — no waiting out a timeout', async () => {
    // The whole point: a `kill -9`d run must not wedge the workspace, because the next run is what
    // repairs its interrupted publish. The heartbeat here is FRESH, so only the dead-pid rule can
    // explain the takeover.
    const corpse = await plantLock({ runId: 'run_crashed', pid: deadPid() });
    expect(runLockStaleness(corpse)).toBe('dead-process');

    const attempt = await acquireRunLock({ repoRoot, runId: 'run_next', mode: 'generate' });
    expect(attempt.acquired).toBe(true);
    // The takeover is REPORTED, not silent — the caller journals what it stepped over.
    expect(attempt.acquired === true && attempt.lock.staleReason).toBe('dead-process');
    expect(attempt.acquired === true && attempt.lock.tookOverFrom?.runId).toBe('run_crashed');
    expect((await readRunLock(repoRoot))?.runId).toBe('run_next');
  });

  it('takes over a lock whose heartbeat expired even when the pid is alive (pid reuse, wedged holder)', async () => {
    const stalled = await plantLock({
      runId: 'run_stalled',
      heartbeatAt: new Date(Date.now() - runLockStaleMs - 60_000).toISOString()
    });
    expect(runLockStaleness(stalled)).toBe('heartbeat-expired');
    const attempt = await acquireRunLock({ repoRoot, runId: 'run_next', mode: 'generate' });
    expect(attempt.acquired).toBe(true);
    expect(attempt.acquired === true && attempt.lock.staleReason).toBe('heartbeat-expired');
  });

  it('takes over a lock nobody can parse — junk is not evidence of a live run', async () => {
    await mkdir(join(repoRoot, '.docstube'), { recursive: true });
    await writeFile(runLockPath(repoRoot), '{ this is not json', 'utf8');
    const attempt = await acquireRunLock({ repoRoot, runId: 'run_next', mode: 'generate' });
    expect(attempt.acquired).toBe(true);
    expect(attempt.acquired === true && attempt.lock.staleReason).toBe('unreadable');
  });

  it('release never deletes a lock some other run has since taken over', async () => {
    const mine = await acquireRunLock({ repoRoot, runId: 'run_mine', mode: 'generate' });
    // Someone decided ours was stale and took it. Releasing must not free THEIR lock.
    await plantLock({ runId: 'run_theirs' });
    if (mine.acquired) {
      await mine.lock.release();
    }
    expect((await readRunLock(repoRoot))?.runId).toBe('run_theirs');
  });

  it('never leaves the lock behind: withRunLock releases on success and on a thrown run', async () => {
    const seen = await withRunLock({ repoRoot, mode: 'generate' }, async (handle) => {
      expect((await readRunLock(repoRoot))?.runId).toBe(handle.runId);
      return handle.runId;
    });
    expect(seen).toMatch(/^run_/u);
    expect(await readRunLock(repoRoot)).toBeUndefined();

    await expect(
      withRunLock({ repoRoot, mode: 'generate' }, async () => {
        throw new Error('pipeline exploded');
      })
    ).rejects.toThrow('pipeline exploded');
    expect(await readRunLock(repoRoot)).toBeUndefined();
  });

  it('withRunLock REFUSES rather than following: a second CLI run has nowhere to report to', async () => {
    await plantLock({ runId: 'run_live', mode: 'refine' });
    const refused = await withRunLock({ repoRoot, mode: 'generate' }, async () => 'ran').then(
      () => undefined,
      (error: unknown) => error
    );
    expect(refused).toBeInstanceOf(CoreError);
    expect((refused as CoreError).code).toBe('run-in-progress');
    // The message has to be actionable on its own — it is printed verbatim by the CLI.
    expect((refused as CoreError).message).toContain('run_live');
    expect((refused as CoreError).message).toContain('refine');
    expect((refused as CoreError).details.runId).toBe('run_live');
  });

  it('the lock file stays machine-local: it is not committed state and never leaves this machine', async () => {
    const held = await acquireRunLock({ repoRoot, runId: 'run_local', mode: 'generate' });
    const raw = JSON.parse(await readFile(runLockPath(repoRoot), 'utf8')) as RunLockRecord;
    expect(raw.host).toBe(hostname());
    expect(raw.pid).toBe(process.pid);
    if (held.acquired) {
      await held.lock.release();
    }
  });
});

describe('startExclusiveRun', () => {
  it('launches ONE pipeline for two simultaneous starts and hands both the same run id', async () => {
    const launched: string[] = [];
    const release: Array<() => Promise<void>> = [];
    const start = () =>
      startExclusiveRun({
        repoRoot,
        mode: 'generate',
        launch: async (handle) => {
          launched.push(handle.runId);
          release.push(handle.release);
        }
      });

    const [one, two] = await Promise.all([start(), start()]);
    // Exactly one pipeline, and both callers point at it.
    expect(launched).toHaveLength(1);
    expect(one?.runId).toBe(two?.runId);
    expect(one?.runId).toBe(launched[0]);
    // …and they can TELL which of them started it. That is the whole difference between "your run
    // started" and "a run was already going, here it is".
    expect([one?.started, two?.started].toSorted()).toEqual([false, true]);
    const follower = one?.started === true ? two : one;
    expect(follower?.alreadyRunning?.runId).toBe(launched[0]);

    await release[0]?.();
  });

  it('does not leave the workspace locked when the launcher itself fails', async () => {
    await expect(
      startExclusiveRun({
        repoRoot,
        mode: 'generate',
        launch: async () => {
          throw new Error('could not build a task runner');
        }
      })
    ).rejects.toThrow('could not build a task runner');
    expect(await readRunLock(repoRoot)).toBeUndefined();
  });
});
