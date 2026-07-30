import type { FingerprintSnapshot, KnowledgeSubject } from '@docstube/contracts';
import { hashValue, knowledgeFactSchema, knowledgeNeedSchema, symbolSourceKeySchema } from '@docstube/contracts';
import { materialFingerprint, materialFingerprintIndex } from '@docstube/codemap';
import type { KnowledgeState } from './knowledge-store.ts';

// STALENESS IS REAL (dx-knowledge-v2 decision 6). The old store had no notion of it at all: an
// answer about a function survived that function being rewritten, and kept being injected into
// every writer prompt as maintainer-attested truth.
//
// A fact binds to its subject two ways. The durable side is the identity thread — for a code
// subject, the MATERIAL fingerprint of the symbol (signature + cited values + declared schema
// shape, never the body), reused from the typed fingerprint ladder rather than reinvented. The
// answer-time side is that fingerprint's value when the answer was given, stored on the fact.
//
// On every run the two are compared against the CURRENT snapshot:
//   * material fingerprint unchanged                    → nothing happens;
//   * symbol re-keyed but material fingerprint intact   → cosmetic refactor: the need REBINDS to
//                                                         the new symbol hash, silently, no re-ask;
//   * material fingerprint gone (or ambiguous)          → material change: the fact flips to
//                                                         `needs-revalidation`, its citing pages are
//                                                         flagged, and the need reopens for ONE
//                                                         targeted re-ask.

const subjectSymbolHash = (subject: KnowledgeSubject): string | undefined =>
  subject.kind === 'topic' ? undefined : subject.symbolHash;

// The subject's fingerprint right now. Topics bind to no code, so their fingerprint is the subject
// identity itself — stable by construction, and therefore never stale.
export const currentSubjectFingerprint = (
  subject: KnowledgeSubject,
  fingerprints: FingerprintSnapshot | undefined
): string => {
  const symbolMaterial = (symbolHash: string): string =>
    materialFingerprint(
      symbolHash,
      fingerprints?.symbols.find((symbol) => symbol.symbolHash === symbolHash)
    );
  switch (subject.kind) {
    case 'topic':
      return hashValue({ kind: 'topic', topic: subject.topic });
    case 'entity-thread':
      return subject.symbolHash === undefined
        ? hashValue({ kind: 'entity-thread', entityThreadId: subject.entityThreadId })
        : symbolMaterial(subject.symbolHash);
    default:
      return symbolMaterial(subject.symbolHash);
  }
};

export type KnowledgeRebind = { needId: string; fromSymbolHash: string; toSymbolHash: string };
export type KnowledgeStaleFact = { factId: string; needId: string; question: string; reason: string };

export type RevalidationResult = {
  state: KnowledgeState;
  rebound: KnowledgeRebind[];
  stale: KnowledgeStaleFact[];
  // Facts whose subject came back into agreement (a reverted change) — recorded so the caller can
  // report the flip rather than silently un-staling an answer a human was already told about.
  revalidated: string[];
};

export const revalidateKnowledge = (input: {
  state: KnowledgeState;
  fingerprints: FingerprintSnapshot;
}): RevalidationResult => {
  const needsById = new Map(input.state.needs.map((need) => [need.needId, need]));
  const byMaterial = materialFingerprintIndex(input.fingerprints);
  const rebound: KnowledgeRebind[] = [];
  const stale: KnowledgeStaleFact[] = [];
  const revalidated: string[] = [];
  const facts = input.state.facts.map((fact) => {
    if (fact.status === 'superseded') {
      return fact;
    }
    const need = needsById.get(fact.needId);
    if (need === undefined) {
      return fact;
    }
    const expected = currentSubjectFingerprint(need.subject, input.fingerprints);
    if (expected === fact.subjectFingerprint) {
      if (fact.status === 'needs-revalidation') {
        revalidated.push(fact.factId);
        return knowledgeFactSchema.parse({ ...fact, status: 'active' });
      }
      return fact;
    }
    const symbolHash = subjectSymbolHash(need.subject);
    const candidates = symbolHash === undefined ? [] : (byMaterial.get(fact.subjectFingerprint) ?? []);
    if (symbolHash !== undefined && candidates.length === 1) {
      // Cosmetic refactor: same material facts under a new declaration hash. Rebind and stay quiet.
      const nextHash = candidates[0]!;
      needsById.set(
        need.needId,
        knowledgeNeedSchema.parse({
          ...need,
          subject: { ...need.subject, symbolHash: symbolSourceKeySchema.parse(nextHash) }
        })
      );
      rebound.push({ needId: need.needId, fromSymbolHash: symbolHash, toSymbolHash: nextHash });
      if (fact.status === 'needs-revalidation') {
        revalidated.push(fact.factId);
        return knowledgeFactSchema.parse({ ...fact, status: 'active' });
      }
      return fact;
    }
    if (fact.status === 'needs-revalidation') {
      return fact;
    }
    stale.push({
      factId: fact.factId,
      needId: need.needId,
      question: need.question,
      reason:
        symbolHash === undefined
          ? 'the subject this answer was given about no longer matches its recorded fingerprint'
          : candidates.length > 1
            ? 'the subject matches several symbols after the change, so it cannot be rebound without guessing'
            : 'the subject changed materially (signature, a cited value, or its declared schema shape)'
    });
    // Reopen the need for ONE targeted re-ask; the stale fact stays in context, clearly labelled.
    needsById.set(need.needId, knowledgeNeedSchema.parse({ ...need, status: 'open' }));
    return knowledgeFactSchema.parse({ ...fact, status: 'needs-revalidation' });
  });
  return {
    state: {
      ...input.state,
      needs: input.state.needs.map((need) => needsById.get(need.needId) ?? need),
      facts
    },
    rebound,
    stale,
    revalidated
  };
};
