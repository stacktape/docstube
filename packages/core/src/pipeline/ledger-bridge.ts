import type { BlockEntity, ClaimCorrectness, ClaimEntity, GuaranteeLevel, PageEntity } from '@docstube/contracts';
import type { AnchoredClaim } from './anchor-ledger.ts';

// TEMPORARY BRIDGE — wave 2b-i scaffolding, deleted in wave 2b-iii.
//
// The kernel claim ledger is now the source of truth for what a page asserts, but the downstream
// stages (verify-page's guarantee roll-ups/lifts, shard storage, status, refresh scoping) still
// consume the legacy per-block ClaimEntity records and their guarantee levels. Until 2b-ii
// migrates verification onto the ledger and 2b-iii migrates the shards, this module derives the
// minimal faithful legacy view FROM the kernel ledger:
//   correctness 'checked'      → guarantee 'proven'  (the deterministic lane — lifts blocks)
//   correctness 'unchecked'    → guarantee 'scored'  (assessed by review, not mechanically proven)
//   correctness 'contradicted' → guarantee 'scored'  (2b-ii turns contradictions into gating
//                                                     error findings; until then the claim simply
//                                                     never counts as proven)
// In this wave every anchored claim is 'unchecked', so bridged pages behave exactly like the old
// "prose claims → scored" path; nothing downstream can mistake an unverified claim for a proven one.

export const guaranteeForCorrectness = (correctness: ClaimCorrectness): GuaranteeLevel =>
  correctness === 'checked' ? 'proven' : 'scored';

const legacyClaim = (entry: AnchoredClaim): ClaimEntity => ({
  // Kernel claim ids share the cl_ prefix with legacy claim entities — the id is reused verbatim
  // so the shard's claims and the kernel ledger name the same facts.
  id: entry.claim.claimId,
  kind: 'claim',
  text: entry.claim.predicate,
  // Legacy anchoring is quote-based; the marker's wrapped prose IS the quote.
  anchor: { quote: entry.quote, prefix: '', suffix: '' },
  claimClass: entry.claim.class,
  guarantee: guaranteeForCorrectness(entry.claim.correctness)
});

// Attach the ledger-derived legacy claims to their anchored blocks. Blocks that already carry
// claims keep them: the entity-matching pass carries claims (with stable ids) for content-
// unchanged blocks from the previous shard, and overwriting them would churn stable claim ids
// every run — kernel-side claim id matching is 2b-ii/iii work.
export const attachLedgerClaims = (page: PageEntity, anchored: AnchoredClaim[]): PageEntity => {
  const claimsByBlock = new Map<string, ClaimEntity[]>();
  for (const entry of anchored) {
    const pending = claimsByBlock.get(entry.claim.anchor.blockId) ?? [];
    pending.push(legacyClaim(entry));
    claimsByBlock.set(entry.claim.anchor.blockId, pending);
  }
  const withClaims = (block: BlockEntity): BlockEntity => {
    const pending = claimsByBlock.get(block.id);
    return pending === undefined || block.claims.length > 0 ? block : { ...block, claims: pending };
  };
  return {
    ...page,
    preamble: page.preamble.map(withClaims),
    sections: page.sections.map((section) => ({ ...section, blocks: section.blocks.map(withClaims) }))
  };
};
