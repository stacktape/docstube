import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRunLock, runLockPath } from '../state/run-lock.ts';
import type { RunLockHandle } from '../state/run-lock.ts';
import { createControlPlaneCaller } from './trpc-router.ts';

// TWO RUNS IN ONE WORKSPACE IS THE BUG (run-lock.ts). `runs.start` and `setup.commit` used to call
// the injected launcher with no guard at all: two clicks of "start run", or a commit landing while
// a first-run generate was still going, started two pipelines against the same
// `.docstube/staging/` area and the same manifest store. Staged-atomic publish cannot survive that
// — staging is ONE mutable area with a phase machine, and both writers can reach the publish
// replay. These tests pin the gate at the API boundary, where it is authoritative regardless of
// what the host injects.

let repoRoot: string;

const configInput = {
  schemaVersion: 1,
  docType: 'external-library',
  projectContext: 'A toolkit.',
  personas: [{ id: 'app-developer', description: 'Builds apps' }],
  agents: { transport: 'claude-cli', model: 'sonnet' },
  site: { title: 'Toolkit Docs' }
};
const iaInput = { schemaVersion: 1, tree: [{ title: 'Getting started', slug: 'getting-started', brief: 'Install.' }] };

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-run-concurrency-'));
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'toolkit', type: 'module' }), 'utf8');
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

// A launcher that behaves like the real one: it takes the run id the control plane minted, keeps
// the lock until the "run" is told to settle, and records every launch.
const recordingLauncher = () => {
  const launches: Array<{ mode: string; runId: string; release: () => Promise<void> }> = [];
  return {
    launches,
    launchRun: async (mode: string, handle: RunLockHandle) => {
      launches.push({ mode, runId: handle.runId, release: handle.release });
    },
    settleAll: async () => {
      for (const launch of launches) {
        await launch.release();
      }
    }
  };
};

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

