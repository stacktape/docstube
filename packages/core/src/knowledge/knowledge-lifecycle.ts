import type { FingerprintSnapshot, Flag } from '@docstube/contracts';
import { idPrefixes, mintId } from '@docstube/contracts';
import type { ManifestStore } from '../state/manifest-store.ts';
import { applyFlagAnswers, reconcileKnowledgePropagation, resolveFlagsForAnsweredNeeds } from './knowledge-answers.ts';
import { revalidateKnowledge } from './knowledge-revalidation.ts';
import type { KnowledgeStaleFact } from './knowledge-revalidation.ts';
import { createKnowledgeSession } from './knowledge-session.ts';
import type { KnowledgeSession } from './knowledge-session.ts';
import { loadKnowledgeState, writeKnowledgeFact, writeKnowledgeNeed } from './knowledge-store.ts';
import type { KnowledgeState } from './knowledge-store.ts';

// One entry point for every pipeline command (generate / maintain / refine): commit answered flags,
// rebind or stale facts against the run's fingerprint snapshot, reconcile propagation, and hand
// back the session the page runner writes and reads knowledge through.
//
// Order matters. Answers are committed FIRST (a maintainer's answer must reach this run), then
// staleness is evaluated against the current snapshot (so an answer given seconds ago is judged at
// the same revision the run reads), then propagation is derived from the pages on disk.

export type KnowledgeRunContext = {
  session: KnowledgeSession;
  // Pages whose committed generation consumed knowledge that has since changed — maintain adds
  // these to its affected set. generate rebuilds every page anyway.
  dirtyPageIds: Set<string>;
  warnings: string[];
};

const stalenessFlag = (input: {
  stale: KnowledgeStaleFact;
  runId: string;
  pageId: string;
  shard: { locale: string; version: string };
}): Flag => ({
  id: mintId(idPrefixes.flag),
  kind: 'tribal-knowledge',
  status: 'open',
  summary: `re-check answer: ${input.stale.question.slice(0, 110)}${input.stale.question.length > 110 ? '…' : ''}`,
  detail: `the maintainer answer this page cites needs revalidation — ${input.stale.reason}. Answering again supersedes it; the previous answer is kept with its author and date.`,
  question: input.stale.question,
  needId: input.stale.needId,
  entity: { version: input.shard.version, locale: input.shard.locale, pageId: input.pageId },
  runId: input.runId,
  createdAt: new Date().toISOString()
});

// A fact that just went stale flags exactly the pages CITING it (plus the pages that asked), so the
// re-ask lands where the wrong sentence is — one flag per page, one need behind all of them.
const flagStaleFacts = async (input: {
  store: ManifestStore;
  locales: string[];
  pageIds: string[];
  state: KnowledgeState;
  stale: KnowledgeStaleFact[];
  runId: string;
}): Promise<void> => {
  if (input.stale.length === 0) {
    return;
  }
  const needById = new Map(input.state.needs.map((need) => [need.needId, need]));
  const staleByFactId = new Map(input.stale.map((entry) => [entry.factId, entry]));
  for (const locale of input.locales) {
    for (const pageId of input.pageIds) {
      const shard = await input.store.readPageShard({ locale, pageId });
      if (shard === undefined) {
        continue;
      }
      const cited = new Set(
        (shard.provenance?.dependencies.consumed ?? [])
          .filter((fragment) => fragment.kind === 'knowledge-fact')
          .map((fragment) => fragment.id)
      );
      const openNeedIds = new Set(
        shard.flags.filter((flag) => flag.status === 'open' && flag.needId !== undefined).map((flag) => flag.needId!)
      );
      const raised: Flag[] = [];
      for (const stale of staleByFactId.values()) {
        const asked = needById.get(stale.needId)?.requestingPages.includes(pageId) ?? false;
        if ((!cited.has(stale.factId) && !asked) || openNeedIds.has(stale.needId)) {
          continue;
        }
        openNeedIds.add(stale.needId);
        raised.push(stalenessFlag({ stale, runId: input.runId, pageId, shard }));
      }
      if (raised.length > 0) {
        await input.store.writePageShard({ ...shard, flags: [...shard.flags, ...raised] });
      }
    }
  }
};

export const openKnowledgeForRun = async (input: {
  repoRoot: string;
  store: ManifestStore;
  locales: string[];
  pageIds: string[];
  fingerprints: FingerprintSnapshot;
  runId: string;
}): Promise<KnowledgeRunContext> => {
  // Fail-closed: unreadable committed knowledge aborts the run rather than regenerating pages as if
  // the maintainer had never answered anything.
  const loaded = await loadKnowledgeState(input.repoRoot);
  const warnings = [...loaded.warnings];

  const answered = await applyFlagAnswers({
    repoRoot: input.repoRoot,
    store: input.store,
    locales: input.locales,
    pageIds: input.pageIds,
    state: loaded,
    fingerprints: input.fingerprints
  });

  const revalidation = revalidateKnowledge({ state: answered.state, fingerprints: input.fingerprints });
  for (const need of revalidation.state.needs) {
    if (!answered.state.needs.includes(need)) {
      await writeKnowledgeNeed(input.repoRoot, need);
    }
  }
  for (const fact of revalidation.state.facts) {
    if (!answered.state.facts.includes(fact)) {
      await writeKnowledgeFact(input.repoRoot, fact);
    }
  }
  await flagStaleFacts({
    store: input.store,
    locales: input.locales,
    pageIds: input.pageIds,
    state: revalidation.state,
    stale: revalidation.stale,
    runId: input.runId
  });
  for (const stale of revalidation.stale) {
    warnings.push(`knowledge answer for "${stale.question.slice(0, 80)}" needs revalidation — ${stale.reason}`);
  }
  // A rebind is deliberately silent for the user (it is the "no re-ask after a refactor"
  // guarantee), so it stays out of warnings.

  // An answered need must never keep an open flag, including one raised on another page.
  await resolveFlagsForAnsweredNeeds({
    store: input.store,
    locales: input.locales,
    pageIds: input.pageIds,
    state: revalidation.state
  });

  const reconciled = await reconcileKnowledgePropagation({
    repoRoot: input.repoRoot,
    store: input.store,
    locales: input.locales,
    pageIds: input.pageIds,
    state: revalidation.state
  });

  const flaggedNeedIds = new Set<string>();
  for (const locale of input.locales) {
    for (const pageId of input.pageIds) {
      const shard = await input.store.readPageShard({ locale, pageId });
      for (const flag of shard?.flags ?? []) {
        if (flag.kind === 'tribal-knowledge' && flag.status === 'open' && flag.needId !== undefined) {
          flaggedNeedIds.add(flag.needId);
        }
      }
    }
  }

  return {
    session: createKnowledgeSession({ repoRoot: input.repoRoot, state: reconciled.state, flaggedNeedIds }),
    dirtyPageIds: reconciled.dirty.pageIds,
    warnings
  };
};
