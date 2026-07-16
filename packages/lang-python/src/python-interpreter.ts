import { spawn } from 'node:child_process';

// Documenting a Python repo implies Python is installed — that is the doctor-check contract.
// Extraction and snippet execution both go through this module so the missing-interpreter error
// is a single, clearly typed failure the caller can surface.
export class PythonInterpreterNotFoundError extends Error {
  constructor() {
    super('documenting a Python repo requires a python interpreter on PATH');
    this.name = 'PythonInterpreterNotFoundError';
  }
}

export type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export const runProcess = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill();
          }, options.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      reject(error);
    });
    child.on('close', (code) => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve({ exitCode: code ?? 1, stdout, stderr, timedOut });
    });
  });

// `python` first on Windows (python3 is usually only the Store alias there), `python3` first on
// POSIX (where bare `python` may be missing or Python 2). The Windows Store alias stub exits
// non-zero on `--version`, so it correctly falls through instead of being picked.
const interpreterCandidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];

const probeCandidates = async (): Promise<string | undefined> => {
  for (const candidate of interpreterCandidates) {
    try {
      const probe = await runProcess(candidate, ['--version'], { timeoutMs: 10_000 });
      if (probe.exitCode === 0 && !probe.timedOut) {
        return candidate;
      }
    } catch {
      // spawn error (ENOENT): candidate not on PATH.
    }
  }
  return undefined;
};

let cachedInterpreter: Promise<string | undefined> | undefined;

// Resolves once per process; extraction, snippet runs, and the spec-suite gate share the result.
export const resolvePythonInterpreter = (): Promise<string | undefined> => {
  cachedInterpreter ??= probeCandidates();
  return cachedInterpreter;
};

export const requirePythonInterpreter = async (): Promise<string> => {
  const interpreter = await resolvePythonInterpreter();
  if (interpreter === undefined) {
    throw new PythonInterpreterNotFoundError();
  }
  return interpreter;
};
