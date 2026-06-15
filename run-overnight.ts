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
import { dirname } from 'node:path';

const TASKS_FILE = 'tasks.md';
const MAX_REVIEW_ROUNDS = 4;
const LOG_DIR = '.docstube-build/logs';
const STATE_FILE = '.docstube-build/state';
const DRY = process.argv.includes('--dry-run');
const SKIP_VALIDATE = process.env.DOCSTUBE_SKIP_VALIDATE === '1';

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

const run = (cmd: string, args: string[], input?: string) => {
  if (DRY) {
    say(`  [dry-run] would run: ${cmd} ${args.join(' ')}`);
    return cmd === 'codex' ? 'VERDICT: PASS' : '(dry-run output)';
  }

  const result = spawnSync(cmd, args, {
    input,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    shell: false
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    writeLog(`failed-${Date.now()}-${cmd}.log`, output);
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${result.status}.`);
  }

  return output;
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
- Test-first where practical.
- Make this task's acceptance checks pass.
- Never implement anything PLAN.md marks as a hard TBD boundary.
- If a design change is truly required, edit PLAN.md in the same change and explain why.
- Ensure the project builds and this task's tests pass.
- Do not commit; the runner commits after review.`;

  const output = run('claude', ['-p', '--permission-mode', 'acceptEdits', '--output-format', 'text', prompt]);
  writeLog(`${tag}.implement.log`, output);
};

const claudeFix = (task: Task, review: string, tag: string, round: number) => {
  say(`  -> Claude fixing round ${round}`);
  const prompt = `Codex reviewed your work on task "${task.title}" and found issues.

Fix every [BLOCKER] and [MAJOR]. Address [MINOR] if cheap. Change nothing unrelated.

REVIEW FINDINGS:
${review}

After fixing, ensure the build and this task's tests still pass. Do not commit.`;

  const output = run('claude', ['-p', '--permission-mode', 'acceptEdits', '--output-format', 'text', prompt]);
  writeLog(`${tag}.fix-${round}.log`, output);
};

let lastReview = '';

const codexReview = (task: Task, tag: string, round: number) => {
  say(`  -> Codex review round ${round}`);
  const diff = DRY ? '(dry-run)' : prepareReviewDiff();
  const prompt = `Review this docstube change for the task: "${task.title}".

Judge ONLY against the task's stated scope and acceptance criteria, AGENTS.md, and relevant PLAN.md sections.
Report findings as a list, each tagged [BLOCKER], [MAJOR], or [MINOR], with file:line when possible.
Do not suggest new scope or redesigns. Be concise.

At the very end output one line exactly:
VERDICT: PASS
or:
VERDICT: FAIL

${diff}`;

  const review = run('codex', ['exec', '--sandbox', 'read-only', '--color', 'never', '-C', '.', '-'], prompt);
  writeLog(`${tag}.review-${round}.log`, review);

  const pass = /^VERDICT:\s*PASS\s*$/m.test(review);
  say(`    Codex: ${pass ? 'PASS' : 'FAIL'} round ${round}`);

  if (!pass) {
    lastReview = review;
  }

  return pass;
};

const validate = (tag: string) => {
  if (SKIP_VALIDATE) {
    say('  -> Skipping validation because DOCSTUBE_SKIP_VALIDATE=1');
    return;
  }

  say('  -> Running pnpm run validate');
  const output = run('pnpm', ['run', 'validate']);
  writeLog(`${tag}.validate.log`, output);
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
  const tasks = parseTasks();
  const start = readState();
  say(`Starting overnight build${DRY ? ' (dry run)' : ''}. ${tasks.length} tasks; resuming at index ${start}.`);

  for (let index = start; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (!task) {
      throw new Error(`Missing task at index ${index}.`);
    }

    const tag = `task-${String(index).padStart(2, '0')}`;
    say(`===== TASK ${index}/${tasks.length - 1}: ${task.title} =====`);

    claudeImplement(task, tag);

    let passed = false;
    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round += 1) {
      if (codexReview(task, tag, round)) {
        passed = true;
        break;
      }
      claudeFix(task, lastReview, tag, round);
    }

    if (!passed) {
      say(`Task ${index} still failing after ${MAX_REVIEW_ROUNDS} rounds. Pausing for human review.`);
      say(`Inspect ${LOG_DIR}/${tag}.* and rerun when fixed. The runner resumes at this task.`);
      process.exit(2);
    }

    validate(tag);
    commitTask(task, index);
    say(`Task ${index} done.`);
  }

  say('All tasks complete. Review git history and logs before trusting the result.');
};

main();
