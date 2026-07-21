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
  checkedClaims: number;
  totalClaims: number;
  contradictedClaims: number;
  uncheckedClaims: number;
  // Persona id when a primary-gating review genuinely completed; the "reviewed for <persona>"
  // label is withheld otherwise (harness-state-v2 decision 3) — there is NO fallback-to-reviewed.
  reviewedFor: string | undefined;
  // Marker ids of contradicted claims — the per-claim contradicted marks the theme renders on the
  // inline <Claim> elements.
  contradictedMarkers: string[];
  sections: SectionClaimsChip[];
};

export const projectShardProof = (shard: PageShard): ShardProofProjection => {
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

  const completedPrimaryReview = shard.provenance?.assessments.reviews.find(
    (review) => review.role === 'primary-gating' && review.completion === 'completed'
  );

  return {
    checkedClaims,
    totalClaims,
    contradictedClaims,
    uncheckedClaims: totalClaims - checkedClaims - contradictedClaims,
    reviewedFor: completedPrimaryReview?.persona,
    contradictedMarkers,
    sections
  };
};
