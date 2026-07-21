import { z } from 'zod';
import {
  claimClassTokenSchema,
  claimCorrectnessSchema,
  claimDispositionSchema,
  claimTrustIssues,
  dependencySubscriptionSchema,
  evidenceRefSchema
} from './claim-ledger-schema.ts';
import {
  blockIdSchema,
  claimIdSchema,
  contentHashSchema,
  contextIdSchema,
  evidenceIdSchema,
  gitCommitSchema,
  isoTimestampSchema,
  localeCodeSchema,
  pageIdSchema,
  sectionIdSchema,
  severitySchema,
  taskIdSchema
} from './primitives.ts';
import { observedReadSchema } from './provenance-schema.ts';

// The four-way provenance split (trust-model-v2 provisional, Sol domain-02 problem 5): reader
// surfaces read ONLY ClaimEvidence; lineage and dependencies are machine/debug concerns;
// assessments are the separate editorial axis (trust-model-v2 decision 4).

// GenerationLineage: how this content came to be — models/prompts/transcripts, the context-pack
// inputs handed to the writer, and every file the harness observed being read. Debug surface
// ("Files consulted"), never presented as evidence, and consulting a file is NOT a dependency:
// observed reads do not invalidate the page.
export const generationLineageSchema = z.object({
  models: z
    .array(z.object({ role: z.string().min(1), model: z.string().min(1), transport: z.string().optional() }))
    .default([]),
  // Prompt templates by id + content-hash revision, so prompt changes are traceable.
  prompts: z.array(z.object({ id: z.string().min(1), revision: contentHashSchema })).default([]),
  // Task ids into the run journal where full transcripts live.
  transcripts: z.array(taskIdSchema).default([]),
  // Context-pack inputs handed to the writer (ctx_… ids into the run journal).
  seedContext: z.array(contextIdSchema).default([]),
  observedReads: z.array(observedReadSchema).default([])
});
export type GenerationLineage = z.infer<typeof generationLineageSchema>;

// A consumed intent/knowledge fragment. Recording id + hash is what makes answers and feedback
// causally invalidate exactly their dependent pages (dx-knowledge-v2 decision 8).
export const consumedFragmentKindSchema = z.enum([
  'knowledge-fact',
  'instruction',
  'criteria',
  'glossary',
  'config',
  'ia'
]);
export const consumedFragmentSchema = z.object({
  kind: consumedFragmentKindSchema,
  id: z.string().min(1),
  hash: contentHashSchema
});
export type ConsumedFragment = z.infer<typeof consumedFragmentSchema>;

// Dependencies hold ONLY explicit subscriptions — the exact facts whose change invalidates this
// unit: symbol-facet / whole-file subscriptions plus consumed fragment ids+hashes. Observed reads
// live in lineage (ARCHITECTURE §4.2).
export const dependenciesSchema = z.object({
  subscriptions: z.array(dependencySubscriptionSchema).default([]),
  consumed: z.array(consumedFragmentSchema).default([])
});
export type Dependencies = z.infer<typeof dependenciesSchema>;

// One canonical evidence record: stable id, payload, and the common check metadata every reader
// surface needs (quality-ci-reader-v2 decision 24). The ledger references these by id only.
export const evidenceRecordSchema = z.object({
  evidenceId: evidenceIdSchema,
  ref: evidenceRefSchema,
  checkedAt: isoTimestampSchema,
  // The repository commit the check ran against.
  sourceRevision: gitCommitSchema.optional(),
  // Human-readable check outcome detail ("docs assert 3, source says 5").
  detail: z.string().optional()
});
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

// The canonical, versioned per-claim trust projection — the ONLY provenance part reader surfaces
// consume: class, correctness, disposition, evidence records, and the deciding evidence id. The
// same authority table as the kernel ledger applies; the two can never diverge.
export const claimEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    claimId: claimIdSchema,
    class: claimClassTokenSchema,
    correctness: claimCorrectnessSchema,
    disposition: claimDispositionSchema,
    evidence: z.array(evidenceRecordSchema).default([]),
    decidingEvidenceId: evidenceIdSchema.optional()
  })
  .superRefine((record, ctx) => {
    const deciding =
      record.decidingEvidenceId === undefined
        ? undefined
        : record.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    if (record.decidingEvidenceId !== undefined && deciding === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['decidingEvidenceId'],
        message: 'decidingEvidenceId must reference one of the evidence records'
      });
      return;
    }
    const decidingRef = deciding?.ref;
    for (const message of claimTrustIssues({
      class: record.class,
      correctness: record.correctness,
      disposition: record.disposition,
      decidingKind: decidingRef?.kind,
      decidingPromoted: decidingRef?.kind === 'project-defined' ? decidingRef.promoted : undefined
    })) {
      ctx.addIssue({ code: 'custom', path: ['correctness'], message });
    }
  });
