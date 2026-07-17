import { describe, expect, it } from 'vitest';
import { runSubprocess } from './subprocess.ts';

const node = process.execPath;

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitForDeath = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessAlive(pid);
};

describe('runSubprocess', () => {
  it('captures stdout, stderr, and the exit code', async () => {
    const result = await runSubprocess({
      command: node,
      args: ['-e', 'console.log("out"); console.error("err"); process.exit(3);']
    });
    expect(result.stdout.trim()).toBe('out');
    expect(result.stderr.trim()).toBe('err');
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
  });

  it('delivers stdin input to the child', async () => {
    const result = await runSubprocess({
      command: node,
      args: ['-e', 'process.stdin.pipe(process.stdout);'],
      input: 'hello stdin'
    });
    expect(result.stdout).toBe('hello stdin');
    expect(result.exitCode).toBe(0);
  });

  it('settles normally when the child exits before consuming stdin (EPIPE)', async () => {
    // A large payload guarantees the write is still in flight when the child dies; without the
    // stdin error handler this crashes the process with an unhandled EPIPE.
    const result = await runSubprocess({
      command: node,
      args: ['-e', 'process.exit(7);'],
      input: 'x'.repeat(4_000_000)
    });
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it('kills the whole process tree on timeout, including grandchildren', async () => {
    // The child spawns a long-lived grandchild and prints its pid, then idles until the timeout.
    const script = [
      "const { spawn } = require('node:child_process');",
      "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });",
      'console.log(String(grandchild.pid));',
      'setInterval(() => {}, 1000);'
    ].join('\n');
    const result = await runSubprocess({ command: node, args: ['-e', script], timeoutMs: 2_000 });
    expect(result.timedOut).toBe(true);
    const grandchildPid = Number(result.stdout.trim());
    expect(Number.isInteger(grandchildPid)).toBe(true);
    expect(await waitForDeath(grandchildPid, 10_000)).toBe(true);
  }, 20_000);
});
