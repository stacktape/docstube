import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { BlockEntity, EntityAddress, PageShard, SectionEntity } from '@docstube/contracts';
import { NavTree } from './nav-tree.tsx';
import { agentRunnerHint, describeMutationError, useTrpc } from './trpc-client.ts';

// Review UI (PRODUCT §3.9.4): entity-anchored feedback over the committed page shards. This wave
// renders a production-lite, readable block list from the shard entity tree plus the LITERAL
// trust surface projected from the shard's claim ledger + ClaimEvidence — mirroring the theme's
// proof projection: 'N/M checked' counts, a loud contradiction warning, and an explicit
// unverified state for shards without a trust spine. The guarantee-chip ladder is gone (wave 2b
// demolition). Feedback anchors to stable entity addresses: element/block, section, page.

const POLL_MS = 5000;

// Mirrors feedbackCategories in packages/core/src/server/feedback.ts; 'auto' routes through the
// agent-backed categorizer.
const feedbackCategoryOptions = ['auto', 'criteria', 'instructions', 'glossary'] as const;

type ClaimCorrectness = 'checked' | 'unchecked' | 'contradicted';

type ClaimView = {
  claimId: string;
  markerId: string;
  quote: string;
  correctness: ClaimCorrectness;
};

type ClaimCounts = { checked: number; total: number; contradicted: number; unchecked: number };

type ShardProof = {
  // 'unverified' = the shard persists WITHOUT a ledger/provenance trust spine (failed
  // first-generation anchoring) — rendered loudly, never as a silent 0/0.
  state: 'verified' | 'unverified';
  page: ClaimCounts;
  claimsByBlockId: Map<string, ClaimView[]>;
};

// Local mirror of the theme's projectShardProof (packages/theme proof-projection.ts): literal
// counts straight from ClaimEvidence, claims located by their ledger anchors.
const projectShard = (shard: PageShard): ShardProof => {
  const records = shard.provenance?.claimEvidence ?? [];
  const correctnessByClaimId = new Map(records.map((record) => [record.claimId, record.correctness]));
  const claimsByBlockId = new Map<string, ClaimView[]>();
  for (const claim of shard.ledger?.claims ?? []) {
    const list = claimsByBlockId.get(claim.anchor.blockId) ?? [];
    list.push({
      claimId: claim.claimId,
      markerId: claim.anchor.markerId,
      quote: claim.quote,
      correctness: correctnessByClaimId.get(claim.claimId) ?? claim.correctness
    });
    claimsByBlockId.set(claim.anchor.blockId, list);
  }
  return {
    state: shard.ledger === undefined || shard.provenance === undefined ? 'unverified' : 'verified',
    page: {
      checked: records.filter((record) => record.correctness === 'checked').length,
      total: records.length,
      contradicted: records.filter((record) => record.correctness === 'contradicted').length,
      unchecked: records.filter((record) => record.correctness === 'unchecked').length
    },
    claimsByBlockId
  };
};

const countsOf = (claims: ClaimView[]): ClaimCounts => ({
  checked: claims.filter((claim) => claim.correctness === 'checked').length,
  total: claims.length,
  contradicted: claims.filter((claim) => claim.correctness === 'contradicted').length,
  unchecked: claims.filter((claim) => claim.correctness === 'unchecked').length
});

// Mirrors the theme's proof surface (impl-09 finding 2): contradictions are the alarm; unchecked
// claims get a quiet-but-visible exception count so they never read as ordinary checked content.
function ClaimCountChip({ counts }: { counts: ClaimCounts }) {
  if (counts.total === 0) {
    return null;
  }
  if (counts.contradicted > 0) {
    return (
      <span className="rounded bg-rose-950 px-1.5 py-0.5 text-[11px] text-rose-300">
        ⚠ {counts.contradicted} contradicted
      </span>
    );
  }
  return (
    <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-300">
      {counts.checked}/{counts.total} checked
      {counts.unchecked > 0 && <span className="text-neutral-500"> · {counts.unchecked} unchecked</span>}
    </span>
  );
}

