import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export type SubprocessRequest = {
  command: string;
  args: string[];
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type SubprocessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export type SubprocessRunner = (request: SubprocessRequest) => Promise<SubprocessResult>;

// Vendor CLIs spawn their own children (our MCP stdio server); killing only the direct child on
// timeout orphans those grandchildren. On win32 taskkill /T walks the tree; on POSIX the child is
// spawned detached (its own process group) so kill(-pid) signals the whole group.
const killTree = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (child.pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {
      // Best-effort: the process may already be gone.
    });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
};

export const runSubprocess: SubprocessRunner = (request) =>
  new Promise((resolveProcess, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env ? { ...process.env, ...request.env } : process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timeout =
      request.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            killTree(child, 'SIGTERM');
            setTimeout(() => killTree(child, 'SIGKILL'), 500).unref();
          }, request.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolveProcess({ stdout, stderr, exitCode, timedOut });
    });

    // A child that exits before consuming stdin makes the write emit EPIPE; without a listener
    // that is an uncaught 'error' that crashes the harness. The 'close' handler still settles the
    // promise with the child's real exit code, so the error itself is safely swallowed.
    child.stdin.on('error', () => {});
    if (request.input !== undefined) {
      child.stdin.end(request.input);
    } else {
      child.stdin.end();
    }
  });
