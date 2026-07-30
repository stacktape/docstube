import type { StructuralFinding } from '@docstube/contracts';
import { structuralScopeKey } from '@docstube/contracts';

// FINDING LIFECYCLE (quality-ci-reader-v2 decision 17). Three rules, and they are the whole
// contract:
//
// 1. Identity is the STABLE SEMANTIC KEY (detector + scope + facet), never a minted id — the same
//    defect re-detected next run collapses onto the same record instead of accumulating duplicates.
// 2. AUTO-RESOLVE ONLY AFTER THE SAME SCOPE WAS RE-EVALUATED. A finding on a page this run did not
//    look at is carried forward verbatim. Resolving it because "the detectors did not raise it"
//    would silently clear work items every time a run skipped a scope for budget reasons.
// 3. SUPPRESSION CARRIES A SCOPE FINGERPRINT AND REOPENS ON MATERIAL CHANGE. A user who suppressed
//    "no Pricing section here, on purpose" keeps that decision — until the page's structure moves,
//    at which point the decision was made about content that no longer exists.

export type ReconcileStructuralFindingsInput = {
  // What is already committed for the scopes in play (page shards + group shards).
  prior: readonly StructuralFinding[];
  // What the detectors raised this pass.
  fresh: readonly StructuralFinding[];
  // Scope keys (see `structuralScopeKey`) this pass actually re-evaluated. A scope skipped for
  // budget, or belonging to an unchanged page, must NOT appear here.
  evaluatedScopeKeys: readonly string[];
};

export const reconcileStructuralFindings = (input: ReconcileStructuralFindingsInput): StructuralFinding[] => {
  const priorByKey = new Map(input.prior.map((finding) => [finding.key, finding]));
  const freshByKey = new Map(input.fresh.map((finding) => [finding.key, finding]));
  const evaluated = new Set(input.evaluatedScopeKeys);
  const reconciled: StructuralFinding[] = [];

  for (const [key, fresh] of freshByKey) {
    const previous = priorByKey.get(key);
    if (previous?.status.state === 'suppressed') {
      // The suppression was a judgment about a specific state of the scope. Identical fingerprint →
      // the judgment still applies and the finding stays out of the way. Different fingerprint →
      // the content moved under the decision, so it reopens rather than quietly persisting.
      reconciled.push(
        previous.status.scopeFingerprint === fresh.scopeFingerprint
          ? { ...fresh, status: previous.status }
          : { ...fresh, status: { state: 'open' } }
      );
      continue;
    }
    reconciled.push({ ...fresh, status: { state: 'open' } });
  }

  for (const [key, previous] of priorByKey) {
    if (freshByKey.has(key)) {
      continue;
    }
    if (!evaluated.has(structuralScopeKey(previous.scope))) {
      // Not looked at this pass — the record survives exactly as it was. Anything else would be
      // inventing a verdict from an absence of evidence.
      reconciled.push(previous);
      continue;
    }
    // Re-evaluated and no longer detected: resolved. A suppressed finding resolves too — the
    // condition it was hiding is gone, so keeping it suppressed would leave a dead exemption behind.
    reconciled.push({ ...previous, status: { state: 'resolved' } });
  }

  // Key order: committed state is byte-stable, so a run that changes nothing produces no diff.
  return reconciled.toSorted((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
};

export const isOpenStructuralFinding = (finding: StructuralFinding): boolean => finding.status.state === 'open';

// Impact ordering for repair: `refine` works the worst first, and a tie must break the same way on
// every machine.
const impactRank = { high: 0, medium: 1, low: 2 } as const;

export const compareStructuralImpact = (left: StructuralFinding, right: StructuralFinding): number =>
  impactRank[left.impact] === impactRank[right.impact]
    ? left.key < right.key
      ? -1
      : left.key > right.key
        ? 1
        : 0
    : impactRank[left.impact] - impactRank[right.impact];
