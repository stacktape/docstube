import type { PageStatus, RunEvent } from '@docstube/contracts';
import type { NavTreeStatusTone } from './nav-tree.tsx';

// Pure fold + pure renderer over the run journal events array (PRODUCT §3.9.3): refresh-safe,
// identical after resume. No fetching, no state — the dashboard feeds it the events it polled.

export type PageProgress = {
  status: PageStatus;
  findingsCount: number;
  costUsd: number;
  retries: number;
};

export type RunView = {
  outcome: 'running' | 'passed' | 'flagged' | 'frozen' | 'failed';
  frozen?: { reason: string; spentUsd: number };
  pages: Record<string, PageProgress>;
};

export const pageStatusTone = (status: PageStatus): NavTreeStatusTone => {
  switch (status) {
    case 'queued':
      return 'neutral';
    case 'writing':
    case 'checking':
    case 'judging':
      return 'active';
    case 'retrying':
      return 'warning';
    case 'passed':
      return 'success';
    case 'flagged':
      return 'danger';
  }
};

export const foldRunView = (events: RunEvent[]): RunView => {
  const view: RunView = { outcome: 'running', pages: {} };
  const pageOf = (pageId: string): PageProgress => {
    const existing = view.pages[pageId];
    if (existing !== undefined) {
      return existing;
    }
    const created: PageProgress = { status: 'queued', findingsCount: 0, costUsd: 0, retries: 0 };
    view.pages[pageId] = created;
    return created;
  };
  for (const event of events) {
    switch (event.type) {
      case 'page-status':
        pageOf(event.pageId).status = event.status;
        break;
      case 'task-completed':
        if (event.pageId !== undefined && event.usage.costUsd !== undefined) {
          pageOf(event.pageId).costUsd += event.usage.costUsd;
        }
        break;
      case 'findings':
        if (event.pageId !== undefined) {
          pageOf(event.pageId).findingsCount += event.findings.length;
        }
        break;
      case 'retry-scheduled':
        pageOf(event.pageId).retries += 1;
        break;
      case 'run-frozen':
        view.frozen = { reason: event.reason, spentUsd: event.spentUsd };
        view.outcome = 'frozen';
        break;
      case 'run-completed':
        view.outcome = event.outcome;
        break;
      default:
        break;
    }
  }
  return view;
};

export type TimelineStep = {
  key: string;
  label: string;
  tone: NavTreeStatusTone;
  at: string;
  details: string[];
};

const findingsTone = (severities: string[]): NavTreeStatusTone => {
  if (severities.includes('error')) {
    return 'danger';
  }
  if (severities.includes('warning')) {
    return 'warning';
  }
  return 'neutral';
};

// CI-style step list for one page, in journal order. Open agent tasks render as running steps
// and are upgraded in place when their task-completed event arrives.
export const buildTimelineSteps = (events: RunEvent[], pageId: string): TimelineStep[] => {
  const steps: TimelineStep[] = [];
  const openTaskSteps = new Map<string, TimelineStep>();
  for (const event of events) {
    switch (event.type) {
      case 'page-status':
        if (event.pageId === pageId) {
          steps.push({
            key: `evt-${event.seq}`,
            label: `Status → ${event.status}`,
            tone: pageStatusTone(event.status),
            at: event.at,
            details: []
          });
        }
        break;
      case 'stage-started':
        if (event.pageId === pageId) {
          steps.push({
            key: `evt-${event.seq}`,
            label: `Stage ${event.stage} started`,
            tone: 'active',
            at: event.at,
            details: []
          });
        }
        break;
      case 'stage-completed':
        if (event.pageId === pageId) {
          steps.push({
            key: `evt-${event.seq}`,
            label: `Stage ${event.stage} completed in ${Math.round(event.durationMs)}ms`,
            tone: 'success',
            at: event.at,
            details: [`input hash ${event.inputHash.slice(0, 12)}`]
          });
        }
        break;
      case 'task-started':
        if (event.pageId === pageId) {
          const step: TimelineStep = {
            key: `evt-${event.seq}`,
            label: `Agent task ${event.taskId} running`,
            tone: 'active',
            at: event.at,
            details: []
          };
          openTaskSteps.set(event.taskId, step);
          steps.push(step);
        }
        break;
      case 'task-completed':
        if (event.pageId === pageId) {
          const details = [
            `${event.usage.inputTokens} input tokens · ${event.usage.outputTokens} output tokens`,
            ...(event.usage.costUsd !== undefined ? [`cost $${event.usage.costUsd.toFixed(4)}`] : []),
            ...(event.usage.cacheHit ? ['cache hit'] : [])
          ];
          const open = openTaskSteps.get(event.taskId);
          if (open !== undefined) {
            open.label = `Agent task ${event.taskId} completed`;
            open.tone = 'success';
            open.details = details;
            openTaskSteps.delete(event.taskId);
          } else {
            steps.push({
              key: `evt-${event.seq}`,
              label: `Agent task ${event.taskId} completed`,
              tone: 'success',
              at: event.at,
              details
            });
          }
        }
        break;
      case 'findings':
        if (event.pageId === pageId) {
          steps.push({
            key: `evt-${event.seq}`,
            label: `${event.findings.length} finding${event.findings.length === 1 ? '' : 's'}`,
            tone: findingsTone(event.findings.map((finding) => finding.severity)),
            at: event.at,
            details: event.findings.map((finding) => `${finding.severity} · ${finding.check}: ${finding.message}`)
          });
        }
        break;
      case 'retry-scheduled':
        if (event.pageId === pageId) {
          steps.push({
            key: `evt-${event.seq}`,
            label: `Retry attempt ${event.attempt} of ${event.maxAttempts}`,
            tone: 'warning',
            at: event.at,
            details: []
          });
        }
        break;
      case 'flag-raised':
        if (event.flag.entity?.pageId === pageId) {
          steps.push({
            key: `evt-${event.seq}`,
            label: `Flag raised: ${event.flag.summary}`,
            tone: 'danger',
            at: event.at,
            details: [`kind ${event.flag.kind}`, ...(event.flag.question !== undefined ? [event.flag.question] : [])]
          });
        }
        break;
      default:
        break;
    }
  }
  return steps;
};

const dotClasses: Record<NavTreeStatusTone, string> = {
  neutral: 'bg-neutral-500',
  active: 'bg-sky-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-rose-400'
};

export function RunTimeline({ events, pageId }: { events: RunEvent[]; pageId: string }) {
  const steps = buildTimelineSteps(events, pageId);
  if (steps.length === 0) {
    return <p className="text-sm text-neutral-500">No events for this page yet.</p>;
  }
  return (
    <ol className="space-y-1">
      {steps.map((step) => (
        <li key={step.key}>
          {step.details.length > 0 ? (
            <details className="rounded border border-neutral-800">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-neutral-200">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dotClasses[step.tone]}`} />
                <span className="flex-1">{step.label}</span>
                <time className="text-xs text-neutral-500">{step.at}</time>
              </summary>
              <ul className="space-y-1 border-t border-neutral-800 px-4 py-2 font-mono text-xs text-neutral-400">
                {step.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </details>
          ) : (
            <div className="flex items-center gap-2 rounded border border-neutral-800 px-3 py-2 text-sm text-neutral-200">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dotClasses[step.tone]}`} />
              <span className="flex-1">{step.label}</span>
              <time className="text-xs text-neutral-500">{step.at}</time>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
