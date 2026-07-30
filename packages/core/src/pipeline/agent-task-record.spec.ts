import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Transcript } from '@docstube/contracts';
import { idPrefixes, mintId } from '@docstube/contracts';
import { createRunJournal } from '../state/run-journal.ts';
import { runRecordedTask } from './agent-task-record.ts';
import { createRunCostTracker } from './run-cost.ts';

// Every model task is journaled AND billed under the role its kind routes to — recorded in one
// place so a new task-issuing site cannot forget the role and make run spend unattributable.

let repoRoot: string;
let runId: string;
let taskId: string;
let pageId: string;

const task = (kind: string): AgentTaskSpec => ({
  id: taskId,
  kind,
  systemPrompt: 'system',
  userPrompt: 'user',
  tools: [],
  workspace: { readRoots: ['.'], writableRoots: [] },
  budget: { maxTurns: 1, maxToolCalls: 0 },
  output: { type: 'text' }
});

const transcript = (costUsd: number): Transcript => ({
  schemaVersion: 1,
  taskId,
  cacheKey: 'k',
  transport: 'replay',
  model: 'replay',
  turns: [],
  observedReads: [],
  usage: { inputTokens: 0, outputTokens: 0, costUsd, cacheHit: false },
  stopReason: 'complete'
});

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-task-record-'));
  runId = mintId(idPrefixes.run);
  taskId = mintId(idPrefixes.task);
  pageId = mintId(idPrefixes.page);
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('runRecordedTask', () => {
  it('stamps the routing role on both task events and attributes the spend to it', async () => {
    const journal = await createRunJournal(repoRoot, runId);
    const costTracker = createRunCostTracker();
    await runRecordedTask({
      runTask: async () => transcript(0.25),
      journal,
      task: task('review-page'),
      costTracker,
      pageId
    });
    const events = await journal.readAll();
    const started = events.find((event) => event.type === 'task-started');
    const completed = events.find((event) => event.type === 'task-completed');
    expect(started).toMatchObject({ role: 'reviewer', pageId });
    expect(completed).toMatchObject({ role: 'reviewer', usage: { costUsd: 0.25 } });
    expect(costTracker.spendByRole()).toEqual([{ role: 'reviewer', tasks: 1, spentUsd: 0.25, estimatedUsd: 0 }]);
  });

  it('records each kind under its own role', async () => {
    const journal = await createRunJournal(repoRoot, runId);
    for (const kind of ['write-page', 'translate-page', 'extract-theme-tokens']) {
      await runRecordedTask({ runTask: async () => transcript(0), journal, task: task(kind) });
    }
    const roles = (await journal.readAll())
      .filter((event) => event.type === 'task-completed')
      .map((event) => (event.type === 'task-completed' ? event.role : undefined));
    expect(roles).toEqual(['writer', 'translator', 'extractor']);
  });
});
