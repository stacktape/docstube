import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SnippetRunResult } from '@docstube/plugin-sdk';
import { requirePythonInterpreter, runProcess } from './python-interpreter.ts';

// Executes a documentation snippet with the repo's python interpreter in a fresh temp cwd so it
// cannot litter the repo, with a hard timeout. Same sandbox honesty note as the snippet-exec
// verifier: the child still inherits the host environment and network access.
export const runSnippet = async (
  code: string,
  ctx: { repoRoot: string; timeoutMs: number }
): Promise<SnippetRunResult> => {
  const interpreter = await requirePythonInterpreter();
  const cwd = await mkdtemp(join(tmpdir(), 'docstube-py-snippet-'));
  try {
    // A real file (not `-c`) so tracebacks carry usable line numbers.
    const snippetPath = join(cwd, 'snippet.py');
    await writeFile(snippetPath, code, 'utf8');
    const run = await runProcess(interpreter, [snippetPath], { cwd, timeoutMs: ctx.timeoutMs });
    return { exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr, timedOut: run.timedOut };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
};
