import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolvePythonInterpreter } from './python-interpreter.ts';
import { runSnippet } from './snippet-run.ts';

const ctx = {
  repoRoot: fileURLToPath(new URL('../test-fixtures/sample-lib', import.meta.url)),
  timeoutMs: 15_000
};

const pythonInterpreter = await resolvePythonInterpreter();
if (pythonInterpreter === undefined) {
  console.warn('lang-python snippet-run specs skipped: no python interpreter found on PATH');
}

describe.skipIf(pythonInterpreter === undefined)('runSnippet', () => {
  it('runs a printing snippet to exit code 0 with captured stdout', async () => {
    const result = await runSnippet('print("hello from python")\n', ctx);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('hello from python');
  });

  it('propagates explicit exit codes', async () => {
    const result = await runSnippet('raise SystemExit(3)\n', ctx);
    expect(result.exitCode).toBe(3);
  });

  it('reports raised exceptions as a non-zero exit with a traceback on stderr', async () => {
    const result = await runSnippet('raise ValueError("boom")\n', ctx);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('ValueError');
  });

  it('kills runaway snippets and marks the result as timed out', async () => {
    const result = await runSnippet('import time\ntime.sleep(30)\n', { ...ctx, timeoutMs: 2_000 });
    expect(result.timedOut).toBe(true);
  }, 20_000);
});
