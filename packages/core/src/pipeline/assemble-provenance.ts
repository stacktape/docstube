import type {
  AgentTaskSpec,
  ClaimEvidence,
  ClaimLedger,
  DocstubeConfig,
  Glossary,
  ProvenanceV2,
  Transcript
} from '@docstube/contracts';
import { canonicalJson, contentHash, hashValue, provenanceV2Schema } from '@docstube/contracts';
import type { KnowledgeEntry } from './tribal-knowledge.ts';
import type { ScoredReview } from './review-page.ts';

// Provenance v2 assembly (wave 2b-ii, in-memory — persistence is 2b-iii): the four-way split of
// trust-model-v2 / Sol domain-02 problem 5, built from what the page run already knows and
// validated through provenanceV2Schema.parse. Reader surfaces read ONLY claimEvidence; lineage is
// the debug surface ("Files consulted"), dependencies drive the reconciler, assessments are the
// separate editorial axis.

export type AssembleProvenanceInput = {
  pageId: string;
  ledger: ClaimLedger;
  claimEvidence: ClaimEvidence[];
  // The accepted write attempt: model/transport/task id/observed reads.
  transcript: Transcript;
  // The write task the accepted attempt ran — its prompts are the revision refs.
  writeTask: AgentTaskSpec;
  reviews: ScoredReview[];
  // Context the writer consumed (instructions/criteria from .docstube/, glossary, config).
  instructions: string[];
  criteria: string[];
  glossary: Glossary;
  config: DocstubeConfig;
  knowledge: KnowledgeEntry[];
};

// Stable per-fragment ids for id-less context files: the content hash prefix names the fragment
// so answers/instructions invalidate exactly their dependents (dx-knowledge-v2 decision 8).
const fragmentOf = (kind: 'instruction' | 'criteria', text: string) => {
  const hash = contentHash(text);
  return { kind, id: `${kind}-${hash.slice(0, 12)}`, hash };
};

export const assembleProvenanceV2 = (input: AssembleProvenanceInput): ProvenanceV2 => {
  // Explicit subscriptions only — the union of every ledger claim's typed subscriptions, deduped
  // by canonical shape (two claims sharing a dependency is one invalidation edge).
  const seenSubscriptions = new Set<string>();
  const subscriptions = input.ledger.claims
    .flatMap((claim) => claim.subscriptions)
    .filter((subscription) => {
      const key = canonicalJson(subscription);
      if (seenSubscriptions.has(key)) {
        return false;
      }
      seenSubscriptions.add(key);
      return true;
    });

  const consumed = [
    ...input.instructions.map((text) => fragmentOf('instruction', text)),
    ...input.criteria.map((text) => fragmentOf('criteria', text)),
    ...input.knowledge.map((entry) => ({
      kind: 'knowledge-fact',
      id: entry.key,
      hash: hashValue({ question: entry.question, answer: entry.answer })
    })),
    ...(input.glossary.terms.length > 0 ? [{ kind: 'glossary', id: 'glossary', hash: hashValue(input.glossary) }] : []),
    { kind: 'config', id: 'docstube.yml', hash: hashValue(input.config) }
  ];

  return provenanceV2Schema.parse({
    schemaVersion: 1,
    lineage: {
      models: [
        { role: 'writer', model: input.transcript.model, transport: input.transcript.transport },
        ...input.reviews.map((review) => ({ role: `reviewer:${review.persona}`, model: review.scoredBy }))
      ],
      // Prompt templates by id + content-hash revision, so prompt changes are traceable.
      prompts: [
        { id: 'write-page:system', revision: contentHash(input.writeTask.systemPrompt) },
        { id: 'write-page:user', revision: contentHash(input.writeTask.userPrompt) }
      ],
      transcripts: [input.transcript.taskId, ...input.reviews.map((review) => review.taskId)],
      // Journal-registered ctx_ context packs are a later wave; the page's current seed-context
      // strings are not ctx_ ids, so lineage starts without them rather than faking handles.
      seedContext: [],
      observedReads: input.transcript.observedReads
    },
    dependencies: { subscriptions, consumed },
    claimEvidence: input.claimEvidence,
    assessments: {
      // Every configured persona review gates the page today, so each maps to 'primary-gating';
      // 'secondary-advisory' arrives when ia.yml v2 primary personas thread into the runner.
      reviews: input.reviews.map((review) => ({
        persona: review.persona,
        role: 'primary-gating',
        entityId: input.pageId,
        scoredBy: review.scoredBy,
        completion: review.completed ? 'completed' : 'failed',
        criteria: review.criteria.map((criterion) => ({ id: criterion.criterion, outcome: criterion.outcome }))
      }))
      // riskCritic is a later wave (harness-state-v2 decision 4); translationFidelity and
      // structural assessments attach on their own pipelines.
    }
  });
};
