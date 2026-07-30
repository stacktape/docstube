import type {
  FactEvidenceRef,
  FingerprintSnapshot,
  Flag,
  KnowledgeFact,
  KnowledgeFactScope,
  KnowledgeNeed,
  PageShard
} from '@docstube/contracts';
import { idPrefixes, knowledgeFactSchema, knowledgeNeedSchema, mintId } from '@docstube/contracts';
import { CoreError } from '../errors.ts';
import type { ManifestStore } from '../state/manifest-store.ts';
import { currentSubjectFingerprint } from './knowledge-revalidation.ts';
import { normalizeMissingFact, questionDiscriminator } from './knowledge-slots.ts';
import {
  activeFactForNeed,
  knowledgeContextFacts,
  knowledgeFactFragmentHash,
  sortFacts,
  writeKnowledgeFact,
  writeKnowledgeNeed
} from './knowledge-store.ts';
import type { KnowledgeState } from './knowledge-store.ts';

// ANSWERS ARE ADDITIVE. The old store overwrote `<question-hash>.md` on every answer: the previous
// answer, whoever wrote it, and when, were gone. Re-answering now SUPERSEDES — the prior fact is
// retained with its author and timestamp, and the new fact records `supersedes`, so the chain reads
// as history (dx-knowledge-v2 decision 6).
//
// Propagation is the second axis (decision 8): a saved answer is not an applied answer. A new fact
// starts at `answered`, becomes `propagation-pending` while the pages that consumed the previous
// answer (or asked the question) are still stale, and reaches `applied` once none are.
//
// SEAMS for the two follow-ups that are deliberately NOT built here:
//   * The auto-answer researcher agent (decision 7) plugs into `answerKnowledgeNeed` with
//     `origin: 'ai'`, the evidence it cited, and `successfulAttemptId` pointing at the attempt it
//     appended to the need's `researchTrail`. It also owns need CLASSIFICATION — capture currently
//     mints every need as human-only `intent-policy` (knowledge-session.ts), which the researcher
//     replaces with external-world / derivable where it may act.
//   * GitHub `/answer` ingestion (decision 5) plugs into the same function with
//     `origin: 'github-answer'` and `author: 'github:<login>'` after the Action has verified the
//     replying user's write access; everything downstream (supersession, staleness, propagation)
//     is already shared.

export type AnswerKnowledgeNeedInput = {
  repoRoot: string;
  state: KnowledgeState;
  needId: string;
  statement: string;
  // 'user' = CLI/local UI, 'github-answer' = an ingested `/answer` reply, 'ai' = the researcher
  // agent (must cite evidence — enforced by the contract).
  origin: KnowledgeFact['origin'];
  author: string;
  evidence?: FactEvidenceRef[] | undefined;
  successfulAttemptId?: string | undefined;
  // The answer-time revision fingerprint of the subject; computed from the run's fingerprint
  // snapshot when one is available.
  fingerprints?: FingerprintSnapshot | undefined;
  at?: string | undefined;
};

export type AnswerKnowledgeNeedResult = {
  state: KnowledgeState;
  fact: KnowledgeFact;
  supersededFactId?: string;
};

// Facts are project-scoped: docstube does not mint entity-thread ids yet, and a fabricated one
// would be a lie in a public data format. Invalidation does not depend on it — it runs off the
// per-page consumed-dependency records, which are strictly more precise than a scope label.
const defaultScope: KnowledgeFactScope = { kind: 'project' };