const plantLock = async (input: { runId: string; mode: string; pid?: number }): Promise<void> => {
  const now = new Date().toISOString();
  await mkdir(join(repoRoot, '.docstube'), { recursive: true });
  await writeFile(
    runLockPath(repoRoot),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runId: input.runId,
        mode: input.mode,
        pid: input.pid ?? process.pid,
        host: hostname(),
        startedAt: now,
        heartbeatAt: now
      },
      undefined,
      2
    )}\n`,
    'utf8'
  );
};

describe('runs.start is one-run-at-a-time', () => {
  it('two simultaneous starts produce ONE pipeline and the SAME run id', async () => {
    const launcher = recordingLauncher();
    const caller = createControlPlaneCaller({ repoRoot, launchRun: launcher.launchRun });

    // The double-click, as the server sees it: two requests in flight at once.
    const [first, second] = await Promise.all([
      caller.runs.start({ mode: 'generate' }),
      caller.runs.start({ mode: 'generate' })
    ]);

    expect(launcher.launches).toHaveLength(1);
    expect(first.runId).toBe(second.runId);
    expect(first.runId).toBe(launcher.launches[0]?.runId);
    // Exactly one of them started it — and BOTH can say which, honestly.
    expect([first.started, second.started].toSorted()).toEqual([false, true]);
    const follower = first.started ? second : first;
    expect(follower.alreadyRunning?.runId).toBe(first.runId);
    expect(follower.alreadyRunning?.mode).toBe('generate');

    await launcher.settleAll();
  });

  it('a start while a run is in flight follows it instead of throwing', async () => {
    const launcher = recordingLauncher();
    const caller = createControlPlaneCaller({ repoRoot, launchRun: launcher.launchRun });
    const started = await caller.runs.start({ mode: 'generate' });

    // A THROWN ERROR WOULD BE THE WRONG ANSWER: a second click is not a mistake, and every client
    // would have to special-case an error that means "your run is already going".
    const followed = await caller.runs.start({ mode: 'refine' });
    expect(followed.started).toBe(false);
    expect(followed.runId).toBe(started.runId);
    // It reports the mode of the run that is ACTUALLY going, not the one that was asked for.
    expect(followed.mode).toBe('generate');
    expect(launcher.launches.map((launch) => launch.mode)).toEqual(['generate']);

    // Once the run settles, the workspace is free again.
    await launcher.settleAll();
    const next = await caller.runs.start({ mode: 'refine' });
    expect(next.started).toBe(true);
    expect(next.runId).not.toBe(started.runId);
    await launcher.settleAll();
  });

  it('reports what is running ACROSS processes — a CLI generate is visible to the UI', async () => {
    const caller = createControlPlaneCaller({ repoRoot, launchRun: async () => undefined });
    expect(await caller.runs.current()).toBeNull();

    // Not this process: a `docstube generate` in a terminal, holding the same workspace lock.
    await plantLock({ runId: 'run_from_the_cli', mode: 'generate' });
    const current = await caller.runs.current();
    expect(current?.runId).toBe('run_from_the_cli');
    expect(current?.mode).toBe('generate');

    const attempt = await caller.runs.start({ mode: 'generate' });
    expect(attempt.started).toBe(false);
    expect(attempt.runId).toBe('run_from_the_cli');
  });

  it('TAKES OVER a lock left by a crashed process rather than wedging the workspace forever', async () => {
    // A lock nobody can clear would be worse than the bug: the repair path for a crashed run's
    // interrupted publish IS the next run (finishInterruptedPublish), so it must be able to start.
    await plantLock({ runId: 'run_crashed', mode: 'generate', pid: deadPid() });
    const launcher = recordingLauncher();
    const caller = createControlPlaneCaller({ repoRoot, launchRun: launcher.launchRun });

    const started = await caller.runs.start({ mode: 'generate' });
    expect(started.started).toBe(true);
    expect(started.runId).not.toBe('run_crashed');
    expect(launcher.launches).toHaveLength(1);
    // The takeover is surfaced, never silent.
    expect(started.tookOverStaleLock).toEqual({
      runId: 'run_crashed',
      pid: expect.any(Number),
      reason: 'dead-process'
    });
    await launcher.settleAll();
  });
});

describe('setup.commit shares the same gate', () => {
  it('does not start a second pipeline while a run is in flight — but still writes the config', async () => {
    const launcher = recordingLauncher();
    const caller = createControlPlaneCaller({ repoRoot, launchRun: launcher.launchRun });
    // A first-run generate is already going (started from the wizard, or the CLI).
    const running = await caller.runs.start({ mode: 'generate' });

    const committed = await caller.setup.commit({ config: configInput, ia: iaInput });
    // The user's INTENT still lands — refusing to write the config would leave the repo half set
    // up, which is the failure the one-atomic-action design exists to prevent.
    expect(committed.configPath).toContain('docstube.yml');
    // …but no second pipeline. The commit follows the run already going.
    expect(launcher.launches).toHaveLength(1);
    expect(committed.runStarted).toBe(false);
    expect(committed.runId).toBe(running.runId);
    expect(committed.alreadyRunning?.runId).toBe(running.runId);

    await launcher.settleAll();
  });

  it('starts the run — and holds the lock for it — when nothing else is running', async () => {
    const launcher = recordingLauncher();
    const caller = createControlPlaneCaller({ repoRoot, launchRun: launcher.launchRun });
    const committed = await caller.setup.commit({ config: configInput, ia: iaInput });

    expect(committed.runStarted).toBe(true);
    expect(committed.alreadyRunning).toBeNull();
    expect(launcher.launches.map((launch) => launch.runId)).toEqual([committed.runId]);
    // The lock is HELD for the duration of the run, under the run's own id.
    expect((await readRunLock(repoRoot))?.runId).toBe(committed.runId);

    await launcher.settleAll();
    expect(await readRunLock(repoRoot)).toBeUndefined();
  });

  it('leaves nothing locked when no run was asked for', async () => {
    const launcher = recordingLauncher();
    const caller = createControlPlaneCaller({ repoRoot, launchRun: launcher.launchRun });
    const committed = await caller.setup.commit({ config: configInput, ia: iaInput, startRun: false });
    expect(committed.runId).toBeNull();
    expect(committed.runStarted).toBeNull();
    expect(launcher.launches).toHaveLength(0);
    expect(await readRunLock(repoRoot)).toBeUndefined();
  });
});
