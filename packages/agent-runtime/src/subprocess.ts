import { spawn } from 'node:child_process';

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

export const runSubprocess: SubprocessRunner = (request) =>
  new Promise((resolveProcess, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env ? { ...process.env, ...request.env } : process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
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
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 500).unref();
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

    if (request.input !== undefined) {
      child.stdin.end(request.input);
    } else {
      child.stdin.end();
    }
  });
