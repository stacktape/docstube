import type { ClaimLedger, ClaimMatchDriftReason, ClaimMatching, LedgerClaim } from '@docstube/contracts';
import { claimLedgerSchema } from '@docstube/contracts';
import type { BlockMatchConfidence } from '../entities/match-entities.ts';
import type { AnchoredClaim } from './anchor-ledger.ts';

// Claim identity matching (trust-model-v2 decision 8: "identity may carry; trust never carries").
// Runs AFTER block matching and AFTER anchoring: a freshly anchored claim REUSES the previous
// kernel ledger's claim id when it is the same assertion continuing on the same block thread:
//
//   same carried block id (block matching already threaded block identity)
//   AND same claim class
//   AND the same wrapped prose (the marker quote) OR the same predicate.
//
// ONLY the id carries. Predicate, anchor, subscriptions, evidence, correctness, and disposition
// all come from the CURRENT kernel ledger; the previous claim's state is never read.
//
// The identity-threading half of decision 8 solves a deterministic MAXIMUM-CARDINALITY bipartite
// matching over the fresh×prior candidate graph (impl-07 finding 6 — greedy first-unused-prior
// assignment orphaned reachable priors: with edges f1→{p1,p2} and f2→{p1} it matched only f1→p1
// and dropped p2 although a two-edge matching exists):
//   - the matching is computed by augmenting paths (Kuhn) with stable ordering — fresh claims in
//     document order, candidates quote-equality first then prior-ledger order — so the chosen
//     maximum is deterministic;
//   - a matched pair is 'exact' only when NO alternative maximum matching assigns its fresh claim
//     differently (removing the pair's edge strictly shrinks the maximum). If an alternative
//     maximum exists, the pair is 'ambiguous' (drift 'equal-candidates'): the id still carries
//     deterministically, but every carried human thread renders a drift marker;
//   - a claim threading through a POSITIONALLY matched block (content changed) is 'ambiguous'
//     (drift 'block-thread-inexact') even when its own candidate is unique — the block thread
//     itself is a guess;
//   - prior claims outside the chosen maximum matching are ORPHANS, returned explicitly and
//     persisted on the shard — never a silent disappearance.

export type ClaimMatchConfidence = 'exact' | 'ambiguous';

export type ClaimMatch = {
  // The kernel-minted id the fresh claim carried INTO matching (replaced by priorId on the way out).
  freshId: string;
  // The previous ledger's claim id the fresh claim now threads onto.
  priorId: string;
  confidence: ClaimMatchConfidence;
  drift: ClaimMatchDriftReason[];
};

export type MatchClaimIdsInput = {
  ledger: ClaimLedger;
  anchored: AnchoredClaim[];
  // The previous shard's committed kernel ledger — the ONLY source of prior claim identity.
  previousLedger: ClaimLedger | undefined;
  // Carried block id → thread confidence, from entity matching. A block absent from this map was
  // not threaded at all (fresh block), so no prior claim can live on it.
  blockConfidence: ReadonlyMap<string, BlockMatchConfidence>;
};

export type MatchedClaimIds = {
  ledger: ClaimLedger;
  anchored: AnchoredClaim[];
  matches: ClaimMatch[];
  // Previous claim ids no fresh claim threaded onto — surfaced for re-attachment or dismissal.
  orphans: string[];
  // The typed records the shard persists (schema-validated shape of the two fields above).
  matching: ClaimMatching;
};

type CandidateEdge = { freshIndex: number; priorIndex: number; kind: 'quote' | 'predicate' };

const candidateEdges = (fresh: AnchoredClaim[], prior: LedgerClaim[]): CandidateEdge[] => {
  const edges: CandidateEdge[] = [];
  for (const [freshIndex, entry] of fresh.entries()) {
    for (const [priorIndex, previous] of prior.entries()) {
      if (previous.anchor.blockId !== entry.claim.anchor.blockId || previous.class !== entry.claim.class) {
        continue;
      }
      if (previous.quote === entry.quote) {
        edges.push({ freshIndex, priorIndex, kind: 'quote' });
      } else if (previous.predicate === entry.claim.predicate) {
        edges.push({ freshIndex, priorIndex, kind: 'predicate' });
      }
    }
  }
  return edges;
};

// Ordered adjacency: fresh index → candidate prior indexes, quote-equality edges before
// predicate-equality edges, then prior-ledger order. The order makes both the chosen maximum
// matching and the augmenting search deterministic.
const orderedAdjacency = (freshCount: number, edges: CandidateEdge[]): Map<number, number[]> => {
  const adjacency = new Map<number, number[]>();
  for (let freshIndex = 0; freshIndex < freshCount; freshIndex += 1) {
    const candidates = edges
      .filter((edge) => edge.freshIndex === freshIndex)
      .toSorted((left, right) =>
        left.kind === right.kind ? left.priorIndex - right.priorIndex : left.kind === 'quote' ? -1 : 1
      )
      .map((edge) => edge.priorIndex);
    if (candidates.length > 0) {
      adjacency.set(freshIndex, candidates);
    }
  }
  return adjacency;
};

