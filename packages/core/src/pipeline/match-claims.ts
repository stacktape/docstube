import type { ClaimEntity, ClaimLedger, PageEntity } from '@docstube/contracts';
import { claimLedgerSchema } from '@docstube/contracts';
import type { AnchoredClaim } from './anchor-ledger.ts';

// Claim identity matching (trust-model-v2 decision 8: "identity may carry; trust never carries").
// Runs AFTER block matching and AFTER anchoring: a freshly anchored claim REUSES the previous
// shard's claim id when it is the same assertion continuing on the same block thread:
//
//   same block id (block matching already threaded block identity)
//   AND same claim class
//   AND — pass 1 — the same wrapped prose (the marker quote), or — pass 2 — the same predicate.
//
// ONLY the id carries. Predicate, anchor, subscriptions, evidence, correctness, and disposition
// all come from the CURRENT kernel ledger; the previous claim's guarantee and evidence are never
// read, so a dependency-triggered regeneration of unchanged MDX yields ONE claim id shared by the
// ledger and the shard, in the fresh (unchecked) trust state.

export type MatchClaimIdsInput = {
  ledger: ClaimLedger;
  anchored: AnchoredClaim[];
  // The previous shard's page (pre-regeneration) — the source of prior claim ids per block.
  previousPage: PageEntity | undefined;
};

export type MatchedClaimIds = {
  ledger: ClaimLedger;
  anchored: AnchoredClaim[];
};

const claimsByBlockId = (page: PageEntity): Map<string, ClaimEntity[]> => {
  const byBlock = new Map<string, ClaimEntity[]>();
  const collect = (blocks: readonly { id: string; claims: ClaimEntity[] }[]): void => {
    for (const block of blocks) {
      if (block.claims.length > 0) {
        byBlock.set(block.id, block.claims);
      }
    }
  };
  collect(page.preamble);
  for (const section of page.sections) {
    collect(section.blocks);
  }
  return byBlock;
};

export const matchClaimIds = (input: MatchClaimIdsInput): MatchedClaimIds => {
  if (input.previousPage === undefined) {
    return { ledger: input.ledger, anchored: input.anchored };
  }
  const previousByBlock = claimsByBlockId(input.previousPage);
  const usedPreviousIds = new Set<string>();
  // minted claim id -> previous claim id
  const idMapping = new Map<string, string>();

  // Pass 1: exact quote (the marker's wrapped prose IS the legacy quote anchor).
  // Pass 2: exact predicate (quote rephrased but the checkable assertion is unchanged).
  for (const pass of ['quote', 'predicate'] as const) {
    for (const entry of input.anchored) {
      if (idMapping.has(entry.claim.claimId)) {
        continue;
      }
      const candidates = previousByBlock.get(entry.claim.anchor.blockId) ?? [];
      const match = candidates.find(
        (previous) =>
          !usedPreviousIds.has(previous.id) &&
          previous.claimClass === entry.claim.class &&
          (pass === 'quote' ? previous.anchor.quote === entry.quote : previous.text === entry.claim.predicate)
      );
      if (match !== undefined) {
        usedPreviousIds.add(match.id);
        idMapping.set(entry.claim.claimId, match.id);
      }
    }
  }

  if (idMapping.size === 0) {
    return { ledger: input.ledger, anchored: input.anchored };
  }
  const anchored = input.anchored.map((entry) => {
    const previousId = idMapping.get(entry.claim.claimId);
    return previousId === undefined ? entry : { ...entry, claim: { ...entry.claim, claimId: previousId } };
  });
  // Re-parse: id reuse is injective (usedPreviousIds), but the uniqueness invariant is cheap to
  // re-prove and a corrupt mapping must never leave this stage.
  const ledger = claimLedgerSchema.parse({ ...input.ledger, claims: anchored.map((entry) => entry.claim) });
  return { ledger, anchored };
};
