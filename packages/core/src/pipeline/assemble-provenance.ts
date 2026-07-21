import type {
  AgentTaskSpec,
  ClaimEvidence,
  ClaimLedger,
  DocstubeConfig,
  Glossary,
  IaPageNodeV2,
  PageEntity,
  ProvenanceV2,
  Transcript
} from '@docstube/contracts';
import { canonicalJson, contentHash, hashValue, provenanceV2Schema } from '@docstube/contracts';
import { CoreError } from '../errors.ts';
import type { KnowledgeEntry } from './tribal-knowledge.ts';
import type { ScoredReview } from './review-page.ts';

// Provenance v2 assembly (wave 2b-ii, in-memory — persistence is 2b-iii): the four-way split of
// trust-model-v2 / Sol domain-02 problem 5, built from what the page run already knows and
// validated through provenanceV2Schema.parse. Reader surfaces read ONLY claimEvidence; lineage is
// the debug surface ("Files consulted"), dependencies drive the reconciler, assessments are the
// separate editorial axis.

export type AssembleProvenanceInput = {
  pageId: string;
  // The extracted page the ledger anchors into — the commit validator proves ledger↔page linkage
  // (page id, anchor blocks, scope entities) before anything persists (impl-07 finding 5).
  page: PageEntity;
  // The page's ia.yml v2 record: names the PRIMARY persona (only its review gates) and is itself
  // a consumed dependency — title/brief/depth/persona enter the writer prompt, so an ia.yml edit
  // must causally invalidate exactly this page (impl-06 finding 6).
  node: IaPageNodeV2;
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
  // Kernel commit validator (impl-06 finding 5, tightened impl-07): the ledger and its
  // ClaimEvidence records are one artifact in two projections — assembly REFUSES a partial or
  // disagreeing pair instead of parsing it into committed state. The shard schema re-proves this
  // at every parse; failing here names the bug at its source.
  // Ledger↔page linkage first: a foreign ledger must never assemble under this page.
  if (input.page.id !== input.pageId || input.ledger.pageId !== input.pageId) {
    throw new CoreError(
      'pipeline-failed',
      `provenance assembly: ledger.pageId "${input.ledger.pageId}" / page.id "${input.page.id}" disagree with the target page "${input.pageId}"`
    );
  }
  const blockIds = new Set(
    [...input.page.preamble, ...input.page.sections.flatMap((section) => section.blocks)].map((block) => block.id)
  );
  const scopeIds = new Set([input.page.id, ...input.page.sections.map((section) => section.id), ...blockIds]);
  const evidenceByClaimId = new Map(input.claimEvidence.map((record) => [record.claimId, record]));
  for (const claim of input.ledger.claims) {
    if (!blockIds.has(claim.anchor.blockId)) {
      throw new CoreError(
        'pipeline-failed',
        `provenance assembly: claim "${claim.claimId}" anchors to block "${claim.anchor.blockId}", which does not exist on page "${input.pageId}"`
      );
    }
    if (!scopeIds.has(claim.scope.entityId)) {
      throw new CoreError(
        'pipeline-failed',
        `provenance assembly: claim "${claim.claimId}" is scoped to entity "${claim.scope.entityId}", which does not exist on page "${input.pageId}"`
      );
    }
    const record = evidenceByClaimId.get(claim.claimId);
    if (record === undefined) {
      throw new CoreError(
        'pipeline-failed',
        `provenance assembly: ledger claim "${claim.claimId}" has no ClaimEvidence record — the ledger↔evidence bijection is broken`
      );
    }
    evidenceByClaimId.delete(claim.claimId);
    if (
      record.class !== claim.class ||
      record.correctness !== claim.correctness ||
      record.disposition !== claim.disposition ||
      record.decidingEvidenceId !== claim.decidingEvidenceId
    ) {
      throw new CoreError(
        'pipeline-failed',
        `provenance assembly: ledger claim "${claim.claimId}" disagrees with its ClaimEvidence record on class/correctness/disposition/decidingEvidenceId`
      );
    }
    // EXACT evidence-id set equality (impl-07 finding 5): the ledger handles and the canonical
    // records must be the same set — a canonical record the ledger never references is
    // unaccounted trust surface; a handle without a record is a dangling reference.
    const claimEvidenceIds = new Set(claim.evidence);
    const recordEvidenceIds = new Set(record.evidence.map((entry) => entry.evidenceId));
    const missing = claim.evidence.filter((id) => !recordEvidenceIds.has(id));
    const extra = [...recordEvidenceIds].filter((id) => !claimEvidenceIds.has(id));
    if (missing.length > 0 || extra.length > 0) {
      throw new CoreError(
        'pipeline-failed',
        `provenance assembly: ledger claim "${claim.claimId}" and its ClaimEvidence record carry different evidence sets` +
          `${missing.length > 0 ? ` (dangling handles: ${missing.join(', ')})` : ''}` +
          `${extra.length > 0 ? ` (unreferenced canonical evidence: ${extra.join(', ')})` : ''}`
      );
    }
    // Every evidence record must vouch for the revision this ledger was computed against.
    for (const entry of record.evidence) {
      if (entry.sourceRevision !== input.ledger.sourceRevision) {
        throw new CoreError(
          'pipeline-failed',
          `provenance assembly: evidence "${entry.evidenceId}" on claim "${claim.claimId}" was checked at revision "${entry.sourceRevision}", not the ledger's "${input.ledger.sourceRevision}"`
        );
      }
    }
  }
  const stray = [...evidenceByClaimId.keys()];
  if (stray.length > 0) {
    throw new CoreError(
      'pipeline-failed',
      `provenance assembly: ClaimEvidence record(s) ${stray.join(', ')} have no ledger claim — the ledger↔evidence bijection is broken`
    );
  }
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
    { kind: 'config', id: 'docstube.yml', hash: hashValue(input.config) },
    // The page-specific IA fragment: exactly the fields that entered the writer prompt and the
    // review routing. Content-hashed so editing THIS page's brief/persona/depth/title invalidates
    // this page and no other.
    {
      kind: 'ia',
      id: `ia:${input.node.slug}`,
      hash: hashValue({
        title: input.node.title,
        brief: input.node.brief,
        depth: input.node.depth,
        primaryPersona: input.node.primaryPersona
      })
    }
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
      // Role is derived from the page's IA record: ONLY the primary persona's review is
      // 'primary-gating'. (The runner currently runs only that persona; any other recorded review
      // — e.g. from a future sampled advisory pass — must never masquerade as gating.)
      reviews: input.reviews.map((review) => ({
        persona: review.persona,
        role: review.persona === input.node.primaryPersona ? 'primary-gating' : 'secondary-advisory',
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