export const answerKnowledgeNeed = async (input: AnswerKnowledgeNeedInput): Promise<AnswerKnowledgeNeedResult> => {
  const need = input.state.needs.find((candidate) => candidate.needId === input.needId);
  if (need === undefined) {
    throw new CoreError('state-corrupt', `cannot answer unknown knowledge need "${input.needId}"`, {
      needId: input.needId
    });
  }
  const prior = activeFactForNeed(input.state.facts, need.needId);
  const answeredAt = input.at ?? new Date().toISOString();
  const fact = knowledgeFactSchema.parse({
    schemaVersion: 1,
    factId: mintId(idPrefixes.knowledgeFact),
    needId: need.needId,
    statement: input.statement.trim(),
    origin: input.origin,
    author: input.author,
    evidence: input.evidence ?? [],
    answeredAt,
    subjectFingerprint: currentSubjectFingerprint(need.subject, input.fingerprints),
    ...(input.successfulAttemptId === undefined ? {} : { successfulAttemptId: input.successfulAttemptId }),
    scope: defaultScope,
    status: 'active',
    propagation: 'answered',
    ...(prior === undefined ? {} : { supersedes: prior.factId })
  });
  // intent-policy is human-only, so an AI answer to one can never claim 'auto-answered'.
  const nextNeedStatus =
    input.origin === 'ai' && need.kind !== 'intent-policy' ? ('auto-answered' as const) : ('answered' as const);
  const updatedNeed = knowledgeNeedSchema.parse({ ...need, status: nextNeedStatus });

  const superseded = prior === undefined ? undefined : knowledgeFactSchema.parse({ ...prior, status: 'superseded' });
  const facts =
    superseded === undefined
      ? [...input.state.facts, fact]
      : [
          ...input.state.facts.map((candidate) => (candidate.factId === superseded.factId ? superseded : candidate)),
          fact
        ];
  if (superseded !== undefined) {
    await writeKnowledgeFact(input.repoRoot, superseded);
  }
  await writeKnowledgeFact(input.repoRoot, fact);
  await writeKnowledgeNeed(input.repoRoot, updatedNeed);
  return {
    state: {
      ...input.state,
      needs: input.state.needs.map((candidate) => (candidate.needId === need.needId ? updatedNeed : candidate)),
      facts: sortFacts(facts)
    },
    fact,
    ...(prior === undefined ? {} : { supersededFactId: prior.factId })
  };
};

// An EXPLICIT merge — the only way a need is ever collapsed into another. `suggestedNeedMerges`
// proposes candidates for the queue; a human (or a queue action) decides, and the merged need is
// retained as a pointer, never deleted.
export const mergeKnowledgeNeed = async (input: {
  repoRoot: string;
  state: KnowledgeState;
  needId: string;
  into: string;
}): Promise<KnowledgeState> => {
  const need = input.state.needs.find((candidate) => candidate.needId === input.needId);
  const survivor = input.state.needs.find((candidate) => candidate.needId === input.into);
  if (need === undefined || survivor === undefined) {
    throw new CoreError('state-corrupt', `cannot merge "${input.needId}" into "${input.into}" — unknown need`, {
      needId: input.needId,
      into: input.into
    });
  }
  const merged = knowledgeNeedSchema.parse({ ...need, status: 'merged', mergedInto: survivor.needId });
  const absorbed = knowledgeNeedSchema.parse({
    ...survivor,
    requestingPages: [...new Set([...survivor.requestingPages, ...need.requestingPages])]
  });
  await writeKnowledgeNeed(input.repoRoot, merged);
  await writeKnowledgeNeed(input.repoRoot, absorbed);
  return {
    ...input.state,
    needs: input.state.needs.map((candidate) =>
      candidate.needId === merged.needId ? merged : candidate.needId === absorbed.needId ? absorbed : candidate
    )
  };
};

// Pages whose committed generation consumed knowledge that has since changed — the causal
// invalidation edge of dx-knowledge-v2 decision 8. It CONSUMES the dependency records
// ProvenanceV2 already carries (assemble-provenance.ts writes one consumed fragment per injected
// fact); nothing here re-derives dependencies.
export type KnowledgeDirtyPages = {
  pageIds: Set<string>;
  byFact: Map<string, string[]>;
};

