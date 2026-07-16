import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FlagQueueEntry } from './trpc-client.ts';
import { useTrpc } from './trpc-client.ts';

// Flag queue (PRODUCT §3.3): the only human touchpoint in the L4 posture. Read-only in this
// wave — answering tribal-knowledge questions and resolving flags ships with the review wave.
const POLL_MS = 2000;

const formatDate = (iso: string): string => iso.replace('T', ' ').replace(/\.\d+Z?$/, '');

export function FlagQueue() {
  const trpc = useTrpc();
  const [selectedFlagId, setSelectedFlagId] = useState<string>();

  const flagsQuery = useQuery({
    queryKey: ['flags'],
    queryFn: () => trpc.flags.list.query(),
    refetchInterval: POLL_MS
  });

  if (flagsQuery.isError) {
    return <p className="p-6 text-sm text-rose-400">Failed to reach the control plane: {String(flagsQuery.error)}</p>;
  }

  const open: FlagQueueEntry[] = (flagsQuery.data ?? []).filter((entry) => entry.flag.status === 'open');
  const selected = open.find((entry) => entry.flag.id === selectedFlagId);

  return (
    <div className="flex min-h-0 flex-1">
      <section className="min-w-0 flex-1 overflow-y-auto p-4">
        <p className="mb-3 rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
          Read-only in this wave — answering and resolving flags arrives with the review UI.
        </p>
        {flagsQuery.isSuccess && open.length === 0 ? (
          <p className="text-sm text-neutral-400">No open flags. Nothing needs human attention.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-2 py-2 font-semibold">Kind</th>
                <th className="px-2 py-2 font-semibold">Summary</th>
                <th className="px-2 py-2 font-semibold">Page</th>
                <th className="px-2 py-2 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {open.map((entry) => (
                <tr
                  key={entry.flag.id}
                  onClick={() => setSelectedFlagId(entry.flag.id)}
                  className={`cursor-pointer border-b border-neutral-900 ${
                    entry.flag.id === selectedFlagId ? 'bg-neutral-800' : 'hover:bg-neutral-900'
                  }`}
                >
                  <td className="px-2 py-2">
                    <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-300">
                      {entry.flag.kind}
                    </span>
                  </td>
                  <td className="max-w-md truncate px-2 py-2 text-neutral-200">{entry.flag.summary}</td>
                  <td className="px-2 py-2 text-neutral-400">
                    {entry.scope === 'system' ? 'system' : (entry.pageTitle ?? entry.pageId)}
                  </td>
                  <td className="px-2 py-2 text-neutral-500">{formatDate(entry.flag.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {selected !== undefined && (
        <aside className="w-96 shrink-0 space-y-3 overflow-y-auto border-l border-neutral-800 p-4 text-sm">
          <h2 className="font-semibold text-neutral-100">{selected.flag.summary}</h2>
          <dl className="space-y-2 text-neutral-300">
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Kind</dt>
              <dd>{selected.flag.kind}</dd>
            </div>
            {selected.flag.question !== undefined && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Question</dt>
                <dd>{selected.flag.question}</dd>
              </div>
            )}
            {selected.flag.detail !== undefined && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Detail</dt>
                <dd>{selected.flag.detail}</dd>
              </div>
            )}
            {selected.flag.entity !== undefined && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Entity</dt>
                <dd className="font-mono text-xs">
                  {selected.flag.entity.version} · {selected.flag.entity.locale} · {selected.flag.entity.pageId}
                  {selected.flag.entity.entityId !== undefined && ` · ${selected.flag.entity.entityId}`}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Created</dt>
              <dd>{formatDate(selected.flag.createdAt)}</dd>
            </div>
          </dl>
          <p className="rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-500">
            Answering is not available yet — this queue becomes actionable with the review wave.
          </p>
        </aside>
      )}
    </div>
  );
}
