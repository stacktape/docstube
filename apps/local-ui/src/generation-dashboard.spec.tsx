// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Finding } from '@docstube/contracts';
import type { PageProgress, RunRecord, TerminalProgressState } from '@docstube/core';
import { afterEach, describe, expect, it } from 'vitest';
import { GenerationDashboard } from './generation-dashboard';
import type { DashboardPage } from './generation-dashboard';

const timestamp = '2026-06-16T00:00:00.000Z';

const finding: Finding = {
  code: 'mdx-compile',
  severity: 'major',
  origin: 'verifier',
  message: 'Snippet import no longer resolves.'
};

const run: RunRecord = {
  id: 'run-fixture',
  status: 'running',
  capFrozen: true,
  note: 'Token cap reached near the retry budget.',
  startedAt: timestamp,
  updatedAt: timestamp
};

const page = (status: PageProgress, title: string): DashboardPage => ({
  id: `page-${status}`,
  runId: run.id,
  title,
  slug: `${status}.mdx`,
  status,
  approved: status === 'passed',
  findings: status === 'flagged' ? [finding] : [],
  updatedAt: timestamp,
  preview: `# ${title}\n\nCurrent ${status} output.`,
  timeline: [
    { at: timestamp, status: 'queued', label: 'Queued for generation' },
    { at: timestamp, status, label: `${title} is ${status}` }
  ]
});

const pages: DashboardPage[] = [
  page('queued', 'Queued page'),
  page('running', 'Running page'),
  page('retrying', 'Retrying page'),
  page('passed', 'Passed page'),
  page('flagged', 'Flagged page')
];

const terminalProgress: TerminalProgressState = {
  runId: run.id,
  status: 'running',
  capFrozen: true,
  note: run.note,
  totalPages: pages.length,
  nextPageId: 'page-queued',
  counts: {
    queued: 1,
    running: 1,
    retrying: 1,
    passed: 1,
    flagged: 1
  }
};

const renderAtWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  render(<GenerationDashboard run={run} pages={pages} terminalProgress={terminalProgress} />);
  const shell = screen.getByTestId('dashboard-shell');
  Object.defineProperty(shell, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(shell, 'scrollWidth', { configurable: true, value: width });
  return shell;
};

const expectAnchor = (testId: string) => {
  const element = screen.getByTestId(testId);
  expect(element.textContent?.trim().length).toBeGreaterThan(0);
  return element;
};

describe('GenerationDashboard', () => {
  afterEach(() => {
    cleanup();
  });

  it.each([375, 1280])('renders dashboard anchors without shell overflow at %ipx', (width) => {
    const shell = renderAtWidth(width);

    expectAnchor('dashboard-header');
    expectAnchor('cap-freeze-banner');
    expectAnchor('status-counts');
    expectAnchor('progress-nav-tree');
    expectAnchor('page-timeline');
    expectAnchor('live-preview');
    expect(shell.scrollWidth).toBeLessThanOrEqual(shell.clientWidth);
  });

  it('covers queued, running, retrying, passed, and flagged page statuses', () => {
    renderAtWidth(1280);

    for (const status of ['queued', 'running', 'retrying', 'passed', 'flagged'] as const) {
      expect(screen.getByTestId(`status-count-${status}`).textContent).toContain('1');
      expect(screen.getByTestId(`progress-page-${status}`).textContent).toContain(status);
    }

    expect(document.querySelector('canvas')).toBeNull();
    expect(document.querySelector('[data-testid="pipeline-node-graph"]')).toBeNull();
  });

  it('updates the timeline and live preview when a progress nav item is selected', () => {
    renderAtWidth(1280);

    fireEvent.click(screen.getByTestId('progress-page-flagged'));

    expect(screen.getByTestId('live-preview').textContent).toContain('Flagged page');
    expect(screen.getByTestId('preview-findings').textContent).toContain('Snippet import no longer resolves.');
    expect(screen.getByTestId('page-timeline').textContent).toContain('Flagged page is flagged');
  });
});
