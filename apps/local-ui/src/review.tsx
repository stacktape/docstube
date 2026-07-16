import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { BlockEntity, EntityAddress, GuaranteeLevel, PageShard, SectionEntity } from '@docstube/contracts';
import { NavTree } from './nav-tree.tsx';
import { agentRunnerHint, describeMutationError, useTrpc } from './trpc-client.ts';

// Review UI (PRODUCT §3.9.4): entity-anchored feedback over the committed page shards. This wave
// renders a production-lite, readable block list from the shard entity tree — the shard carries
// structure, claims, guarantees, and provenance, not the generated prose (that lives in the MDX
// on disk), so the full production-rendered preview is a later step. Feedback anchors to stable
// entity addresses: element/block, section, page.

const POLL_MS = 5000;

// Mirrors feedbackCategories in packages/core/src/server/feedback.ts; 'auto' routes through the
// agent-backed categorizer.
const feedbackCategoryOptions = ['auto', 'criteria', 'instructions', 'glossary'] as const;

const guaranteeTone: Record<GuaranteeLevel, string> = {
  proven: 'bg-emerald-950 text-emerald-300',
  scored: 'bg-sky-950 text-sky-300',
  'out-of-domain': 'bg-amber-950 text-amber-300'
};

function GuaranteeChip({ level }: { level: GuaranteeLevel }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${guaranteeTone[level]}`}>{level}</span>;
}

const sameEntity = (a: EntityAddress | undefined, b: EntityAddress): boolean =>
  a !== undefined && a.pageId === b.pageId && a.entityId === b.entityId;

type SelectEntity = (entity: EntityAddress) => void;

function BlockCard({
  block,
  address,
  selected,
  onSelect
}: {
  block: BlockEntity;
  address: EntityAddress;
  selected: boolean;
  onSelect: SelectEntity;
}) {
  const metadataEntries = Object.entries((block.metadata as Record<string, unknown> | undefined) ?? {});
  return (
    <button
      type="button"
      onClick={() => onSelect(address)}
      className={`block w-full rounded border p-3 text-left text-sm ${
        selected ? 'border-sky-600 bg-sky-950/20' : 'border-neutral-800 hover:border-neutral-600'
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-300">
          {block.blockType}
        </span>
        {block.language !== undefined && <span className="text-[11px] text-neutral-500">{block.language}</span>}
        <GuaranteeChip level={block.guarantee} />
      </span>
      {metadataEntries.length > 0 && (
        <span className="mt-2 block space-y-0.5">
          {metadataEntries.map(([key, value]) => (
            <span key={key} className="block font-mono text-xs text-neutral-400">
              {key}: {typeof value === 'string' ? value : JSON.stringify(value)}
            </span>
          ))}
        </span>
      )}
      {block.claims.length > 0 && (
        <span className="mt-2 block space-y-1.5">
          {block.claims.map((claim) => (
            <span key={claim.id} className="block border-l-2 border-neutral-700 pl-2">
              <span className="block font-mono text-xs text-neutral-300">“{claim.anchor.quote}”</span>
              <span className="flex items-center gap-2 text-xs text-neutral-400">
                {claim.text} <GuaranteeChip level={claim.guarantee} />
              </span>
            </span>
          ))}
        </span>
      )}
      {metadataEntries.length === 0 && block.claims.length === 0 && (
        <span className="mt-1 block text-xs text-neutral-500">
          {block.blockType} block · content {block.contentHash.slice(0, 8)}…
        </span>
      )}
    </button>
  );
}