export const knowledgeDirtyPages = async (input: {
  store: ManifestStore;
  locales: string[];
  pageIds: string[];
  state: KnowledgeState;
}): Promise<KnowledgeDirtyPages> => {
  const context = knowledgeContextFacts(input.state);
  const expectedHashById = new Map(context.map((fact) => [fact.factId, knowledgeFactFragmentHash(fact)]));
  const needById = new Map(input.state.needs.map((need) => [need.needId, need]));
  // Which fact SUPERSEDED a given fact id, so a page still citing the old one is attributed to the
  // answer that replaced it ("answer saved; 2 pages regenerating").
  const successorOf = new Map<string, string>();
  for (const fact of input.state.facts) {
    if (fact.supersedes !== undefined) {
      successorOf.set(fact.supersedes, fact.factId);
    }
  }
  const requestingPagesByFact = new Map(
    context.map((fact) => [fact.factId, needById.get(fact.needId)?.requestingPages ?? []])
  );

  const pageIds = new Set<string>();
  const byFact = new Map<string, string[]>();
  const markDirty = (factId: string | undefined, pageId: string) => {
    pageIds.add(pageId);
    if (factId === undefined) {
      return;
    }
    const bucket = byFact.get(factId);
    if (bucket === undefined) {
      byFact.set(factId, [pageId]);
    } else if (!bucket.includes(pageId)) {
      bucket.push(pageId);
    }
  };

  const consumedByPage = new Map<string, Map<string, string>>();
  for (const locale of input.locales) {
    for (const pageId of input.pageIds) {
      let shard: PageShard | undefined;
      try {
        shard = await input.store.readPageShard({ locale, pageId });
      } catch {
        // A shard that cannot be read is the manifest layer's integrity problem, not knowledge's;
        // its own readers fail closed. Here it simply contributes no dependency edges.
        shard = undefined;
      }
      if (shard === undefined) {
        continue;
      }
      const consumed = consumedByPage.get(pageId) ?? new Map<string, string>();
      for (const fragment of shard.provenance?.dependencies.consumed ?? []) {
        if (fragment.kind !== 'knowledge-fact') {
          continue;
        }
        consumed.set(fragment.id, fragment.hash);
        const expected = expectedHashById.get(fragment.id);
        if (expected === undefined) {
          // The fact it cited is superseded or gone: the page is quoting an answer that no longer
          // stands.
          markDirty(successorOf.get(fragment.id), pageId);
        } else if (expected !== fragment.hash) {
          markDirty(fragment.id, pageId);
        }
      }
      consumedByPage.set(pageId, consumed);
    }
  }

  // The pages that ASKED never consumed the answer yet — they are exactly as stale as a page whose
  // fact changed, and they are the reason "answer saved; N pages regenerating" is truthful.
  const knownPageIds = new Set(input.pageIds);
  for (const [factId, requestingPages] of requestingPagesByFact) {
    for (const pageId of requestingPages) {
      if (!knownPageIds.has(pageId)) {
        continue;
      }
      if (!(consumedByPage.get(pageId)?.has(factId) ?? false)) {
        markDirty(factId, pageId);
      }
    }
  }

  return { pageIds, byFact };
};

// Derive propagation from reality rather than bookkeeping: a fact with no stale consumer is
// 'applied', one with stale consumers is 'propagation-pending'. Running it at the start of every
// run (and right after an answer) means the status can never drift from what the pages actually
// contain.
export const reconcileKnowledgePropagation = async (input: {
  repoRoot: string;
  store: ManifestStore;
  locales: string[];
  pageIds: string[];
  state: KnowledgeState;
}): Promise<{ state: KnowledgeState; dirty: KnowledgeDirtyPages }> => {
  const dirty = await knowledgeDirtyPages(input);
  const facts: KnowledgeFact[] = [];
  for (const fact of input.state.facts) {
    if (fact.status === 'superseded') {
      facts.push(fact);
      continue;
    }
    const pending = (dirty.byFact.get(fact.factId) ?? []).length > 0;
    const next = pending ? ('propagation-pending' as const) : ('applied' as const);
    if (fact.propagation === next) {
      facts.push(fact);
      continue;
    }
    const updated = knowledgeFactSchema.parse({ ...fact, propagation: next });
    await writeKnowledgeFact(input.repoRoot, updated);
    facts.push(updated);
  }
  return { state: { ...input.state, facts }, dirty };
};

export type AppliedAnswer = { needId: string; factId: string; pageIds: string[] };

export type ApplyFlagAnswersInput = {
  repoRoot: string;
  store: ManifestStore;
  locales: string[];
  pageIds: string[];
  state: KnowledgeState;
  // The run's snapshot when one exists; the answer surfaces build it lazily and only when there is
  // actually an answered flag to commit.
  fingerprints?: FingerprintSnapshot | (() => Promise<FingerprintSnapshot>) | undefined;
};

export type ApplyFlagAnswersResult = {
  applied: number;
  state: KnowledgeState;
  answers: AppliedAnswer[];
};

const resolveFingerprints = async (
  source: ApplyFlagAnswersInput['fingerprints']
): Promise<FingerprintSnapshot | undefined> => (typeof source === 'function' ? await source() : source);

// A flag raised before the KnowledgeNeed store existed carries no needId. Answering it must still
// work — a user must never lose the ability to answer a question that is sitting in their queue —
// so the need is minted from what the flag does record.
const needFromLegacyFlag = (input: { flag: Flag; pageId: string }): KnowledgeNeed =>
  knowledgeNeedSchema.parse({
    schemaVersion: 1,
    needId: mintId(idPrefixes.knowledgeNeed),
    kind: 'intent-policy',
    subject:
      input.flag.subjectSymbol === undefined
        ? { kind: 'topic', topic: `page:${input.pageId}/q-${questionDiscriminator(input.flag.question ?? '')}` }
        : { kind: 'symbol', symbolHash: input.flag.subjectSymbol },
    missingFact: normalizeMissingFact({}),
    requestingPages: [input.pageId],
    question: input.flag.question ?? input.flag.summary,
    status: 'open',
    createdAt: input.flag.createdAt
  });

