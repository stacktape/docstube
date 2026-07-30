import type { Codemap, Flag, KnowledgeNeed } from '@docstube/contracts';
import { idPrefixes, knowledgeNeedSchema, mintId } from '@docstube/contracts';
import { activeFactForNeed, knowledgeContextFacts, writeKnowledgeNeed } from './knowledge-store.ts';
import type { KnowledgeContextFact, KnowledgeState } from './knowledge-store.ts';
import { buildKnowledgeSubject, normalizeMissingFact, resolveSlot } from './knowledge-slots.ts';

// The run-scoped view of the knowledge store: the facts every writer prompt is given, and the
// capture path that turns writer questions into KnowledgeNeeds. One session serves the whole run,
// so a question asked by page 3 dedups against a need page 1 raised minutes earlier without
// re-reading the store.

export type CapturedQuestion = {
  question: string;
  subject?: string | undefined;
  context?: string | undefined;
  // The missing-fact SLOT — the durable half of the dedup key. Optional because a model that says
  // nothing still gets a usable slot ('unspecified'), disambiguated per distinct gap.
  factKind?: string | undefined;
  factField?: string | undefined;
};

export type CaptureInput = {
  questions: readonly CapturedQuestion[];
  codemap: Codemap;
  pageId: string;
  locale: string;
  version: string;
  runId: string;
};

export type KnowledgeSession = {
  contextFacts: () => KnowledgeContextFact[];
  needs: () => KnowledgeNeed[];
  state: () => KnowledgeState;
  // Returns the flags this page should carry — one per need that is genuinely open and not already
  // queued somewhere else. Needs themselves are persisted as they are created or absorbed.
  capture: (input: CaptureInput) => Promise<Flag[]>;
};

export const createKnowledgeSession = (input: {
  repoRoot: string;
  state: KnowledgeState;
  // Needs that already have an open flag on some shard — ask-once spans pages, not just this one.
  flaggedNeedIds: ReadonlySet<string>;
}): KnowledgeSession => {
  let state = input.state;
  const flagged = new Set(input.flaggedNeedIds);

  const capture = async (capturing: CaptureInput): Promise<Flag[]> => {
    const flags: Flag[] = [];
    for (const captured of capturing.questions) {
      const question = captured.question.trim();
      if (question === '') {
        continue;
      }
      const subject = buildKnowledgeSubject({
        codemap: capturing.codemap,
        pageId: capturing.pageId,
        subject: captured.subject,
        question
      });
      const missingFact = normalizeMissingFact({ kind: captured.factKind, field: captured.factField });
      const resolution = resolveSlot({ needs: state.needs, subject, missingFact, question });
      let need: KnowledgeNeed;
      if (resolution.action === 'absorb') {
        const existing = state.needs.find((candidate) => candidate.needId === resolution.needId);
        if (existing === undefined) {
          continue;
        }
        if (existing.requestingPages.includes(capturing.pageId)) {
          need = existing;
        } else {
          need = knowledgeNeedSchema.parse({
            ...existing,
            requestingPages: [...existing.requestingPages, capturing.pageId]
          });
          await writeKnowledgeNeed(input.repoRoot, need);
          state = {
            ...state,
            needs: state.needs.map((candidate) => (candidate.needId === need.needId ? need : candidate))
          };
        }
      } else {
        need = knowledgeNeedSchema.parse({
          schemaVersion: 1,
          // Human-only by default: docstube never invents project intent, and the researcher agent
          // (dx-knowledge-v2 decision 7) is the component that classifies needs as
          // external-world/derivable. Until it lands, every captured need is escalated to a human.
          kind: 'intent-policy',
          needId: mintId(idPrefixes.knowledgeNeed),
          subject,
          missingFact: resolution.missingFact,
          requestingPages: [capturing.pageId],
          question,
          status: 'open',
          createdAt: new Date().toISOString()
        });
        await writeKnowledgeNeed(input.repoRoot, need);
        state = { ...state, needs: [...state.needs, need] };
      }

      // Already answered ⇒ the answer is in the writer prompt; asking again is the model's habit,
      // not a gap. Already queued ⇒ ask once, across every page.
      if (activeFactForNeed(state.facts, need.needId) !== undefined || flagged.has(need.needId)) {
        continue;
      }
      flagged.add(need.needId);
      const summary = `writer question: ${need.question.slice(0, 120)}${need.question.length > 120 ? '…' : ''}`;
      const subjectSymbol = need.subject.kind === 'topic' ? undefined : need.subject.symbolHash;
      flags.push({
        id: mintId(idPrefixes.flag),
        kind: 'tribal-knowledge',
        status: 'open',
        summary,
        ...(captured.context === undefined ? {} : { detail: captured.context }),
        question: need.question,
        needId: need.needId,
        ...(subjectSymbol === undefined ? {} : { subjectSymbol }),
        entity: { version: capturing.version, locale: capturing.locale, pageId: capturing.pageId },
        runId: capturing.runId,
        createdAt: new Date().toISOString()
      });
    }
    return flags;
  };

  return {
    contextFacts: () => knowledgeContextFacts(state),
    needs: () => state.needs,
    state: () => state,
    capture
  };
};