// Maximum-cardinality bipartite matching by augmenting paths (Kuhn's algorithm). Small graphs
// (claims on one page), deterministic through the stable adjacency order. Returns prior→fresh.
// `banned` excludes one edge — the alternative-maximum probe for ambiguity classification.
const solveMaximumMatching = (
  adjacency: ReadonlyMap<number, readonly number[]>,
  banned?: { freshIndex: number; priorIndex: number }
): Map<number, number> => {
  const priorToFresh = new Map<number, number>();
  const augment = (freshIndex: number, visited: Set<number>): boolean => {
    for (const priorIndex of adjacency.get(freshIndex) ?? []) {
      if (banned !== undefined && banned.freshIndex === freshIndex && banned.priorIndex === priorIndex) {
        continue;
      }
      if (visited.has(priorIndex)) {
        continue;
      }
      visited.add(priorIndex);
      const holder = priorToFresh.get(priorIndex);
      if (holder === undefined || augment(holder, visited)) {
        priorToFresh.set(priorIndex, freshIndex);
        return true;
      }
    }
    return false;
  };
  for (const freshIndex of [...adjacency.keys()].toSorted((left, right) => left - right)) {
    augment(freshIndex, new Set());
  }
  return priorToFresh;
};

export const matchClaimIds = (input: MatchClaimIdsInput): MatchedClaimIds => {
  const priorClaims = input.previousLedger?.claims ?? [];
  if (priorClaims.length === 0) {
    return {
      ledger: input.ledger,
      anchored: input.anchored,
      matches: [],
      orphans: [],
      matching: { matches: [], orphans: [] }
    };
  }

  const edges = candidateEdges(input.anchored, priorClaims);
  const adjacency = orderedAdjacency(input.anchored.length, edges);
  // The deterministic maximum matching (prior→fresh), inverted to document order for emission.
  const maximum = solveMaximumMatching(adjacency);
  const freshToPrior = new Map<number, number>(
    [...maximum].map(([priorIndex, freshIndex]) => [freshIndex, priorIndex])
  );

  const matches: ClaimMatch[] = [];
  // minted claim id -> previous claim id
  const idMapping = new Map<string, string>();
  const usedPriorIndexes = new Set<number>(maximum.keys());

  for (const freshIndex of [...freshToPrior.keys()].toSorted((left, right) => left - right)) {
    const entry = input.anchored[freshIndex];
    const priorIndex = freshToPrior.get(freshIndex);
    const prior = priorIndex === undefined ? undefined : priorClaims[priorIndex];
    if (entry === undefined || priorIndex === undefined || prior === undefined) {
      continue;
    }
    idMapping.set(entry.claim.claimId, prior.claimId);
    const drift: ClaimMatchDriftReason[] = [];
    // Ambiguity = an ALTERNATIVE maximum matching exists that assigns this fresh claim
    // differently: removing this pair's edge and re-solving still reaches the same cardinality.
    // A pair whose removal strictly shrinks the maximum is forced — a confident match.
    if (solveMaximumMatching(adjacency, { freshIndex, priorIndex }).size === maximum.size) {
      drift.push('equal-candidates');
    }
    // A positionally threaded (content-changed) block makes the claim thread inexact no matter
    // how unique the claim-level candidate was.
    if (input.blockConfidence.get(entry.claim.anchor.blockId) !== 'exact') {
      drift.push('block-thread-inexact');
    }
    matches.push({
      freshId: entry.claim.claimId,
      priorId: prior.claimId,
      confidence: drift.length === 0 ? 'exact' : 'ambiguous',
      drift
    });
  }

  // Prior claims outside the maximum matching: explicit orphans, never a silent disappearance.
  const orphans = priorClaims
    .filter((_, priorIndex) => !usedPriorIndexes.has(priorIndex))
    .map((previous) => previous.claimId);

  const matching: ClaimMatching = {
    matches: matches.map((match) => ({ claimId: match.priorId, confidence: match.confidence, drift: match.drift })),
    orphans: orphans.map((claimId) => ({ claimId }))
  };

  if (idMapping.size === 0) {
    return { ledger: input.ledger, anchored: input.anchored, matches, orphans, matching };
  }
  const anchored = input.anchored.map((entry) => {
    const previousId = idMapping.get(entry.claim.claimId);
    return previousId === undefined ? entry : { ...entry, claim: { ...entry.claim, claimId: previousId } };
  });
  // Re-parse: id reuse is injective (usedPriorIndexes), but the uniqueness invariant is cheap to
  // re-prove and a corrupt mapping must never leave this stage.
  const ledger = claimLedgerSchema.parse({ ...input.ledger, claims: anchored.map((entry) => entry.claim) });
  return { ledger, anchored, matches, orphans, matching };
};