// The answering loop closes here: a human answers a tribal-knowledge flag (CLI, local UI, or the
// flag queue), and at the start of every run — and immediately from the answer surfaces — the
// answered flags become KnowledgeFacts and the flags resolve.
export const applyFlagAnswers = async (input: ApplyFlagAnswersInput): Promise<ApplyFlagAnswersResult> => {
  let state = input.state;
  let applied = 0;
  const answers: AppliedAnswer[] = [];
  let fingerprints: FingerprintSnapshot | undefined;
  let fingerprintsResolved = false;

  for (const locale of input.locales) {
    for (const pageId of input.pageIds) {
      const shard = await input.store.readPageShard({ locale, pageId });
      if (shard === undefined) {
        continue;
      }
      let changed = false;
      const flags: Flag[] = [];
      for (const flag of shard.flags) {
        const answerText = flag.answer?.text?.trim();
        if (flag.kind !== 'tribal-knowledge' || flag.status !== 'answered' || !answerText) {
          flags.push(flag);
          continue;
        }
        if (!fingerprintsResolved) {
          fingerprints = await resolveFingerprints(input.fingerprints);
          fingerprintsResolved = true;
        }
        let needId = flag.needId;
        if (needId === undefined || !state.needs.some((need) => need.needId === needId)) {
          const need = needFromLegacyFlag({ flag, pageId });
          await writeKnowledgeNeed(input.repoRoot, need);
          state = { ...state, needs: [...state.needs, need] };
          needId = need.needId;
        }
        const result = await answerKnowledgeNeed({
          repoRoot: input.repoRoot,
          state,
          needId,
          statement: answerText,
          origin: 'user',
          author: flag.answer?.author ?? 'unknown',
          ...(fingerprints === undefined ? {} : { fingerprints }),
          ...(flag.answer?.answeredAt === undefined ? {} : { at: flag.answer.answeredAt })
        });
        state = result.state;
        applied += 1;
        answers.push({ needId, factId: result.fact.factId, pageIds: [] });
        flags.push({ ...flag, status: 'resolved', needId });
        changed = true;
      }
      if (changed) {
        await input.store.writePageShard({ ...shard, flags });
      }
    }
  }

  if (applied === 0) {
    return { applied, state, answers };
  }
  // Every OTHER open flag for a need that just got answered resolves too: one need, one answer.
  await resolveFlagsForAnsweredNeeds({ ...input, state });
  const reconciled = await reconcileKnowledgePropagation({
    repoRoot: input.repoRoot,
    store: input.store,
    locales: input.locales,
    pageIds: input.pageIds,
    state
  });
  return {
    applied,
    state: reconciled.state,
    answers: answers.map((answer) => ({ ...answer, pageIds: reconciled.dirty.byFact.get(answer.factId) ?? [] }))
  };
};

// Flags are a projection of needs, so a need that is answered or merged must not keep an open flag
// anywhere — including on pages that asked the same question independently.
export const resolveFlagsForAnsweredNeeds = async (input: {
  store: ManifestStore;
  locales: string[];
  pageIds: string[];
  state: KnowledgeState;
}): Promise<void> => {
  const settled = new Set(
    input.state.needs
      .filter((need) => need.status === 'answered' || need.status === 'auto-answered' || need.status === 'merged')
      .map((need) => need.needId)
  );
  if (settled.size === 0) {
    return;
  }
  for (const locale of input.locales) {
    for (const pageId of input.pageIds) {
      const shard = await input.store.readPageShard({ locale, pageId });
      if (shard === undefined) {
        continue;
      }
      let changed = false;
      const flags = shard.flags.map((flag) => {
        if (
          flag.kind === 'tribal-knowledge' &&
          flag.status === 'open' &&
          flag.needId !== undefined &&
          settled.has(flag.needId)
        ) {
          changed = true;
          return { ...flag, status: 'resolved' as const };
        }
        return flag;
      });
      if (changed) {
        await input.store.writePageShard({ ...shard, flags });
      }
    }
  }
};
