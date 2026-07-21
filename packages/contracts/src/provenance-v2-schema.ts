import { z } from 'zod';
import { evidenceRefSchema } from './claim-ledger-schema.ts';
import {
  claimIdSchema,
  isoTimestampSchema,
  localeCodeSchema,
  severitySchema,
  sha256HexSchema,
  taskIdSchema
} from './primitives.ts';
import { observedReadSchema } from './provenance-schema.ts';

// The four-way provenance split (trust-model-v2 provisional, Sol domain-02 problem 5): reader
// surfaces read ONLY ClaimEvidence; lineage and dependencies are machine/debug concerns;
// assessments are the separate editorial axis (trust-model-v2 decision 4).

// GenerationLineage: which models/prompts/transcripts produced the content. Debug surface, never
// presented as evidence.
export const generationLineageSchema = z.object({
  models: z
    .array(z.object({ role: z.string().min(1), model: z.string().min(1), transport: z.string().optional() }))
    .default([]),
  // Prompt templates by id + content-hash revision, so prompt changes are traceable.
  prompts: z.array(z.object({ id: z.string().min(1), revision: sha256HexSchema })).default([]),
  // Task ids into the run journal where full transcripts live.
  transcripts: z.array(taskIdSchema).default([])
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
  hash: sha256HexSchema
});
export type ConsumedFragment = z.infer<typeof consumedFragmentSchema>;

export const dependenciesSchema = z.object({
  observedReads: z.array(observedReadSchema).default([]),
  consumed: z.array(consumedFragmentSchema).default([])
});
export type Dependencies = z.infer<typeof dependenciesSchema>;

// Per-claim evidence projection referencing the claim ledger — the ONLY provenance part reader
// surfaces consume.
export const claimEvidenceSchema = z.object({
  claimId: claimIdSchema,
  evidence: z.array(evidenceRefSchema).default([])
});
export type ClaimEvidence = z.infer<typeof claimEvidenceSchema>;

export const criterionOutcomeSchema = z.enum(['met', 'not-met', 'not-applicable']);

// Completion is explicit so "publish with label withheld" is representable: a pending review is a
// recorded fact, not a missing record (harness-state-v2 decision 3).
export const reviewCompletionSchema = z.enum(['completed', 'pending', 'failed']);

export const personaReviewSchema = z.object({
  persona: z.string().min(1),
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

export const translationFidelitySchema = z.object({
  locale: localeCodeSchema,
  scoredBy: z.string().min(1),
  completion: reviewCompletionSchema,
  // Absent while pending; one correction cycle on failure, then fallback (i18n-lifecycle-v2).
  outcome: z.enum(['passed', 'failed']).optional()
});
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
  lineage: generationLineageSchema.prefault({}),
  dependencies: dependenciesSchema.prefault({}),
  claimEvidence: z.array(claimEvidenceSchema).default([]),
  assessments: assessmentsSchema.prefault({})
});
export type ProvenanceV2 = z.infer<typeof provenanceV2Schema>;
