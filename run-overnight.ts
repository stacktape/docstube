#!/usr/bin/env node
/**
 * docstube overnight build runner.
 *
 * For each task in tasks.md, top to bottom:
 * 1. Claude implements the task.
 * 2. Codex reviews the diff and ends with VERDICT: PASS or VERDICT: FAIL.
 * 3. Claude fixes failed reviews, up to MAX_REVIEW_ROUNDS.
 * 4. On pass, the runner validates, commits, and advances local state.
 *
 * Run: node run-overnight.ts
 * Dry: node run-overnight.ts --dry-run
 *
 * Needs on PATH: claude, codex, git, pnpm.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

const TASKS_FILE = 'tasks.md';
const MAX_REVIEW_ROUNDS = 4;
const LOG_DIR = '.docstube-build/logs';
const STATE_FILE = '.docstube-build/state';
const START_SHA_FILE = '.docstube-build/start-sha';
const CLAUDE_ARGS = ['-p', '--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash', '--output-format', 'text'];
const DRY = process.argv.includes('--dry-run');
const SKIP_VALIDATE = process.env.DOCSTUBE_SKIP_VALIDATE === '1';
const DEFAULT_COMMAND_TIMEOUT_MS = Number.parseInt(
  process.env.DOCSTUBE_OVERNIGHT_COMMAND_TIMEOUT_MS || String(2 * 60 * 60 * 1000),
  10
);

if (!DRY) {
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(dirname(STATE_FILE), { recursive: true });
}

type Task = {
  body: string;
  title: string;
};

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const say = (message: string) => {
  const line = `[${ts()}] ${message}`;
  console.info(line);
  if (!DRY) {
    writeFileSync(`${LOG_DIR}/run.log`, `${line}\n`, { flag: 'a' });
  }
};

const writeLog = (name: string, content: string) => {
  if (!DRY) {
    writeFileSync(`${LOG_DIR}/${name}`, content);
  }
};

const tail = (text: string, maxChars = 12000) => {
  if (text.length <= maxChars) {
    return text;
  }

  return `[output truncated to last ${maxChars} characters]\n${text.slice(-maxChars)}`;
};

const commandFailureMessage = (cmd: string, args: string[], status: number | null, signal: string | null) => {
  const signalText = signal ? `, signal ${signal}` : '';
  return `${cmd} ${args.join(' ')} failed with exit code ${status}${signalText}.`;
};

type ReviewVerdict = 'PASS' | 'FAIL';

const parseReviewVerdict = (review: string): ReviewVerdict | undefined => {
  const transcriptStart = review.search(/\r?\nOpenAI Codex v\d/i);
  const answer = transcriptStart === -1 ? review : review.slice(0, transcriptStart);
  const matches = [...answer.matchAll(/^\s*(?:\*\*)?VERDICT:\s*(PASS|FAIL)\b(?:\*\*)?\s*$/gim)];
  const finalMatch = matches.at(-1);
  const verdict = finalMatch?.[1]?.toUpperCase();

  return verdict === 'PASS' || verdict === 'FAIL' ? verdict : undefined;
};

// Node's spawn does not apply Windows PATHEXT resolution, so a bare command such as
// `pnpm` fails with ENOENT even when `pnpm.exe`/`pnpm.cmd` is on PATH. Resolve the real
// executable ourselves and keep shell:false so prompt and commit-message args are never
// re-parsed by a shell. Returns the original command on non-Windows or when unresolved.
const resolveExecutable = (cmd: string) => {
  if (process.platform !== 'win32' || cmd.includes('/') || cmd.includes('\\')) {
    return cmd;
  }

  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean);
  const searchDirs = (process.env.PATH || '').split(delimiter).filter(Boolean);

  // Try PATHEXT extensions before the bare name: package managers like pnpm ship both an
  // extensionless Unix shim and a `.CMD` shim in the same directory, and Windows can only
  // execute the `.CMD`. Matching the bare name first would pick the unrunnable Unix shim.
  for (const dir of searchDirs) {
    for (const ext of [...extensions, '']) {
      const candidate = join(dir, `${cmd}${ext}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return cmd;
};

const runResult = (cmd: string, args: string[], input?: string) => {
  if (DRY) {
    say(`  [dry-run] would run: ${cmd} ${args.join(' ')}`);
    return {
      error: undefined,
      ok: true,
      output: cmd === 'codex' ? 'VERDICT: PASS' : '(dry-run output)',
      signal: null,
      status: 0
    };
  }

  // `.cmd`/`.bat` shims cannot be executed directly with shell:false on modern Node, so
  // route those through the command processor while leaving native executables untouched.
  const resolved = resolveExecutable(cmd);
  const isShim = /\.(?:cmd|bat)$/i.test(resolved);
  const spawnCmd = isShim ? process.env.ComSpec || 'cmd.exe' : resolved;
  const spawnArgs = isShim ? ['/d', '/s', '/c', resolved, ...args] : args;

  const result = spawnSync(spawnCmd, spawnArgs, {
    input,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    shell: false,
    timeout: DEFAULT_COMMAND_TIMEOUT_MS
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  return {
    error: result.error,
    ok: !result.error && result.status === 0,
    output,
    signal: result.signal,
    status: result.status
  };
};

const run = (cmd: string, args: string[], input?: string) => {
  const result = runResult(cmd, args, input);

  if (result.error) {
    writeLog(`failed-${Date.now()}-${cmd}.log`, result.output || String(result.error));
    throw result.error;
  }

  if (!result.ok) {
    writeLog(`failed-${Date.now()}-${cmd}.log`, result.output);
    throw new Error(commandFailureMessage(cmd, args, result.status, result.signal));
  }

  return result.output;
};

const parseTasks = () => {
  if (!existsSync(TASKS_FILE)) {
    throw new Error(`Missing ${TASKS_FILE}.`);
  }

  const text = readFileSync(TASKS_FILE, 'utf8');
  const lines = text.split('\n');
  const tasks: Task[] = [];
  let current: Task | undefined;

  for (const line of lines) {
    const match = line.match(/^##\s+(.*)/);
    if (match?.[1]) {
      if (current) {
        tasks.push(current);
      }
      current = { body: '', title: match[1].trim() };
      continue;
    }

    if (current) {
      current.body += `${line}\n`;
    }
  }

  if (current) {
    tasks.push(current);
  }

  if (tasks.length === 0) {
    throw new Error(`${TASKS_FILE} does not contain any ## task headings.`);
  }

  return tasks;
};

const readState = () => {
  if (DRY) {
    return 0;
  }

  if (!existsSync(STATE_FILE)) {
    return 0;
  }

  const raw = readFileSync(STATE_FILE, 'utf8').trim();
  const state = Number.parseInt(raw || '0', 10);
  return Number.isFinite(state) ? state : 0;
};

const gitOutput = (args: string[]) => run('git', args).trim();

const currentHead = () => gitOutput(['rev-parse', 'HEAD']);

const statusLines = () =>
  gitOutput(['status', '--short'])
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

const assertCleanWorkingTree = (context: string) => {
  if (DRY) {
    return;
  }

  const dirty = statusLines();
  if (dirty.length > 0) {
    throw new Error(
      `Refusing to ${context} with a dirty working tree.\n` +
        `Commit, stash, or remove these changes first:\n${dirty.join('\n')}`
    );
  }
};

const assertHeadUnchanged = (expectedHead: string, context: string) => {
  if (DRY) {
    return;
  }

  const actualHead = currentHead();
  if (actualHead !== expectedHead) {
    throw new Error(
      `Refusing to continue: HEAD changed during ${context}.\n` +
        `Expected ${expectedHead}, got ${actualHead}. Agents must not commit or rewrite history.`
    );
  }
};

const prepareReviewDiff = () => {
  run('git', ['add', '-N', '.']);
  const status = run('git', ['status', '--short']);
  let diff = run('git', ['--no-pager', 'diff', 'HEAD', '--']);

  if (!diff.trim()) {
    diff = '(no tracked diff; review the working tree against the task.)';
  }

  return `--- STATUS ---\n${status}\n--- DIFF ---\n${diff}`;
};

const hasWorkingTreeChanges = () => run('git', ['status', '--short']).trim().length > 0;

const claudeImplement = (task: Task, tag: string) => {
  say('  -> Claude implementing');
  const prompt = `You are implementing docstube. Read AGENTS.md, PLAN.md, and tasks.md before editing.

TASK: ${task.title}

${task.body}

Rules:
- Implement ONLY this task. Do not start later tasks.
- Do not rebuild release, deploy, CI, or package infrastructure unless this task explicitly requires it.
- Do not edit AGENTS.md, PLAN.md, or tasks.md unless this task explicitly requires it.
- Test-first where practical.
- Make this task's acceptance checks pass.
- Never implement anything PLAN.md marks as a hard TBD boundary.
- If a design change seems required, stop and explain it instead of changing the plan.
- Do not run shell commands; the supervisor runs validation after your edit.
- Keep the project buildable and this task's tests passing.
- Do not commit; the runner commits after review.`;

  const output = run('claude', [...CLAUDE_ARGS, prompt]);
  writeLog(`${tag}.implement.log`, output);
};

const claudeFix = (task: Task, review: string, tag: string, round: number) => {
  say(`  -> Claude fixing round ${round}`);
  const prompt = `Codex review or validation found issues in your work on task "${task.title}".

Fix every [BLOCKER] and [MAJOR]. Address [MINOR] if cheap. Change nothing unrelated.
Do not edit AGENTS.md, PLAN.md, tasks.md, release workflows, deployment files, or package infrastructure unless the task explicitly requires it.

REVIEW FINDINGS:
${review}

After fixing, keep the build and this task's tests passing. Do not run shell commands. Do not commit.`;

  const output = run('claude', [...CLAUDE_ARGS, prompt]);
  writeLog(`${tag}.fix-${round}.log`, output);
};

let lastReview = '';

const codexReview = (task: Task, tag: string, round: number) => {
  say(`  -> Codex review round ${round}`);
  const diff = DRY ? '(dry-run)' : prepareReviewDiff();
  const prompt = `Review this docstube change for the task: "${task.title}".

TASK BODY:
${task.body}

Judge ONLY against this exact task scope and acceptance criteria, AGENTS.md, and relevant PLAN.md sections.
Report findings as a list, each tagged [BLOCKER], [MAJOR], or [MINOR], with file:line when possible.
Do not suggest new scope or redesigns. Be concise.

At the very end output one line exactly:
VERDICT: PASS
or:
VERDICT: FAIL

${diff}`;

  const review = run('codex', ['exec', '--sandbox', 'read-only', '--color', 'never', '-C', '.', '-'], prompt);
  writeLog(`${tag}.review-${round}.log`, review);

  const verdict = parseReviewVerdict(review);
  const pass = verdict === 'PASS';
  say(`    Codex: ${pass ? 'PASS' : 'FAIL'} round ${round}`);

  if (!pass) {
    lastReview = verdict ? review : `[BLOCKER] Codex review did not include a parseable final verdict.\n\n${review}`;
  }

  return pass;
};

const validate = (tag: string) => {
  if (SKIP_VALIDATE) {
    if (!DRY) {
      throw new Error('DOCSTUBE_SKIP_VALIDATE is not allowed for real overnight runs.');
    }
    say('  -> Skipping validation because DOCSTUBE_SKIP_VALIDATE=1');
    return { ok: true, review: '' };
  }

  say('  -> Running pnpm run validate');
  const result = runResult('pnpm', ['run', 'validate']);
  writeLog(`${tag}.validate.log`, result.output);

  if (result.error) {
    return {
      ok: false,
      review: `[BLOCKER] Validation command failed before completing.\n\n${String(result.error)}\n\n${tail(result.output)}`
    };
  }

  if (!result.ok) {
    return {
      ok: false,
      review: `[BLOCKER] pnpm run validate failed.\n\n${commandFailureMessage('pnpm', ['run', 'validate'], result.status, result.signal)}\n\n${tail(result.output)}`
    };
  }

  return { ok: true, review: '' };
};

const commitTask = (task: Task, index: number) => {
  if (DRY) {
    say(`  [dry-run] would commit task ${index}: ${task.title}`);
    return;
  }

  if (!hasWorkingTreeChanges()) {
    say('  -> No working-tree changes; advancing state without a commit');
    writeFileSync(STATE_FILE, String(index + 1));
    return;
  }

  run('git', ['add', '-A']);
  run('git', ['commit', '-m', `build(task-${String(index).padStart(2, '0')}): ${task.title}`, '--no-verify']);
  writeFileSync(STATE_FILE, String(index + 1));
};

const main = () => {
  assertCleanWorkingTree('start the overnight runner');
  const tasks = parseTasks();
  const start = readState();
  say(`Starting overnight build${DRY ? ' (dry run)' : ''}. ${tasks.length} tasks; resuming at index ${start}.`);

  if (!DRY && start === 0) {
    writeFileSync(START_SHA_FILE, `${currentHead()}\n`);
  }

  for (let index = start; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (!task) {
      throw new Error(`Missing task at index ${index}.`);
    }

    const tag = `task-${String(index).padStart(2, '0')}`;
    say(`===== TASK ${index}/${tasks.length - 1}: ${task.title} =====`);
    assertCleanWorkingTree(`start task ${index}`);
    const taskHead = currentHead();

    claudeImplement(task, tag);
    assertHeadUnchanged(taskHead, `task ${index} implementation`);

    let passed = false;
    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round += 1) {
      assertHeadUnchanged(taskHead, `task ${index} review round ${round}`);
      if (codexReview(task, tag, round)) {
        const validation = validate(tag);
        assertHeadUnchanged(taskHead, `task ${index} validation round ${round}`);

        if (validation.ok) {
          passed = true;
          break;
        }

        say(`    Validation: FAIL round ${round}`);
        lastReview = validation.review;
      }

      if (round === MAX_REVIEW_ROUNDS) {
        break;
      }

      claudeFix(task, lastReview, tag, round);
      assertHeadUnchanged(taskHead, `task ${index} fix round ${round}`);
    }

    if (!passed) {
      say(`Task ${index} still failing after ${MAX_REVIEW_ROUNDS} rounds. Pausing for human review.`);
      say(`Inspect ${LOG_DIR}/${tag}.* and rerun when fixed. The runner resumes at this task.`);
      process.exit(2);
    }

    commitTask(task, index);
    say(`Task ${index} done.`);
  }

  say('All tasks complete. Review git history and logs before trusting the result.');
};

main();
