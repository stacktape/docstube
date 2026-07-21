import type { BlockEntity, ClaimCorrectness, ClaimEntity, GuaranteeLevel, PageEntity } from '@docstube/contracts';
import { CoreError } from '../errors.ts';
import type { AnchoredClaim } from './anchor-ledger.ts';

// TEMPORARY BRIDGE — wave 2b-i scaffolding, deleted in wave 2b-iii.
//
// The kernel claim ledger is now the source of truth for what a page asserts, but the downstream
// stages (verify-page's guarantee roll-ups/lifts, shard storage, status, refresh scoping) still
// consume the legacy per-block ClaimEntity records and their guarantee levels. Until 2b-iii
// migrates the shards, this module derives the minimal faithful legacy view FROM the verified
// kernel ledger:
//   correctness 'checked'      → guarantee 'proven'  (LIVE since 2b-ii: claim verification mints
//                                checked for grounded code-structure claims, passing value
//                                predicates, and legitimately execution-covered behavior claims —
//                                liftClaimGroundedBlocks then lifts fully-proven blocks)
//   correctness 'unchecked'    → guarantee 'scored'  (assessed by review, not mechanically proven)
//   correctness 'contradicted' → NEVER PROJECTED (see below)

export const guaranteeForCorrectness = (correctness: ClaimCorrectness): GuaranteeLevel => {
  if (correctness === 'contradicted') {
    // CONTRADICTION GATES UPSTREAM (wave 2b-ii): verifyClaims turns every contradicted claim into
    // a blocking 'claim-verification' error finding, so the page FAILS the attempt and re-enters
    // the bounded retry loop — the bridge only ever runs on the clean path, after the gate held.
    // A contradicted claim reaching this projection therefore means a caller bridged an UNGATED
    // ledger — a kernel sequencing bug. It must hard-fail: there is no legacy guarantee level that
    // can express "caught lie", and projecting 'scored' would ship one as neutral prose.
    throw new CoreError(
      'pipeline-failed',
      'kernel invariant violated: the legacy ledger bridge received a contradicted claim — contradictions gate through claim-verification findings BEFORE bridging and must never render as content'
    );
  }
  return correctness === 'checked' ? 'proven' : 'scored';
};

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

// Project the kernel ledger onto the legacy per-block view. The ledger is the ONLY source: every
// block's claims are REPLACED with the ledger-derived set (empty when the ledger anchors nothing
// there). Claims carried from a previous shard are never preserved — claim identity continuity is
// match-claims.ts reusing ids INSIDE the ledger, so replacing here keeps stable ids without
// carrying stale guarantees or evidence ("identity may carry; trust never carries").
export const attachLedgerClaims = (page: PageEntity, anchored: AnchoredClaim[]): PageEntity => {
  const claimsByBlock = new Map<string, ClaimEntity[]>();
  for (const entry of anchored) {
    const pending = claimsByBlock.get(entry.claim.anchor.blockId) ?? [];
    pending.push(legacyClaim(entry));
    claimsByBlock.set(entry.claim.anchor.blockId, pending);
  }
  const withClaims = (block: BlockEntity): BlockEntity => ({ ...block, claims: claimsByBlock.get(block.id) ?? [] });
  return {
    ...page,
    preamble: page.preamble.map(withClaims),
    sections: page.sections.map((section) => ({ ...section, blocks: section.blocks.map(withClaims) }))
  };
};
