import { contentHash } from '@docstube/contracts';
import type { PageShard } from '@docstube/contracts';

// INTERIM READER SURFACE (wave 2b-iii round 2, until the full trust-chip wave): the theme
// consumes shards ONLY through this projection, and the projection is LITERAL — claim counts,
// contradiction facts, and per-claim contradicted marks straight from the canonical ClaimEvidence
// records, plus the editorial "reviewed for <persona>" label ONLY when a primary-gating review
// genuinely completed. The public guarantee-label vocabulary ('proven'/'scored') is gone from the
// rendered surface (impl-07 finding 4): a first-generation caught lie renders as an explicit
// contradiction warning, never as ordinary "reviewed" content. The trust-chip wave adds per-claim
// popovers on top of these primitives.

export type SectionClaimsChip = {
  anchor: string;
  title: string;
  checked: number;
  total: number;
  contradicted: number;
};

export type ShardProofProjection = {
  // EXPLICIT unverified state (impl-08 new defect): a persisted page WITHOUT a ledger/provenance
  // trust spine (a failed first-generation anchoring) is 'unverified' and must render a LOUD
  // warning — never a silent 0/0 that reads as ordinary content.
  state: 'verified' | 'unverified';
  checkedClaims: number;
  totalClaims: number;
  contradictedClaims: number;
  uncheckedClaims: number;
  // Persona id when a primary-gating review genuinely completed WITH at least one evaluated
  // criterion; the "reviewed for <persona>" label is withheld otherwise (harness-state-v2
  // decision 3) — there is NO fallback-to-reviewed.
  reviewedFor: string | undefined;
  // Marker ids of contradicted claims — the per-claim contradicted marks the theme renders on the
  // inline <Claim> elements.
  contradictedMarkers: string[];
  // Marker ids of UNCHECKED claims (impl-09 finding 2, PRODUCT §4.1 always-visible marks): the
  // theme renders a quiet-but-visible 'unchecked' mark on these — an exception indicator, visually
  // lighter than a contradiction, never an alarm. Distinct list from contradictedMarkers.
  uncheckedMarkers: string[];
  sections: SectionClaimsChip[];
};

// MDX↔SHARD BINDING CHECK (wave 2b close final): the shard's trust spine describes ONE exact MDX
// artifact, recorded as mdxContentHash at persistence. Emission must refuse to project trust
// state over prose that no longer matches — a page edited after persistence (or an old shard
// with no hash at all) renders in the loud UNVERIFIED state instead, with the reason surfaced.
export type ShardMdxBindingCheck = { ok: true } | { ok: false; code: 'missing-hash' | 'hash-mismatch'; reason: string };

export const checkShardMdxBinding = (shard: PageShard, mdx: string): ShardMdxBindingCheck => {
  const slug = shard.page.slug;
  if (shard.mdxContentHash === undefined) {
    return {
      ok: false,
      code: 'missing-hash',
      reason:
        `page "${slug}" (${shard.locale}): the shard records no mdxContentHash, so the persisted MDX cannot be ` +
        'proven to be the prose its trust spine was computed for — rendering UNVERIFIED. Re-run `docstube generate` ' +
        'to mint the binding hash'
    };
  }
  const actual = contentHash(mdx);
  if (actual !== shard.mdxContentHash) {
    return {
      ok: false,
      code: 'hash-mismatch',
      reason:
        `page "${slug}" (${shard.locale}): the MDX on disk (content hash ${actual}) does not match the shard's ` +
        `recorded mdxContentHash (${shard.mdxContentHash}) — the prose changed after the trust spine was computed, ` +
        'so the recorded claim state is stale; rendering UNVERIFIED. Re-run `docstube generate` to reconcile'
    };
  }
  return { ok: true };
};

// The projection of a shard whose MDX binding failed: EXACTLY the existing no-trust-spine
// unverified state (loud warning, zero counts, no marks, no reviewed-for label) — stale trust
// state must never accompany changed prose.
export const projectUnboundShardProof = (shard: PageShard): ShardProofProjection => {
  const { ledger: _ledger, provenance: _provenance, claimMatching: _claimMatching, ...stripped } = shard;
  return projectShardProof(stripped as PageShard);
};

export const projectShardProof = (shard: PageShard): ShardProofProjection => {
  const unverified = shard.ledger === undefined || shard.provenance === undefined;
  const records = shard.provenance?.claimEvidence ?? [];
  const checkedClaims = records.filter((record) => record.correctness === 'checked').length;
  const contradictedClaims = records.filter((record) => record.correctness === 'contradicted').length;
  const totalClaims = records.length;

  const correctnessByClaimId = new Map(records.map((record) => [record.claimId, record.correctness]));
  const claims = shard.ledger?.claims ?? [];
  const claimsByBlockId = new Map<string, string[]>();
  for (const claim of claims) {
    const list = claimsByBlockId.get(claim.anchor.blockId) ?? [];
    list.push(claim.claimId);
    claimsByBlockId.set(claim.anchor.blockId, list);
  }
  const contradictedMarkers = claims
    .filter((claim) => correctnessByClaimId.get(claim.claimId) === 'contradicted')
    .map((claim) => claim.anchor.markerId);
  // A ledger claim with no ClaimEvidence record is unchecked by definition — never silently plain.
  const uncheckedMarkers = claims
    .filter((claim) => (correctnessByClaimId.get(claim.claimId) ?? 'unchecked') === 'unchecked')
    .map((claim) => claim.anchor.markerId);

  const sections: SectionClaimsChip[] = shard.page.sections.map((section) => {
    const sectionClaimIds = section.blocks.flatMap((block) => claimsByBlockId.get(block.id) ?? []);
    return {
      anchor: section.anchor,
      title: section.title,
      checked: sectionClaimIds.filter((claimId) => correctnessByClaimId.get(claimId) === 'checked').length,
      total: sectionClaimIds.length,
      contradicted: sectionClaimIds.filter((claimId) => correctnessByClaimId.get(claimId) === 'contradicted').length
    };
  });

  // A completed review must carry evaluated criteria (impl-08 new defect): completion alone does
  // not prove required criteria were evaluated — an empty-criteria "completed" review earns no
  // label (the schema also rejects it at parse time; this guards pre-schema records).
  const completedPrimaryReview = shard.provenance?.assessments.reviews.find(
    (review) => review.role === 'primary-gating' && review.completion === 'completed' && review.criteria.length > 0
  );

  return {
    state: unverified ? 'unverified' : 'verified',
    checkedClaims,
    totalClaims,
    contradictedClaims,
    uncheckedClaims: totalClaims - checkedClaims - contradictedClaims,
    reviewedFor: completedPrimaryReview?.persona,
    contradictedMarkers,
    uncheckedMarkers,
    sections
  };
};
