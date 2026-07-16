import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlagQueueEntry } from './trpc-client.ts';
import { useTrpc } from './trpc-client.ts';

// Flag queue (PRODUCT §3.3): the only human touchpoint in the L4 posture. Open flags are
// actionable — answer (tribal knowledge becomes durable writer context) or dismiss. Answered
// tribal flags stay visible as "committed to knowledge".
const POLL_MS = 2000;

const formatDate = (iso: string): string => iso.replace('T', ' ').replace(/\.\d+Z?$/, '');

const isCommittedTribal = (entry: FlagQueueEntry): boolean =>
  entry.flag.kind === 'tribal-knowledge' && (entry.flag.status === 'answered' || entry.flag.status === 'resolved');

export function FlagQueue() {
  const trpc = useTrpc();
  const queryClient = useQueryClient();
  const [selectedFlagId, setSelectedFlagId] = useState<string>();
  const [answerText, setAnswerText] = useState('');

  const flagsQuery = useQuery({
    queryKey: ['flags'],
    queryFn: () => trpc.flags.list.query(),
    refetchInterval: POLL_MS
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['flags'] });
  const answerMutation = useMutation({
    mutationFn: (input: { flagId: string; text: string }) => trpc.flags.answer.mutate(input),
    onSuccess: () => {
      setAnswerText('');
      void refresh();
    }
  });
  const dismissMutation = useMutation({
    mutationFn: (input: { flagId: string }) => trpc.flags.dismiss.mutate(input),
    onSuccess: () => {
      setSelectedFlagId(undefined);
      void refresh();
    }
  });

  if (flagsQuery.isError) {
    return <p className="p-6 text-sm text-rose-400">Failed to reach the control plane: {String(flagsQuery.error)}</p>;
  }

  // Open flags need attention; answered tribal flags stay listed as proof the answer landed.
  const visible: FlagQueueEntry[] = (flagsQuery.data ?? []).filter(
    (entry) => entry.flag.status === 'open' || isCommittedTribal(entry)
  );
  const selected = visible.find((entry) => entry.flag.id === selectedFlagId);
  const mutationError = answerMutation.error ?? dismissMutation.error;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="min-w-0 flex-1 overflow-y-auto p-4">
        {flagsQuery.isSuccess && visible.length === 0 ? (
          <p className="text-sm text-neutral-400">No open flags. Nothing needs human attention.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-2 py-2 font-semibold">Kind</th>
                <th className="px-2 py-2 font-semibold">Summary</th>
                <th className="px-2 py-2 font-semibold">Page</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr
                  key={entry.flag.id}
                  onClick={() => {
                    setSelectedFlagId(entry.flag.id);
                    setAnswerText('');
                  }}
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
                  <td className="px-2 py-2">
                    {isCommittedTribal(entry) ? (
                      <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[11px] text-emerald-300">
                        committed to knowledge
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-500">{entry.flag.status}</span>
                    )}
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
            {selected.flag.answer !== undefined && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Answer</dt>
                <dd>{selected.flag.answer.text}</dd>
              </div>
            )}
          </dl>
          {isCommittedTribal(selected) && (
            <p className="rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300">
              Committed to knowledge — the answer is durable writer context for every future generation.
            </p>
          )}
          {selected.flag.status === 'open' && (
            <div className="space-y-2">
              <textarea
                aria-label="Answer"
                className="min-h-24 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
                placeholder={
                  selected.flag.kind === 'tribal-knowledge'
                    ? 'Answer once — it becomes durable context for future generations.'
                    : 'Resolution note'
                }
                value={answerText}
                onChange={(event) => setAnswerText(event.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-white disabled:opacity-40"
                  disabled={answerText.trim().length === 0 || answerMutation.isPending}
                  onClick={() => answerMutation.mutate({ flagId: selected.flag.id, text: answerText })}
                >
                  {answerMutation.isPending ? 'Answering…' : 'Answer'}
                </button>
                <button
                  type="button"
                  className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 disabled:opacity-40"
                  disabled={dismissMutation.isPending}
                  onClick={() => dismissMutation.mutate({ flagId: selected.flag.id })}
                >
                  {dismissMutation.isPending ? 'Dismissing…' : 'Dismiss'}
                </button>
              </div>
            </div>
          )}
          {mutationError !== null && mutationError !== undefined && (
            <p role="alert" className="rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
              {mutationError instanceof Error ? mutationError.message : String(mutationError)}
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
