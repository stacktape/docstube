import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NavTreeNode } from './nav-tree.tsx';
import { NavTree } from './nav-tree.tsx';
import { RunTimeline, foldRunView, pageStatusTone } from './run-timeline.tsx';
import { useTrpc } from './trpc-client.ts';

// Generation dashboard (PRODUCT §3.9.3): "the waiting room is the review room". NavTree in
// progress mode over the run journal fold, per-page CI-style timeline, cap-freeze banner.
// TODO(next wave): replace 2s polling with a WebSocket journal stream from the control plane.
const POLL_MS = 2000;

export function Dashboard() {
  const trpc = useTrpc();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [selectedPageId, setSelectedPageId] = useState<string>();

  const runsQuery = useQuery({
    queryKey: ['runs'],
    queryFn: () => trpc.runs.list.query(),
    refetchInterval: POLL_MS
  });
  const runs = runsQuery.data ?? [];
  const runId = selectedRunId ?? runs[0]?.runId;

  const eventsQuery = useQuery({
    queryKey: ['run-events', runId],
    queryFn: () => trpc.runs.events.query({ runId: runId as string }),
    enabled: runId !== undefined,
    refetchInterval: POLL_MS
  });
  const manifestQuery = useQuery({
    queryKey: ['manifest-index'],
    queryFn: () => trpc.manifest.index.query(),
    refetchInterval: POLL_MS * 5
  });

  const events = eventsQuery.data ?? [];
  const view = useMemo(() => foldRunView(events), [events]);
  const pageTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const page of manifestQuery.data?.pages ?? []) {
      titles.set(page.id, page.title);
    }
    return titles;
  }, [manifestQuery.data]);

  const nodes: NavTreeNode[] = useMemo(
    () =>
      Object.entries(view.pages).map(([pageId, progress]) => ({
        id: pageId,
        title: pageTitles.get(pageId) ?? pageId,
        status: progress.status,
        statusTone: pageStatusTone(progress.status),
        findingsCount: progress.findingsCount,
        costUsd: progress.costUsd
      })),
    [view, pageTitles]
  );

  if (runsQuery.isError) {
    return <p className="p-6 text-sm text-rose-400">Failed to reach the control plane: {String(runsQuery.error)}</p>;
  }
  if (runsQuery.isSuccess && runs.length === 0) {
    return (
      <p className="p-6 text-sm text-neutral-400">
        No runs yet — start one with <code className="text-neutral-200">docstube generate</code>.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-56 shrink-0 space-y-1 overflow-y-auto border-r border-neutral-800 p-3">
        <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Runs</h2>
        {runs.map((run) => (
          <button
            key={run.runId}
            type="button"
            onClick={() => {
              setSelectedRunId(run.runId);
              setSelectedPageId(undefined);
            }}
            className={`block w-full rounded px-2 py-1.5 text-left text-sm ${
              run.runId === runId ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300 hover:bg-neutral-900'
            }`}
          >
            <span className="block truncate font-mono text-xs">{run.runId}</span>
            <span className="text-xs text-neutral-500">
              {run.mode ?? 'run'} · {run.outcome}
            </span>
          </button>
        ))}
      </aside>
      <section className="w-72 shrink-0 overflow-y-auto border-r border-neutral-800 p-3">
        <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Pages</h2>
        {nodes.length === 0 ? (
          <p className="px-2 text-sm text-neutral-500">No page activity in this run yet.</p>
        ) : (
          <NavTree nodes={nodes} selectedId={selectedPageId} onSelect={(node) => setSelectedPageId(node.id)} />
        )}
      </section>
      <section className="min-w-0 flex-1 overflow-y-auto p-4">
        {view.frozen !== undefined && (
          <div
            role="alert"
            className="mb-4 rounded border border-amber-900 bg-amber-950 px-4 py-3 text-sm text-amber-200"
          >
            Run frozen: {view.frozen.reason} — ${view.frozen.spentUsd.toFixed(2)} spent. Raise the usage cap and resume
            to continue.
          </div>
        )}
        {selectedPageId === undefined ? (
          <p className="text-sm text-neutral-500">Select a page to inspect its step timeline.</p>
        ) : (
          <>
            <h2 className="mb-3 text-sm font-semibold text-neutral-200">
              {pageTitles.get(selectedPageId) ?? selectedPageId}
            </h2>
            <RunTimeline events={events} pageId={selectedPageId} />
          </>
        )}
      </section>
    </div>
  );
}
