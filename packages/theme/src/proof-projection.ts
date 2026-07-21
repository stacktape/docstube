import type { PageShard } from '@docstube/contracts';

// INTERIM READER SURFACE (wave 2b-iii, until the trust-chip wave): the theme consumes shards ONLY
// through this projection. Verified/reviewed chips derive from the canonical ClaimEvidence
// records and assessments — the legacy per-block guarantee ladder is gone. The projection keeps
// the frontmatter shape emit-site already feeds the theme layouts ('proven'/'scored' vocabulary),
// so themes keep rendering; the trust-chip wave replaces this with the literal-denominator chip,
// per-claim popovers, and loud contradicted marks (ARCHITECTURE §10.2).

export type SectionProofChip = {
  anchor: string;
  title: string;
  guarantee: 'proven' | 'scored';
};

export type ShardProofProjection = {
  // 'proven' (renders "verified") iff the page has claims and EVERY one is checked — the honest
  // 100% rule (trust-model-v2 decision 2). Anything else — no ledger, unchecked, contradicted —
  // projects 'scored' (renders "reviewed") until the real trust chip lands.
  guarantee: 'proven' | 'scored';
  checkedClaims: number;
  totalClaims: number;
  contradictedClaims: number;
  // Persona id when a primary-gating review genuinely completed; the "AI-reviewed for <persona>"
  // label is withheld otherwise (harness-state-v2 decision 3).
  reviewedFor: string | undefined;
  sections: SectionProofChip[];
};

export const projectShardProof = (shard: PageShard): ShardProofProjection => {
  const records = shard.provenance?.claimEvidence ?? [];
  const checkedClaims = records.filter((record) => record.correctness === 'checked').length;
  const contradictedClaims = records.filter((record) => record.correctness === 'contradicted').length;
  const totalClaims = records.length;

  const correctnessByClaimId = new Map(records.map((record) => [record.claimId, record.correctness]));
  const claimsByBlockId = new Map<string, string[]>();
  for (const claim of shard.ledger?.claims ?? []) {
    const list = claimsByBlockId.get(claim.anchor.blockId) ?? [];
    list.push(claim.claimId);
    claimsByBlockId.set(claim.anchor.blockId, list);
  }

  const sections: SectionProofChip[] = shard.page.sections.map((section) => {
    const sectionClaimIds = section.blocks.flatMap((block) => claimsByBlockId.get(block.id) ?? []);
    const allChecked =
      sectionClaimIds.length > 0 && sectionClaimIds.every((claimId) => correctnessByClaimId.get(claimId) === 'checked');
    return { anchor: section.anchor, title: section.title, guarantee: allChecked ? 'proven' : 'scored' };
  });

  const completedPrimaryReview = shard.provenance?.assessments.reviews.find(
    (review) => review.role === 'primary-gating' && review.completion === 'completed'
  );

  return {
    guarantee: totalClaims > 0 && checkedClaims === totalClaims ? 'proven' : 'scored',
    checkedClaims,
    totalClaims,
    contradictedClaims,
    reviewedFor: completedPrimaryReview?.persona,
    sections
  };
};