function SectionView({
  section,
  shard,
  selectedEntity,
  onSelect
}: {
  section: SectionEntity;
  shard: PageShard;
  selectedEntity: EntityAddress | undefined;
  onSelect: SelectEntity;
}) {
  const sectionAddress: EntityAddress = {
    version: shard.version,
    locale: shard.locale,
    pageId: shard.page.id,
    entityId: section.id
  };
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onSelect(sectionAddress)}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${
          sameEntity(selectedEntity, sectionAddress) ? 'bg-sky-950/30' : 'hover:bg-neutral-900'
        }`}
      >
        <span className="text-xs text-neutral-600">H{section.level}</span>
        <span className="text-sm font-semibold text-neutral-100">{section.title}</span>
        <GuaranteeChip level={section.guarantee} />
      </button>
      <div className="space-y-2 pl-4">
        {section.blocks.map((block) => {
          const address: EntityAddress = { ...sectionAddress, entityId: block.id };
          return (
            <BlockCard
              key={block.id}
              block={block}
              address={address}
              selected={sameEntity(selectedEntity, address)}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </div>
  );
}

function FeedbackPanel({ entity }: { entity: EntityAddress }) {
  const trpc = useTrpc();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<(typeof feedbackCategoryOptions)[number]>('auto');
  const submitMutation = useMutation({
    mutationFn: () => trpc.feedback.submit.mutate({ entity, text, ...(category === 'auto' ? {} : { category }) }),
    onSuccess: () => setText('')
  });
  const error = submitMutation.error === null ? undefined : describeMutationError(submitMutation.error);
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Feedback</h3>
      <p className="font-mono text-[11px] text-neutral-500">
        {entity.version} · {entity.locale} · {entity.pageId}
        {entity.entityId !== undefined && ` · ${entity.entityId}`}
      </p>
      <textarea
        aria-label="Feedback"
        className="min-h-24 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
        placeholder="What should improve here?"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <select
          aria-label="Feedback category"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200"
          value={category}
          onChange={(event) => setCategory(event.target.value as (typeof feedbackCategoryOptions)[number])}
        >
          {feedbackCategoryOptions.map((option) => (
            <option key={option} value={option}>
              {option === 'auto' ? 'auto (categorizer decides)' : option}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-white disabled:opacity-40"
          disabled={text.trim().length === 0 || submitMutation.isPending}
          onClick={() => submitMutation.mutate()}
        >
          {submitMutation.isPending ? 'Submitting…' : 'Submit feedback'}
        </button>
      </div>
      {submitMutation.isSuccess && (
        <p className="text-xs text-emerald-300">
          Routed to {submitMutation.data.category} → {submitMutation.data.file}
        </p>
      )}
      {error !== undefined && (
        <div role="alert" className="rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          <p>{error.message}</p>
          {error.needsAgent && <p className="mt-1 text-rose-300">{agentRunnerHint}</p>}
        </div>
      )}
    </div>
  );
}

export function Review() {
  const trpc = useTrpc();
  const [selectedPageId, setSelectedPageId] = useState<string>();
  const [selectedEntity, setSelectedEntity] = useState<EntityAddress>();

  const indexQuery = useQuery({
    queryKey: ['manifest-index'],
    queryFn: () => trpc.manifest.index.query(),
    refetchInterval: POLL_MS
  });
  const index = indexQuery.data ?? undefined;
  const locale = index?.sourceLocale;
  const pageQuery = useQuery({
    queryKey: ['review-page', locale, selectedPageId],
    queryFn: () => trpc.manifest.page.query({ locale: locale as string, pageId: selectedPageId as string }),
    enabled: locale !== undefined && selectedPageId !== undefined
  });
  // Not page-scoped: the control plane only exposes whole-run modes, so "Regenerate" starts a full
  // refine run (page-scoped regeneration is a control-plane API gap).
  const regenerateMutation = useMutation({ mutationFn: () => trpc.runs.start.mutate({ mode: 'refine' }) });

  if (indexQuery.isError) {
    return <p className="p-6 text-sm text-rose-400">Failed to reach the control plane: {String(indexQuery.error)}</p>;
  }
  if (indexQuery.isSuccess && (index === undefined || index.pages.length === 0)) {
    return (
      <p className="p-6 text-sm text-neutral-400">
        No generated pages yet — run <code className="text-neutral-200">docstube generate</code> first.
      </p>
    );
  }

  const shard = pageQuery.data ?? undefined;
  const pageAddress: EntityAddress | undefined =
    shard === undefined ? undefined : { version: shard.version, locale: shard.locale, pageId: shard.page.id };
  const regenerateError =
    regenerateMutation.error === null ? undefined : describeMutationError(regenerateMutation.error);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-neutral-800 p-3">
        <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Pages</h2>
        <NavTree
          nodes={(index?.pages ?? []).map((page) => ({ id: page.id, title: page.title }))}
          {...(selectedPageId === undefined ? {} : { selectedId: selectedPageId })}
          onSelect={(node) => {
            setSelectedPageId(node.id);
            setSelectedEntity(undefined);
          }}
        />
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto p-4">
        {shard === undefined ? (
          <p className="text-sm text-neutral-500">
            {pageQuery.isFetching ? 'Loading page…' : 'Select a page to review it.'}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <button
                type="button"
                onClick={() => pageAddress !== undefined && setSelectedEntity(pageAddress)}
                className={`rounded px-2 py-1 text-left ${
                  selectedEntity !== undefined && selectedEntity.entityId === undefined
                    ? 'bg-sky-950/30'
                    : 'hover:bg-neutral-900'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-neutral-100">{shard.page.title}</span>
                  <GuaranteeChip level={shard.page.guarantee} />
                </span>
                {shard.page.description !== undefined && (
                  <span className="block text-sm text-neutral-400">{shard.page.description}</span>
                )}
              </button>
              <div className="shrink-0 space-y-1 text-right">
                <button
                  type="button"
                  className="rounded border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-400 disabled:opacity-50"
                  disabled={regenerateMutation.isPending}
                  onClick={() => regenerateMutation.mutate()}
                >
                  {regenerateMutation.isPending ? 'Starting…' : 'Regenerate (refine run)'}
                </button>
                {regenerateMutation.isSuccess && (
                  <p className="text-[11px] text-emerald-300">Run {regenerateMutation.data.runId} started.</p>
                )}
                <p className="max-w-52 text-[11px] text-neutral-600">
                  Runs a whole refine pass — page-scoped regeneration needs a page-scoped run API.
                </p>
              </div>
            </div>
            {regenerateError !== undefined && (
              <div
                role="alert"
                className="rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-200"
              >
                <p>{regenerateError.message}</p>
                {regenerateError.needsAgent && <p className="mt-1 text-rose-300">{agentRunnerHint}</p>}
              </div>
            )}
            <p className="rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-500">
              Structural mirror of the committed shard: blocks, claims, and guarantee levels. The generated prose lives
              in the emitted MDX — the full production-rendered preview is a later step. There is no approve button
              anywhere: approval is never a shipping gate; required attention lives in the flag queue.
            </p>
            {shard.page.preamble.length > 0 && (
              <div className="space-y-2">
                {shard.page.preamble.map((block) => {
                  const address: EntityAddress = { ...(pageAddress as EntityAddress), entityId: block.id };
                  return (
                    <BlockCard
                      key={block.id}
                      block={block}
                      address={address}
                      selected={sameEntity(selectedEntity, address)}
                      onSelect={setSelectedEntity}
                    />
                  );
                })}
              </div>
            )}
            {shard.page.sections.map((section) => (
              <SectionView
                key={section.id}
                section={section}
                shard={shard}
                selectedEntity={selectedEntity}
                onSelect={setSelectedEntity}
              />
            ))}
          </div>
        )}
      </section>
      <aside className="w-96 shrink-0 overflow-y-auto border-l border-neutral-800 p-4">
        {selectedEntity === undefined ? (
          <p className="text-sm text-neutral-500">
            Click the page title, a section heading, or a block to anchor feedback to that entity.
          </p>
        ) : (
          <FeedbackPanel
            key={`${selectedEntity.pageId}:${selectedEntity.entityId ?? 'page'}`}
            entity={selectedEntity}
          />
        )}
      </aside>
    </div>
  );
}
