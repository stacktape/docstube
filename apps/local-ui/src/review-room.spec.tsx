// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FeedbackCategory, FeedbackRecord, Finding } from '@docstube/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewRoom, feedbackCategoryToTarget } from './review-room.tsx';
import type { CategorizedFeedback, FeedbackWriteTarget, ReviewPage } from './review-room.tsx';

const timestamp = '2026-06-16T00:00:00.000Z';

const finding: Finding = {
  code: 'content-drift',
  severity: 'major',
  origin: 'reviewer',
  message: 'The install section still mentions the old command.'
};

const pages: ReviewPage[] = [
  {
    id: 'overview',
    title: 'Overview',
    slug: 'overview.mdx',
    approved: false,
    findings: [finding],
    sections: [
      { id: 'intro', title: 'Intro' },
      { id: 'install', title: 'Install' }
    ],
    renderedHtml:
      '<article><h1>Overview</h1><section data-section-id="install"><p data-review-target>Use the new command.</p></section></article>'
  },
  {
    id: 'api',
    title: 'API',
    slug: 'api.mdx',
    approved: true,
    findings: [],
    sections: [{ id: 'reference', title: 'Reference' }],
    renderedHtml: '<article><h1>API</h1><p>Reference content.</p></article>'
  }
];

const categoryByScope: Record<FeedbackRecord['scope'], FeedbackCategory> = {
  docs: 'criteria',
  page: 'instruction',
  section: 'glossary',
  element: 'config'
};

const feedback: FeedbackRecord[] = [
  {
    id: 'feedback-existing',
    createdAt: timestamp,
    scope: 'page',
    message: 'Keep the install flow near the top.',
    pageId: 'overview',
    category: 'instruction',
    status: 'open'
  }
];

const renderAtWidth = (
  width: number,
  options: {
    feedback?: FeedbackRecord[];
    onApprove?: (pageId: string) => void;
    onRegenerate?: (pageId: string) => void;
    onWriteFeedback?: (target: FeedbackWriteTarget, record: FeedbackRecord) => void;
  } = {}
) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const categorizeFeedback = (record: FeedbackRecord): CategorizedFeedback => {
    const category = categoryByScope[record.scope];
    return { record: { ...record, category }, target: feedbackCategoryToTarget(category) };
  };

  render(
    <ReviewRoom
      feedback={options.feedback ?? feedback}
      pages={pages}
      now={() => timestamp}
      categorizeFeedback={categorizeFeedback}
      onApprove={options.onApprove}
      onRegenerate={options.onRegenerate}
      onWriteFeedback={options.onWriteFeedback}
    />
  );
  const shell = screen.getByTestId('review-shell');
  Object.defineProperty(shell, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(shell, 'scrollWidth', { configurable: true, value: width });
  return shell;
};

const expectAnchor = (testId: string) => {
  const element = screen.getByTestId(testId);
  expect(element.textContent?.trim().length).toBeGreaterThan(0);
  return element;
};

describe('ReviewRoom', () => {
  afterEach(() => {
    cleanup();
  });

  it.each([375, 1280])('renders review anchors without shell overflow at %ipx', (width) => {
    const shell = renderAtWidth(width);

    expectAnchor('review-header');
    expectAnchor('review-navigation');
    expectAnchor('production-preview');
    expectAnchor('review-findings');
    expectAnchor('feedback-history');
    expectAnchor('feedback-composer');
    expectAnchor('feedback-scopes');
    expectAnchor('review-actions');
    expect(shell.scrollWidth).toBeLessThanOrEqual(shell.clientWidth);
  });

  it('shows existing backend feedback for the selected page', () => {
    renderAtWidth(1280);

    expect(screen.getByTestId('feedback-history').textContent).toContain('Keep the install flow near the top.');
  });

  it('covers findings badges, approvals, and regeneration requests', () => {
    const approved: string[] = [];
    const regenerated: string[] = [];
    renderAtWidth(1280, {
      onApprove: (pageId) => approved.push(pageId),
      onRegenerate: (pageId) => regenerated.push(pageId)
    });

    expect(screen.getByTestId('review-page-overview-findings').textContent).toContain('1');
    expect(screen.getByTestId('review-findings').textContent).toContain('old command');

    fireEvent.click(screen.getByTestId('approve-page'));
    fireEvent.click(screen.getByTestId('regenerate-page'));

    expect(approved).toEqual(['overview']);
    expect(regenerated).toEqual(['overview']);
  });

  it('writes element, section, page, and docs feedback to categorized targets', async () => {
    const writes: Array<{ record: FeedbackRecord; target: FeedbackWriteTarget }> = [];
    renderAtWidth(1280, {
      onWriteFeedback: (target, record) => {
        writes.push({ target, record });
      }
    });

    const send = async (scope: FeedbackRecord['scope'], message: string) => {
      fireEvent.click(screen.getByTestId(`feedback-scope-${scope}`));
      fireEvent.change(screen.getByTestId('feedback-message'), { target: { value: message } });
      fireEvent.click(screen.getByTestId('feedback-submit'));
      await waitFor(() => expect(writes.at(-1)?.record.scope).toBe(scope));
    };

    await send('element', 'This element should use the configured selector.');
    await send('section', 'Add this term to the glossary.');
    await send('page', 'Keep this writing instruction for the page.');
    await send('docs', 'Make this part of the review criteria.');

    expect(writes.map((write) => [write.record.scope, write.target])).toEqual([
      ['element', 'config'],
      ['section', 'glossary'],
      ['page', 'instructions'],
      ['docs', 'criteria']
    ]);
    expect(writes[0]?.record.selector).toBe('[data-review-target]');
    expect(writes[1]?.record.sectionId).toBe('intro');
    expect(writes[2]?.record.pageId).toBe('overview');
    expect(writes[3]?.record.pageId).toBeUndefined();
  });
});
