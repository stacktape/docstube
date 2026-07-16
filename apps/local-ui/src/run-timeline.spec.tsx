// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunEvent } from '@docstube/contracts';
import { RunTimeline, buildTimelineSteps, foldRunView } from './run-timeline.tsx';

afterEach(cleanup);

const runId = 'run_00000000000000000000';
const pageId = 'pg_00000000000000000000';
const otherPageId = 'pg_11111111111111111111';
const taskId = 'tk_00000000000000000000';
const at = '2026-07-12T00:00:00.000Z';

let seq = 0;
const evt = <T extends Omit<RunEvent, 'runId' | 'seq' | 'at'>>(partial: T): RunEvent =>
  ({ ...partial, runId, seq: seq++, at }) as unknown as RunEvent;

const events: RunEvent[] = [
  evt({ type: 'run-started', mode: 'generate', commit: 'a1b2c3d' }),
  evt({ type: 'page-status', pageId, status: 'queued' }),
  evt({ type: 'page-status', pageId, status: 'writing' }),
  evt({ type: 'task-started', taskId, pageId }),
  evt({
    type: 'task-completed',
    taskId,
    pageId,
    usage: { inputTokens: 1200, outputTokens: 400, costUsd: 0.25, cacheHit: false }
  }),
  evt({
    type: 'findings',
    pageId,
    findings: [
      { source: 'verifier', check: 'code-typecheck-ts', severity: 'error', message: 'snippet does not compile' },
      { source: 'review', check: 'audience-fit', severity: 'warning', message: 'too terse for beginners' }
    ]
  }),
  evt({ type: 'retry-scheduled', pageId, attempt: 1, maxAttempts: 3 }),
  evt({ type: 'page-status', pageId, status: 'passed' }),
  evt({ type: 'page-status', pageId: otherPageId, status: 'queued' }),
  evt({ type: 'run-frozen', reason: 'usage cap reached', spentUsd: 5.5 })
];

describe('foldRunView', () => {
  it('folds page status, findings count, cost, retries, and the freeze', () => {
    const view = foldRunView(events);
    expect(view.pages[pageId]).toEqual({ status: 'passed', findingsCount: 2, costUsd: 0.25, retries: 1 });
    expect(view.pages[otherPageId]?.status).toBe('queued');
    expect(view.frozen).toEqual({ reason: 'usage cap reached', spentUsd: 5.5 });
    expect(view.outcome).toBe('frozen');
  });
});

describe('buildTimelineSteps', () => {
  it('builds page-scoped steps in journal order and merges task pairs', () => {
    const steps = buildTimelineSteps(events, pageId);
    expect(steps.map((step) => step.label)).toEqual([
      'Status → queued',
      'Status → writing',
      `Agent task ${taskId} completed`,
      '2 findings',
      'Retry attempt 1 of 3',
      'Status → passed'
    ]);
    const task = steps[2];
    expect(task?.tone).toBe('success');
    expect(task?.details).toContain('1200 input tokens · 400 output tokens');
    expect(task?.details).toContain('cost $0.2500');
    const findings = steps[3];
    expect(findings?.tone).toBe('danger');
    expect(findings?.details[0]).toContain('code-typecheck-ts');
  });

  it('keeps a never-completed task as a running step', () => {
    const steps = buildTimelineSteps([evt({ type: 'task-started', taskId, pageId })], pageId);
    expect(steps[0]?.label).toBe(`Agent task ${taskId} running`);
    expect(steps[0]?.tone).toBe('active');
  });
});

describe('RunTimeline', () => {
  it('renders expandable steps for a fixture events array', () => {
    render(<RunTimeline events={events} pageId={pageId} />);
    expect(screen.getByText('Status → writing')).toBeDefined();
    expect(screen.getByText('2 findings')).toBeDefined();
    expect(screen.getByText('Retry attempt 1 of 3')).toBeDefined();
    expect(screen.getByText(/audience-fit: too terse/)).toBeDefined();
    expect(screen.queryByText('Status → queued', { selector: 'summary *' })).toBeNull();
  });

  it('renders an empty state when the page has no events', () => {
    render(<RunTimeline events={events} pageId="pg_22222222222222222222" />);
    expect(screen.getByText(/No events for this page yet/)).toBeDefined();
  });
});
