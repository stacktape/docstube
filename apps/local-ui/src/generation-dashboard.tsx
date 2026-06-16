import { Activity, AlertTriangle, CheckCircle2, Clock, Eye, RotateCcw, Terminal } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Finding } from '@docstube/contracts';
import type { PageProgress, RunRecord, TerminalProgressState } from '@docstube/core';

export type PageTimelineEvent = {
  at: string;
  label: string;
  status: PageProgress;
};

export type DashboardPage = {
  approved: boolean;
  findings: Finding[];
  id: string;
  preview: string;
  runId: string;
  slug?: string;
  status: PageProgress;
  timeline: readonly PageTimelineEvent[];
  title: string;
  updatedAt: string;
};

export type GenerationDashboardProps = {
  initialPageId?: string;
  onSelectPage?: (pageId: string) => void;
  pages: readonly DashboardPage[];
  run: RunRecord;
  terminalProgress?: TerminalProgressState;
};

const statuses = ['queued', 'running', 'retrying', 'passed', 'flagged'] as const satisfies readonly PageProgress[];

const statusLabels: Record<PageProgress, string> = {
  queued: 'Queued',
  running: 'Running',
  retrying: 'Retrying',
  passed: 'Passed',
  flagged: 'Flagged'
};

const statusIcons = {
  queued: Clock,
  running: Activity,
  retrying: RotateCcw,
  passed: CheckCircle2,
  flagged: AlertTriangle
} satisfies Record<PageProgress, typeof Clock>;

const countByStatus = (pages: readonly DashboardPage[]): Record<PageProgress, number> => {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<PageProgress, number>;
  for (const page of pages) {
    counts[page.status] += 1;
  }
  return counts;
};

function StatusBadge(props: { status: PageProgress }) {
  const Icon = statusIcons[props.status];
  return (
    <span className={`status-badge ${props.status}`}>
      <Icon aria-hidden="true" size={14} />
      {statusLabels[props.status]}
    </span>
  );
}

function ProgressNavTree(props: {
  onSelectPage: (pageId: string) => void;
  pages: readonly DashboardPage[];
  selectedPageId: string;
}) {
  return (
    <nav className="dashboard-panel progress-nav" data-testid="progress-nav-tree">
      <div className="panel-heading">
        <Activity aria-hidden="true" size={18} />
        <h2>Pages</h2>
      </div>
      <ol className="progress-list">
        {props.pages.map((page) => (
          <li key={page.id}>
            <button
              className={page.id === props.selectedPageId ? 'progress-row selected' : 'progress-row'}
              data-testid={`progress-page-${page.status}`}
              type="button"
              onClick={() => props.onSelectPage(page.id)}
            >
              <span>
                <strong>{page.title}</strong>
                <small>{page.slug ?? page.id}</small>
              </span>
              <StatusBadge status={page.status} />
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function StatusCounts(props: { counts: Record<PageProgress, number> }) {
  return (
    <section className="dashboard-panel status-counts" data-testid="status-counts">
      {statuses.map((status) => (
        <div key={status} className="status-count" data-testid={`status-count-${status}`}>
          <span>{statusLabels[status]}</span>
          <strong>{props.counts[status]}</strong>
        </div>
      ))}
    </section>
  );
}

function PageTimeline(props: { page: DashboardPage }) {
  return (
    <section className="dashboard-panel" data-testid="page-timeline">
      <div className="panel-heading">
        <Terminal aria-hidden="true" size={18} />
        <h2>Timeline</h2>
      </div>
      <ol className="timeline-list">
        {props.page.timeline.map((event) => (
          <li key={`${event.at}-${event.status}`}>
            <StatusBadge status={event.status} />
            <span>{event.label}</span>
            <time>{event.at}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LivePreview(props: { page: DashboardPage }) {
  return (
    <section className="dashboard-panel live-preview" data-testid="live-preview">
      <div className="panel-heading">
        <Eye aria-hidden="true" size={18} />
        <h2>{props.page.title}</h2>
      </div>
      <article>
        <pre>{props.page.preview}</pre>
      </article>
      {props.page.findings.length > 0 ? (
        <div className="finding-strip" data-testid="preview-findings">
          {props.page.findings.map((finding) => (
            <span key={`${finding.code}-${finding.message}`}>{finding.message}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function GenerationDashboard(props: GenerationDashboardProps) {
  const [selectedPageId, setSelectedPageId] = useState(props.initialPageId ?? props.pages[0]?.id ?? '');
  const selectedPage = props.pages.find((page) => page.id === selectedPageId) ?? props.pages[0];
  const counts = useMemo(
    () => props.terminalProgress?.counts ?? countByStatus(props.pages),
    [props.pages, props.terminalProgress]
  );

  const selectPage = (pageId: string) => {
    setSelectedPageId(pageId);
    props.onSelectPage?.(pageId);
  };

  if (!selectedPage) {
    return (
      <main className="dashboard-shell" data-testid="dashboard-shell">
        <p>No pages queued.</p>
      </main>
    );
  }

  return (
    <main className="dashboard-shell" data-testid="dashboard-shell">
      <header className="dashboard-header" data-testid="dashboard-header">
        <div>
          <p className="eyebrow">Generation</p>
          <h1>{props.run.id}</h1>
        </div>
        <StatusBadge status={selectedPage.status} />
      </header>

      {props.run.capFrozen ? (
        <section className="cap-freeze-banner" data-testid="cap-freeze-banner">
          <AlertTriangle aria-hidden="true" size={18} />
          <span>{props.run.note ?? 'Usage cap reached. Increase the cap to continue queued work.'}</span>
        </section>
      ) : null}

      <StatusCounts counts={counts} />

      <div className="dashboard-grid">
        <ProgressNavTree pages={props.pages} selectedPageId={selectedPage.id} onSelectPage={selectPage} />
        <div className="dashboard-main">
          <PageTimeline page={selectedPage} />
          <LivePreview page={selectedPage} />
        </div>
      </div>
    </main>
  );
}