export type ClaimEvidence = z.infer<typeof claimEvidenceSchema>;

export const criterionOutcomeSchema = z.enum(['met', 'not-met', 'not-applicable']);

// Completion is explicit so "publish with label withheld" is representable: a pending review is a
// recorded fact, not a missing record (harness-state-v2 decision 3).
export const reviewCompletionSchema = z.enum(['completed', 'pending', 'failed']);

// Only the primary persona's review gates the page; secondary personas run advisory on a sampled
// subset (trust-model-v2 decision 4). Criteria outcomes are recorded per entity.
export const personaReviewRoleSchema = z.enum(['primary-gating', 'secondary-advisory']);

export const personaReviewSchema = z.object({
  persona: z.string().min(1),
  role: personaReviewRoleSchema,
  // The entity the review targeted.
  entityId: z.union([pageIdSchema, sectionIdSchema, blockIdSchema]),
  // Model id that scored the review.
  scoredBy: z.string().min(1),
  completion: reviewCompletionSchema,
  criteria: z
    .array(z.object({ id: z.string().min(1), version: z.string().optional(), outcome: criterionOutcomeSchema }))
    .default([]),
  at: isoTimestampSchema.optional()
});
export type PersonaReview = z.infer<typeof personaReviewSchema>;

// One evidence-fed risk critic per page (harness-state-v2 decision 4): hunts misleading framing,
// dangerous omissions, wrong emphasis — what the ledger structurally cannot catch.
export const riskCriticResultSchema = z.object({
  scoredBy: z.string().min(1),
  completion: reviewCompletionSchema,
  issues: z.array(z.object({ message: z.string().min(1), severity: severitySchema })).default([])
});
export type RiskCriticResult = z.infer<typeof riskCriticResultSchema>;

// One correction cycle is representable — exactly one (i18n-lifecycle-v2 decision 2): the failed
// candidate + findings are fed back once, then the route falls back.
export const fidelityAttemptSchema = z.strictObject({
  scoredBy: z.string().min(1),
  at: isoTimestampSchema,
  outcome: z.enum(['passed', 'failed']),
  findings: z.array(z.string().min(1)).default([])
});
export type FidelityAttempt = z.infer<typeof fidelityAttemptSchema>;

// Translation fidelity is a discriminated lifecycle keyed by page + locale + the EXACT canonical
// source content revision the review judged (content-derived — never a git commit). Strict arms:
// a pending record carrying an outcome, or a failure without findings, must not parse.
export const translationFidelitySchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('pending'),
    pageId: pageIdSchema,
    locale: localeCodeSchema,
    sourceContentRevision: contentHashSchema
  }),
  z.strictObject({
    state: z.literal('passed'),
    pageId: pageIdSchema,
    locale: localeCodeSchema,
    sourceContentRevision: contentHashSchema,
    scoredBy: z.string().min(1),
    at: isoTimestampSchema.optional(),
    // The correction cycle that led to the pass, when the first review failed.
    correction: fidelityAttemptSchema.optional()
  }),
  z.strictObject({
    state: z.literal('failed'),
    pageId: pageIdSchema,
    locale: localeCodeSchema,
    sourceContentRevision: contentHashSchema,
    scoredBy: z.string().min(1),
    at: isoTimestampSchema.optional(),
    findings: z.array(z.string().min(1)).min(1),
    correction: fidelityAttemptSchema.optional()
  })
]);
export type TranslationFidelity = z.infer<typeof translationFidelitySchema>;

// AI adjudication of a structural-finding candidate for this page (quality-ci-reader-v2 §19-20).
export const structuralAssessmentSchema = z.object({
  findingKey: z.string().min(1),
  scoredBy: z.string().min(1),
  outcome: z.enum(['expected', 'not-applicable', 'uncertain'])
});
export type StructuralAssessment = z.infer<typeof structuralAssessmentSchema>;

export const assessmentsSchema = z.object({
  reviews: z.array(personaReviewSchema).default([]),
  riskCritic: riskCriticResultSchema.optional(),
  translationFidelity: z.array(translationFidelitySchema).default([]),
  structural: z.array(structuralAssessmentSchema).default([])
});
export type Assessments = z.infer<typeof assessmentsSchema>;

export const provenanceV2Schema = z.object({
  schemaVersion: z.literal(1),
  lineage: generationLineageSchema.prefault({}),
  dependencies: dependenciesSchema.prefault({}),
  claimEvidence: z.array(claimEvidenceSchema).default([]),
  assessments: assessmentsSchema.prefault({})
});
export type ProvenanceV2 = z.infer<typeof provenanceV2Schema>;
