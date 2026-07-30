import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// END-TO-END DISPATCH. Every other CLI test calls a command handler directly, which is exactly how
// `docstube generate` shipped a regression where the whole pipeline succeeded and the process then
// printed "Unknown command: generate", dumped help, and exited 1 — breaking every CI run. citty
// executes a parent command's `run` in ADDITION to the matched subcommand, and only a real argv
// plus a real exit code shows that. So these tests spawn the CLI the way a user, and the GitHub
// Action, does: argv in, exit code out.
//
// Nothing here calls an AI agent: commands run in an empty workspace with no docstube.yml, or are
// given an argument their own guard rejects before any work starts.

const cliEntry = fileURLToPath(new URL('./cli.ts', import.meta.url));
const workspaceDir = mkdtempSync(join(tmpdir(), 'docstube-cli-dispatch-'));

afterAll(() => {
  rmSync(workspaceDir, { force: true, recursive: true });
});

type CliRun = {
  exitCode: number | null;
  output: string;
};

const runCli = (...args: string[]): CliRun => {
  const result = spawnSync(execPath, ['--conditions=docstube-source', cliEntry, ...args], {
    cwd: workspaceDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      // No telemetry disclosure, no home-directory writes, no ANSI codes in the assertions.
      DO_NOT_TRACK: '1',
      NO_COLOR: '1',
      DOCSTUBE_UI_DEV_SERVER_URL: ''
    },
    windowsHide: true
  });
  return { exitCode: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

// The registry read back out of the running CLI. A hardcoded list here would drift the moment a
// command is added, and the point of this file is that EVERY registered command dispatches.
const registeredSubCommands = ((): string[] => {
  const usage = runCli('--help').output;
  const names = /^USAGE\s+docstube\s+\[OPTIONS\]\s+(?<names>\S+)/mu.exec(usage)?.groups?.names;
  return names === undefined ? [] : names.split('|');
})();

// Each entry runs the command for real and asserts the command itself produced the output. `expect`
// is a string only that command can print, so a silent fallthrough cannot pass.
const realDispatchCases = [
  { args: ['version'], expect: '0.0.2', exitCode: 0 },
  { args: ['help'], expect: 'Usage: docstube [command] [options]', exitCode: 0 },
  { args: ['help', 'generate'], expect: 'Usage: docstube generate', exitCode: 0 },
  // Rejected by each command's own argument guard, before it loads or does anything.
  { args: ['wizard', '--port', '99999'], expect: 'Invalid --port value: 99999', exitCode: 1 },
  { args: ['preview', '--port', '99999'], expect: 'Invalid --port value: 99999', exitCode: 1 },
  { args: ['generate', '--max-attempts', '0'], expect: 'Invalid --max-attempts value: 0', exitCode: 1 },
  { args: ['refine', '--max-pages', '0'], expect: 'Invalid --max-pages value: 0', exitCode: 1 },
  // Reach their module and stop at the missing config in the temp workspace.
  { args: ['status'], expect: 'docstube.yml not found', exitCode: 1 },
  { args: ['validate'], expect: 'docstube.yml not found', exitCode: 1 },
  { args: ['doctor'], expect: 'docstube.yml not found', exitCode: 1 },
  // Subcommands carrying their OWN positionals — the shape that used to reach the root handler and
  // get judged as an unknown command after the subcommand had already done its work.
  { args: ['check', 'links'], expect: 'docstube.yml not found', exitCode: 1 },
  { args: ['check', '--list'], expect: 'docstube.yml not found', exitCode: 1 },
  { args: ['refine', 'getting-started'], expect: 'docstube.yml not found', exitCode: 1 },
  { args: ['answer', 'flag-1', 'an answer'], expect: 'docstube.yml not found', exitCode: 1 },
  // Required positionals are reported against the subcommand, not the root.
  { args: ['plugin'], expect: 'docstube plugin', exitCode: 1 },
  { args: ['audit'], expect: 'docstube audit', exitCode: 1 }
] as const;

// `upgrade` is the one command with no offline entry point (it talks to the registry), so it is
// covered by usage only.
const usageOnlySubCommands = new Set(['upgrade']);

const timeout = 60_000;

describe('cli dispatch', () => {
  it('discovers the registered subcommands from the real CLI', () => {
    expect(registeredSubCommands).toContain('generate');
    expect(registeredSubCommands.length).toBeGreaterThan(10);
  });

  it.each(realDispatchCases)(
    '`docstube $args` exits $exitCode from the command itself',
    (testCase) => {
      const run = runCli(...testCase.args);
      expect({ exitCode: run.exitCode, matched: run.output.includes(testCase.expect) }).toEqual({
        exitCode: testCase.exitCode,
        matched: true
      });
      // The regression in one assertion: a dispatched command must never be reported as unknown.
      expect(run.output).not.toContain('Unknown command');
    },
    timeout
  );

  it.each(registeredSubCommands)(
    '`docstube %s --help` renders usage and exits 0',
    (name) => {
      const run = runCli(name, '--help');
      expect({ name, exitCode: run.exitCode, unknown: run.output.includes('Unknown command') }).toEqual({
        name,
        exitCode: 0,
        unknown: false
      });
    },
    timeout
  );

  // Guards against a new command being added with no end-to-end dispatch test at all.
  it('runs every registered subcommand for real', () => {
    const exercised = new Set<string>(realDispatchCases.map((testCase) => testCase.args[0]));
    const missing = registeredSubCommands.filter((name) => !exercised.has(name) && !usageOnlySubCommands.has(name));
    expect(missing).toEqual([]);
  });
});

describe('cli dispatch: bare invocation and flags', () => {
  // Bare `docstube` opens the local control plane (PRODUCT §3.9.1). An out-of-range port proves the
  // bare path reached control-plane argument handling without starting a server.
  it('routes bare flags to the control plane, never to a command lookup', { timeout }, () => {
    const run = runCli('--port', '99999');
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain('Invalid --port value: 99999');
    expect(run.output).not.toContain('Unknown command');
  });

  it('treats --no-open as a flag, never as a command', { timeout }, () => {
    const run = runCli('--no-open', '--port', '99999');
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain('Invalid --port value: 99999');
    expect(run.output).not.toContain('Unknown command');
  });
});

describe('cli dispatch: unknown commands', () => {
  it('rejects a typo instead of opening the control plane', { timeout }, () => {
    const run = runCli('generatee');
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain('Unknown command generatee');
  });

  // `constructor` is inherited by every object literal and citty looks subcommands up with `in`, so
  // the registry has a null prototype and this stays a typo instead of resolving to Object.
  it('rejects an inherited object key as a command', { timeout }, () => {
    const run = runCli('constructor');
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain('Unknown command constructor');
  });
});
