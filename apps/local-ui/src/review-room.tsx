import {
  AlertTriangle,
  BadgeAlert,
  BookOpen,
  CheckCircle2,
  FileText,
  MessageSquare,
  MousePointer2,
  RotateCcw
} from 'lucide-react';
import { useState } from 'react';
import type { FeedbackCategory, FeedbackRecord, FeedbackScope, Finding } from '@docstube/contracts';

export type FeedbackWriteTarget = 'config' | 'criteria' | 'glossary' | 'instructions';

export type ReviewSection = {
  id: string;
  title: string;
};

export type ReviewPage = {
  approved: boolean;
  findings: Finding[];
  id: string;
  renderedHtml: string;
  sections: readonly ReviewSection[];
  slug?: string;
  title: string;
};

export type CategorizedFeedback = {
  record: FeedbackRecord;
  target: FeedbackWriteTarget;
};

export type ReviewRoomProps = {
  categorizeFeedback?: (record: FeedbackRecord) => Promise<CategorizedFeedback> | CategorizedFeedback;
  initialPageId?: string;
  now?: () => string;
  onApprove?: (pageId: string) => Promise<void> | void;
  onRegenerate?: (pageId: string) => Promise<void> | void;
  onWriteFeedback?: (target: FeedbackWriteTarget, record: FeedbackRecord) => Promise<void> | void;
  pages: readonly ReviewPage[];
};

const feedbackScopes = ['element', 'section', 'page', 'docs'] as const satisfies readonly FeedbackScope[];

const feedbackScopeLabels: Record<FeedbackScope, string> = {
  element: 'Element',
  section: 'Section',
  page: 'Page',
  docs: 'Docs'
};

const feedbackScopeIcons = {
  element: MousePointer2,
  section: BookOpen,
  page: FileText,
  docs: MessageSquare
} satisfies Record<FeedbackScope, typeof MessageSquare>;

export const feedbackCategoryToTarget = (category: FeedbackCategory): FeedbackWriteTarget => {
  if (category === 'instruction' || category === 'uncategorized') {
    return 'instructions';
  }
  return category;
};

export const defaultCategorizeReviewFeedback = (record: FeedbackRecord): CategorizedFeedback => {
  const message = record.message.toLowerCase();
  const category: FeedbackCategory = message.includes('glossary')
    ? 'glossary'
    : message.includes('theme') || message.includes('config')
      ? 'config'
      : record.scope === 'docs'
        ? 'criteria'
        : 'instruction';
  return { record: { ...record, category }, target: feedbackCategoryToTarget(category) };
};

const defaultNow = (): string => new Date().toISOString();

const feedbackRecordId = (count: number): string => `feedback-${count + 1}`;