const claimTone: Record<ClaimCorrectness, string> = {
  checked: 'bg-emerald-950 text-emerald-300',
  unchecked: 'bg-neutral-800 text-neutral-400',
  contradicted: 'bg-rose-950 text-rose-300'
};

function ClaimRow({ claim }: { claim: ClaimView }) {
  return (
    <span className="block border-l-2 border-neutral-700 pl-2">
      <span className="block font-mono text-xs text-neutral-300">“{claim.quote}”</span>
      <span className="flex items-center gap-2 text-xs text-neutral-400">
        {claim.markerId}
        <span className={`rounded px-1.5 py-0.5 text-[11px] ${claimTone[claim.correctness]}`}>{claim.correctness}</span>
      </span>
    </span>
  );
}

const sameEntity = (a: EntityAddress | undefined, b: EntityAddress): boolean =>
  a !== undefined && a.pageId === b.pageId && a.entityId === b.entityId;

type SelectEntity = (entity: EntityAddress) => void;

function BlockCard({
  block,
  claims,
  address,
  selected,
  onSelect
}: {
  block: BlockEntity;
  claims: ClaimView[];
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
        <ClaimCountChip counts={countsOf(claims)} />
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
      {claims.length > 0 && (
        <span className="mt-2 block space-y-1.5">
          {claims.map((claim) => (
            <ClaimRow key={claim.claimId} claim={claim} />
          ))}
        </span>
      )}
      {metadataEntries.length === 0 && claims.length === 0 && (
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
  proof,
  selectedEntity,
  onSelect
}: {
  section: SectionEntity;
  shard: PageShard;
  proof: ShardProof;
  selectedEntity: EntityAddress | undefined;
  onSelect: SelectEntity;
}) {
  const sectionAddress: EntityAddress = {
    version: shard.version,
    locale: shard.locale,
    pageId: shard.page.id,
    entityId: section.id
  };
  const sectionClaims = section.blocks.flatMap((block) => proof.claimsByBlockId.get(block.id) ?? []);
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
        <ClaimCountChip counts={countsOf(sectionClaims)} />
      </button>
      <div className="space-y-2 pl-4">
        {section.blocks.map((block) => {
          const address: EntityAddress = { ...sectionAddress, entityId: block.id };
          return (
            <BlockCard
              key={block.id}
              block={block}
              claims={proof.claimsByBlockId.get(block.id) ?? []}
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
  const proof = shard === undefined ? undefined : projectShard(shard);
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
        {shard === undefined || proof === undefined ? (
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
                  {proof.state === 'unverified' ? (
                    <span role="status" className="rounded bg-amber-950 px-1.5 py-0.5 text-[11px] text-amber-300">
                      ⚠ this page could not be verified
                    </span>
                  ) : (
                    <ClaimCountChip counts={proof.page} />
                  )}
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
            {proof.page.contradicted > 0 && (
              <div
                role="alert"
                className="rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs font-semibold text-rose-200"
              >
                ⚠ {proof.page.contradicted} claim{proof.page.contradicted === 1 ? ' is' : 's are'} contradicted by the
                source. Treat the marked statements as wrong until regenerated.
              </div>
            )}
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
              Structural mirror of the committed shard: blocks plus literal claim counts from the shard ledger. The
              generated prose lives in the emitted MDX — the full production-rendered preview is a later step. There is
              no approve button anywhere: approval is never a shipping gate; required attention lives in the flag queue.
            </p>
            {shard.page.preamble.length > 0 && (
              <div className="space-y-2">
                {shard.page.preamble.map((block) => {
                  const address: EntityAddress = { ...(pageAddress as EntityAddress), entityId: block.id };
                  return (
                    <BlockCard
                      key={block.id}
                      block={block}
                      claims={proof.claimsByBlockId.get(block.id) ?? []}
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
                proof={proof}
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
