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
  observedReads: z.array(observedReadSchema).default([]),
  // Honest revision labeling (impl-07 finding 7): fingerprinting and verification read the
  // WORKING TREE. sourceRevision fields still record HEAD (the schema requires a git commit),
  // but when the tree was dirty at run start — or the repo had no HEAD at all — this marker
  // records that HEAD may never have contained the checked bytes. Absent for a clean tree.
  // Full immutable-snapshot reads (evidence bound to the exact tree object) land with the
  // reconciler wave.
  dirtyWorkingTree: z.boolean().optional()
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
// surface needs (quality-ci-reader-v2 decision 24). The ledger references these by id only —
// kind, payload, promotion, outcome, and revision live HERE and nowhere else.
export const evidenceRecordSchema = z
  .object({
    evidenceId: evidenceIdSchema,
    ref: evidenceRefSchema,
    checkedAt: isoTimestampSchema,
    // The repository commit the check ran against — required: evidence without a revision is not
    // reproducible and cannot be re-validated.
    sourceRevision: gitCommitSchema,
    // Structured check outcome: 'pass' backs checked, 'fail' backs contradicted.
    outcome: z.enum(['pass', 'fail']),
    // Human-readable check outcome detail ("docs assert 3, source says 5").
    detail: z.string().optional()
  })
  .superRefine((record, ctx) => {
    // A value predicate IS its comparison — the recorded outcome must agree with it, so an
    // equal-values predicate can never carry 'fail' (and thus never decide a contradiction).
    if (record.ref.kind === 'value-predicate') {
      const expected = record.ref.assertedValue === record.ref.extractedValue ? 'pass' : 'fail';
      if (record.outcome !== expected) {
        ctx.addIssue({
          code: 'custom',
          path: ['outcome'],
          message: `a value-predicate with ${expected === 'pass' ? 'matching' : 'differing'} values must record outcome '${expected}'`
        });
      }
    }
  });
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

// The canonical, versioned per-claim trust projection — the ONLY provenance part reader surfaces
// consume: class, correctness, disposition, evidence records, and the deciding evidence id. This
// is where FULL class/evidence authority is enforced (the ledger claim holds bare evidence ids and
// checks only local invariants); ledger-handle ids ⊆ these records is a kernel commit invariant.
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
    // Evidence ids are canonical: a repeated id inside one claim's records could carry divergent
    // payloads/outcomes under a single identity, so the duplicate rejects outright.
    const seenEvidenceIds = new Set<string>();
    for (const entry of record.evidence) {
      if (seenEvidenceIds.has(entry.evidenceId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: `duplicate evidenceId "${entry.evidenceId}" — a canonical evidence record appears exactly once`
        });
      }
      seenEvidenceIds.add(entry.evidenceId);
    }
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
      decidingPromoted: decidingRef?.kind === 'project-defined' ? decidingRef.promoted : undefined,
      decidingOutcome: deciding?.outcome
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
// a pending record carrying an outcome, or a failure without findings, must not parse. The
// correction cycle, when present, is what PRODUCED the terminal state — so its outcome must agree
// with it: passed-with-failed-correction and failed-with-passed-correction are impossible.
const translationFidelityUnionSchema = z.discriminatedUnion('state', [
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

export const translationFidelitySchema = translationFidelityUnionSchema.superRefine((record, ctx) => {
  if (record.state === 'pending' || record.correction === undefined) {
    return;
  }
  const expected = record.state === 'passed' ? 'passed' : 'failed';
  if (record.correction.outcome !== expected) {
    ctx.addIssue({
      code: 'custom',
      path: ['correction', 'outcome'],
      message: `a ${record.state} fidelity record requires a correction outcome of '${expected}'`
    });
  }
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

export const provenanceV2Schema = z
  .object({
    schemaVersion: z.literal(1),
    lineage: generationLineageSchema.prefault({}),
    dependencies: dependenciesSchema.prefault({}),
    claimEvidence: z.array(claimEvidenceSchema).default([]),
    assessments: assessmentsSchema.prefault({})
  })
  .superRefine((provenance, ctx) => {
    // Canonical identity within the collection: at most ONE ClaimEvidence record per claim id
    // (two records for one claim could disagree on correctness), and evidence record ids are
    // globally unique across the collection — shared physical evidence gets distinct minted ids,
    // never one id with potentially divergent payloads under two claims.
    const seenClaimIds = new Set<string>();
    const seenEvidenceIds = new Set<string>();
    for (const record of provenance.claimEvidence) {
      if (seenClaimIds.has(record.claimId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['claimEvidence'],
          message: `duplicate claimId "${record.claimId}" — one ClaimEvidence record per claim`
        });
      }
      seenClaimIds.add(record.claimId);
      for (const entry of record.evidence) {
        if (seenEvidenceIds.has(entry.evidenceId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['claimEvidence'],
            message: `duplicate evidenceId "${entry.evidenceId}" — evidence record ids are unique across the collection`
          });
        }
        seenEvidenceIds.add(entry.evidenceId);
      }
    }
  });
export type ProvenanceV2 = z.infer<typeof provenanceV2Schema>;