function ReviewNavigation(props: {
  onSelectPage: (pageId: string) => void;
  pages: readonly ReviewPage[];
  selectedPageId: string;
}) {
  return (
    <nav className="review-panel review-nav" data-testid="review-navigation">
      <div className="panel-heading">
        <FileText aria-hidden="true" size={18} />
        <h2>Pages</h2>
      </div>
      <ol className="review-page-list">
        {props.pages.map((page) => (
          <li key={page.id}>
            <button
              className={page.id === props.selectedPageId ? 'review-page-row selected' : 'review-page-row'}
              data-testid={`review-page-${page.id}`}
              type="button"
              onClick={() => props.onSelectPage(page.id)}
            >
              <span>
                <strong>{page.title}</strong>
                <small>{page.slug ?? page.id}</small>
              </span>
              {page.findings.length > 0 ? (
                <span className="finding-badge" data-testid={`review-page-${page.id}-findings`}>
                  <BadgeAlert aria-hidden="true" size={14} />
                  {page.findings.length}
                </span>
              ) : (
                <span className="approved-badge">
                  <CheckCircle2 aria-hidden="true" size={14} />
                  {page.approved ? 'Approved' : 'Ready'}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function FindingsPanel(props: { findings: readonly Finding[] }) {
  return (
    <section className="review-panel" data-testid="review-findings">
      <div className="panel-heading">
        <AlertTriangle aria-hidden="true" size={18} />
        <h2>Findings</h2>
      </div>
      {props.findings.length > 0 ? (
        <ul className="finding-list">
          {props.findings.map((finding) => (
            <li key={`${finding.code}-${finding.message}`}>
              <strong>{finding.severity}</strong>
              <span>{finding.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-note">No open findings.</p>
      )}
    </section>
  );
}

function FeedbackComposer(props: {
  feedbackCount: number;
  onSubmit: (record: FeedbackRecord) => Promise<void>;
  page: ReviewPage;
  now: () => string;
}) {
  const [scope, setScope] = useState<FeedbackScope>('page');
  const [message, setMessage] = useState('');
  const [sectionId, setSectionId] = useState(props.page.sections[0]?.id ?? '');
  const [selector, setSelector] = useState('[data-review-target]');
  const [status, setStatus] = useState<'idle' | 'sent'>('idle');

  const submitFeedback = async () => {
    const record: FeedbackRecord = {
      id: feedbackRecordId(props.feedbackCount),
      createdAt: props.now(),
      scope,
      message,
      pageId: scope === 'docs' ? undefined : props.page.id,
      sectionId: scope === 'section' ? sectionId : undefined,
      selector: scope === 'element' ? selector : undefined,
      category: 'uncategorized',
      status: 'open'
    };

    await props.onSubmit(record);
    setStatus('sent');
    setMessage('');
  };

  return (
    <section className="review-panel feedback-composer" data-testid="feedback-composer">
      <div className="panel-heading">
        <MessageSquare aria-hidden="true" size={18} />
        <h2>Feedback</h2>
      </div>
      <div className="scope-controls" data-testid="feedback-scopes">
        {feedbackScopes.map((value) => {
          const Icon = feedbackScopeIcons[value];
          return (
            <button
              key={value}
              className={scope === value ? 'scope-button selected' : 'scope-button'}
              data-testid={`feedback-scope-${value}`}
              type="button"
              onClick={() => setScope(value)}
            >
              <Icon aria-hidden="true" size={15} />
              {feedbackScopeLabels[value]}
            </button>
          );
        })}
      </div>
      {scope === 'section' ? (
        <label className="field-row">
          <span>Section</span>
          <select className="field" value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
            {props.page.sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {scope === 'element' ? (
        <label className="field-row">
          <span>Selector</span>
          <input className="field" value={selector} onChange={(event) => setSelector(event.target.value)} />
        </label>
      ) : null}
      <textarea
        className="field feedback-message"
        data-testid="feedback-message"
        placeholder="Feedback"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      <button className="primary-button" data-testid="feedback-submit" type="button" onClick={submitFeedback}>
        <MessageSquare aria-hidden="true" size={18} />
        {status === 'sent' ? 'Sent' : 'Send'}
      </button>
    </section>
  );
}

export function ReviewRoom(props: ReviewRoomProps) {
  const [selectedPageId, setSelectedPageId] = useState(props.initialPageId ?? props.pages[0]?.id ?? '');
  const [feedbackCount, setFeedbackCount] = useState(0);
  const selectedPage = props.pages.find((page) => page.id === selectedPageId) ?? props.pages[0];
  const categorizeFeedback = props.categorizeFeedback ?? defaultCategorizeReviewFeedback;
  const now = props.now ?? defaultNow;

  const submitFeedback = async (record: FeedbackRecord) => {
    const categorized = await categorizeFeedback(record);
    await props.onWriteFeedback?.(categorized.target, categorized.record);
    setFeedbackCount((count) => count + 1);
  };

  if (!selectedPage) {
    return (
      <main className="review-shell" data-testid="review-shell">
        <p>No pages to review.</p>
      </main>
    );
  }

  return (
    <main className="review-shell" data-testid="review-shell">
      <header className="review-header" data-testid="review-header">
        <div>
          <p className="eyebrow">Review</p>
          <h1>{selectedPage.title}</h1>
        </div>
        <div className="review-actions" data-testid="review-actions">
          <button
            className="secondary-button"
            data-testid="regenerate-page"
            type="button"
            onClick={() => props.onRegenerate?.(selectedPage.id)}
          >
            <RotateCcw aria-hidden="true" size={18} />
            Regenerate
          </button>
          <button
            className="primary-button"
            data-testid="approve-page"
            type="button"
            onClick={() => props.onApprove?.(selectedPage.id)}
          >
            <CheckCircle2 aria-hidden="true" size={18} />
            Approve
          </button>
        </div>
      </header>

      <div className="review-grid">
        <ReviewNavigation pages={props.pages} selectedPageId={selectedPage.id} onSelectPage={setSelectedPageId} />
        <section className="review-panel production-preview" data-testid="production-preview">
          <div dangerouslySetInnerHTML={{ __html: selectedPage.renderedHtml }} />
        </section>
        <aside className="review-side">
          <FindingsPanel findings={selectedPage.findings} />
          <FeedbackComposer feedbackCount={feedbackCount} now={now} page={selectedPage} onSubmit={submitFeedback} />
        </aside>
      </div>
    </main>
  );
}
