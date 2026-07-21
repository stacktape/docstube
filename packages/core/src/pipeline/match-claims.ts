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
// The identity-threading half of decision 8 is CONFIDENCE-AWARE and GLOBAL (impl-06 finding 4):
// candidates are solved as connected components of the fresh×prior bipartite candidate graph,
// never greedily —
//   - a component pairing exactly ONE fresh with ONE prior claim, on an exactly-threaded block,
//     is a confident match ('exact'): the id and its human threads carry silently;
//   - a component with ANY alternative assignment marks EVERY match inside it 'ambiguous'
//     (drift 'equal-candidates'): ids still carry deterministically, but every carried human
//     thread renders a drift marker ("content changed substantially since this was written");
//   - a claim threading through a POSITIONALLY matched block (content changed) is 'ambiguous'
//     (drift 'block-thread-inexact') even when its own candidate is unique — the block thread
//     itself is a guess;
//   - prior claims nothing threaded onto are ORPHANS, returned explicitly and persisted on the
//     shard — never a silent disappearance.

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

// Union-find over the bipartite node space: fresh nodes are [0, freshCount), prior nodes are
// offset by freshCount.
const connectedComponents = (
  freshCount: number,
  priorCount: number,
  edges: CandidateEdge[]
): Array<{ freshIndexes: number[]; priorIndexes: number[] }> => {
  const parent = Array.from({ length: freshCount + priorCount }, (_, index) => index);
  const find = (node: number): number => {
    while (parent[node] !== node) {
      const next = parent[node] ?? node;
      parent[node] = parent[next] ?? next;
      node = parent[node] ?? node;
    }
    return node;
  };
  const union = (left: number, right: number): void => {
    parent[find(left)] = find(right);
  };
  for (const edge of edges) {
    union(edge.freshIndex, freshCount + edge.priorIndex);
  }
  const byRoot = new Map<number, { freshIndexes: number[]; priorIndexes: number[] }>();
  const componentOf = (root: number) => {
    const existing = byRoot.get(root);
    if (existing !== undefined) {
      return existing;
    }
    const created = { freshIndexes: [] as number[], priorIndexes: [] as number[] };
    byRoot.set(root, created);
    return created;
  };
  // Only nodes touched by at least one edge belong to a matching component.
  const touched = new Set<number>();
  for (const edge of edges) {
    touched.add(edge.freshIndex);
    touched.add(freshCount + edge.priorIndex);
  }
  for (const node of touched) {
    const component = componentOf(find(node));
    if (node < freshCount) {
      component.freshIndexes.push(node);
    } else {
      component.priorIndexes.push(node - freshCount);
    }
  }
  return [...byRoot.values()];
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
  const components = connectedComponents(input.anchored.length, priorClaims.length, edges);

  const matches: ClaimMatch[] = [];
  // minted claim id -> previous claim id
  const idMapping = new Map<string, string>();
  const usedPriorIndexes = new Set<number>();

  for (const component of components) {
    const unique = component.freshIndexes.length === 1 && component.priorIndexes.length === 1;
    // Deterministic assignment inside the component: fresh claims in document order, each taking
    // its first unused candidate (quote-equality preferred over predicate-equality, then prior
    // ledger order). With a non-unique component the SELECTION is arbitrary among equals — which
    // is exactly why every match in it records 'ambiguous'.
    for (const freshIndex of [...component.freshIndexes].toSorted((left, right) => left - right)) {
      const entry = input.anchored[freshIndex];
      if (entry === undefined) {
        continue;
      }
      const candidates = edges
        .filter((edge) => edge.freshIndex === freshIndex && !usedPriorIndexes.has(edge.priorIndex))
        .toSorted((left, right) =>
          left.kind === right.kind ? left.priorIndex - right.priorIndex : left.kind === 'quote' ? -1 : 1
        );
      const chosen = candidates[0];
      const prior = chosen === undefined ? undefined : priorClaims[chosen.priorIndex];
      if (chosen === undefined || prior === undefined) {
        continue;
      }
      usedPriorIndexes.add(chosen.priorIndex);
      idMapping.set(entry.claim.claimId, prior.claimId);
      const drift: ClaimMatchDriftReason[] = [];
      if (!unique) {
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
  }

  // Prior claims nothing threaded onto: explicit orphans, never a silent disappearance.
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
