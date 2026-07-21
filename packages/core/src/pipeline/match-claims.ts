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
// ledger and the shard, in the fresh trust state.
//
// The identity-threading half of decision 8 (the confidence ladder):
//   - a UNIQUE candidate → confident match ('exact'): the id and its human threads carry;
//   - MULTIPLE equal candidates → the id still carries (deterministically, the first candidate in
//     document order) but the match records confidence 'ambiguous' — a DRIFT MARKER the shard/UI
//     surface as "content changed substantially since this was written";
//   - prior claims left unmatched → ORPHANS, returned explicitly and journaled by the caller —
//     never silently dropped (match-entities.ts excludes cl_ ids from its tombstone diff exactly
//     because THIS stage owns claim-identity continuity and orphan surfacing).

export type ClaimMatchConfidence = 'exact' | 'ambiguous';

export type ClaimMatch = {
  // The kernel-minted id the fresh claim carried INTO matching (replaced by priorId on the way out).
  freshId: string;
  // The previous shard's claim id the fresh claim now threads onto.
  priorId: string;
  confidence: ClaimMatchConfidence;
};

export type MatchClaimIdsInput = {
  ledger: ClaimLedger;
  anchored: AnchoredClaim[];
  // The previous shard's page (pre-regeneration) — the source of prior claim ids per block.
  previousPage: PageEntity | undefined;
};

export type MatchedClaimIds = {
  ledger: ClaimLedger;
  anchored: AnchoredClaim[];
  matches: ClaimMatch[];
  // Previous claim ids no fresh claim threaded onto — surfaced for re-attachment or dismissal.
  orphans: string[];
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
    return { ledger: input.ledger, anchored: input.anchored, matches: [], orphans: [] };
  }
  const previousByBlock = claimsByBlockId(input.previousPage);
  const usedPreviousIds = new Set<string>();
  const matches: ClaimMatch[] = [];
  // minted claim id -> previous claim id
  const idMapping = new Map<string, string>();

  // Pass 1: exact quote (the marker's wrapped prose IS the legacy quote anchor).
  // Pass 2: exact predicate (quote rephrased but the checkable assertion is unchanged).
  for (const pass of ['quote', 'predicate'] as const) {
    for (const entry of input.anchored) {
      if (idMapping.has(entry.claim.claimId)) {
        continue;
      }
      // Candidates computed PER FRESH CLAIM: every still-unused previous claim on the same block
      // thread with the same class and the same quote/predicate is an equal candidate.
      const candidates = (previousByBlock.get(entry.claim.anchor.blockId) ?? []).filter(
        (previous) =>
          !usedPreviousIds.has(previous.id) &&
          previous.claimClass === entry.claim.class &&
          (pass === 'quote' ? previous.anchor.quote === entry.quote : previous.text === entry.claim.predicate)
      );
      const match = candidates[0];
      if (match !== undefined) {
        usedPreviousIds.add(match.id);
        idMapping.set(entry.claim.claimId, match.id);
        matches.push({
          freshId: entry.claim.claimId,
          priorId: match.id,
          // A unique candidate is a confident thread; equal alternatives mean the thread is kept
          // (an id must exist) but marked drifted for every carried human thread.
          confidence: candidates.length === 1 ? 'exact' : 'ambiguous'
        });
      }
    }
  }

  // Prior claims nothing threaded onto: explicit orphans, never a silent disappearance.
  const orphans: string[] = [];
  for (const claims of previousByBlock.values()) {
    for (const previous of claims) {
      if (!usedPreviousIds.has(previous.id)) {
        orphans.push(previous.id);
      }
    }
  }

  if (idMapping.size === 0) {
    return { ledger: input.ledger, anchored: input.anchored, matches, orphans };
  }
  const anchored = input.anchored.map((entry) => {
    const previousId = idMapping.get(entry.claim.claimId);
    return previousId === undefined ? entry : { ...entry, claim: { ...entry.claim, claimId: previousId } };
  });
  // Re-parse: id reuse is injective (usedPreviousIds), but the uniqueness invariant is cheap to
  // re-prove and a corrupt mapping must never leave this stage.
  const ledger = claimLedgerSchema.parse({ ...input.ledger, claims: anchored.map((entry) => entry.claim) });
  return { ledger, anchored, matches, orphans };
};
