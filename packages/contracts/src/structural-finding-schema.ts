import { z } from 'zod';
import {
  blockIdSchema,
  contentHashSchema,
  isoTimestampSchema,
  pageIdSchema,
  sectionIdSchema,
  symbolSourceKeySchema
} from './primitives.ts';

// Committed structural-quality findings (quality-ci-reader-v2 decisions 17-18) — separate from
// verifier results, flags, and the claim ledger. Page-scoped findings live in page shards; group
// findings in one structural shard per nav group. ALL structural findings are nonblocking in
// 0.1.0 (decision 21): committed work items, never the flag queue.

export const structuralDetectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('deterministic'), id: z.string().min(1), version: z.string().min(1) }),
  z.object({
    kind: z.literal('ai-assessed'),
    id: z.string().min(1),
    version: z.string().min(1),
    model: z.string().min(1)
  })
]);
export type StructuralDetector = z.infer<typeof structuralDetectorSchema>;

export const structuralScopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('entity'),
    pageId: pageIdSchema,
    entityId: z.union([sectionIdSchema, blockIdSchema]).optional()
  }),
  z.object({
    kind: z.literal('nav-group'),
    groupId: z.string().min(1),
    pageIds: z.array(pageIdSchema).min(1)
  })
]);
export type StructuralScope = z.infer<typeof structuralScopeSchema>;

// The evidence ladder (quality-ci-reader-v2 decision 19): WHY the expectation holds determines
// how the finding is labeled and how much authority it carries. Explicit rules and accepted
// profiles are deterministic; AI-derived plan conformance is labeled AI-derived; inferred sibling
// conventions are candidate-only and require per-page AI applicability.
export const structuralAuthoritySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('explicit-ia-rule'),
    // The registry-addressed consistency-rule code from ia.yml.
    ruleCode: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/)
  }),
  z.strictObject({ kind: z.literal('accepted-profile'), profileId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('ai-plan-conformance'), model: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('inferred-convention'),
    cohortSize: z.number().int().min(2),
    // Fraction of cohort pages exhibiting the convention when it was inferred (≥ 0.6 in 0.1.0).
    prevalence: z.number().min(0).max(1)
  })
]);
export type StructuralAuthority = z.infer<typeof structuralAuthoritySchema>;

// Auto-resolve happens only after the same scope is re-evaluated; suppression reopens when the
// scope fingerprint no longer matches (material change).
export const structuralFindingStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('open') }),
  z.object({ state: z.literal('resolved') }),
  z.object({ state: z.literal('suppressed'), reason: z.string().min(1), scopeFingerprint: contentHashSchema })
]);
export type StructuralFindingStatus = z.infer<typeof structuralFindingStatusSchema>;

// Not lie-grade severity — reader-visible quality impact used for repair ordering.
export const structuralImpactSchema = z.enum(['low', 'medium', 'high']);

export const structuralEvidenceItemSchema = z.object({
  pageId: pageIdSchema.optional(),
  entityId: z.union([sectionIdSchema, blockIdSchema]).optional(),
  detail: z.string().min(1)
});

export const structuralFindingSchema = z.object({
  schemaVersion: z.literal(1),
  // Stable semantic key (detector + scope + facet), NOT a minted id — the same defect re-detected
  // across runs must collapse onto one finding.
  key: z.string().min(1),
  code: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/),
  scope: structuralScopeSchema,
  detector: structuralDetectorSchema,
  // What grounds the expectation the finding is measured against.
  authority: structuralAuthoritySchema,
  impact: structuralImpactSchema,
  status: structuralFindingStatusSchema,
  evidence: z.array(structuralEvidenceItemSchema).default([]),
  // Pages `refine` would regenerate to repair this finding — only 'expected' pages, never the
  // whole cohort (quality-ci-reader-v2 decision 20).
  repairTargets: z.array(pageIdSchema).default([]),
  message: z.string().min(1),
  rationale: z.string().optional(),
  // Fingerprint of the scoped content at detection time; drives auto-resolve and suppression
  // reopening on material change.
  scopeFingerprint: contentHashSchema
});
export type StructuralFinding = z.infer<typeof structuralFindingSchema>;

// The structure pass input (quality-ci-reader-v2 decision 18): built over the staged canonical
// site, it is everything detectors and the group assessor see — nav cohorts, per-page structure
// summaries, what changed, what could not be evaluated, and the prior findings to reconcile.
export const structuralSnapshotPageSchema = z.object({
  pageId: pageIdSchema,
  // The owning nav group, when the page belongs to one.
  groupId: z.string().min(1).optional(),
  brief: z.string().min(1),
  primaryPersona: z.string().min(1),
  structureProfile: z.string().min(1).optional(),
  outline: z.array(z.object({ title: z.string().min(1), level: z.number().int().positive() })).default([]),
  blockSummary: z.array(z.object({ blockType: z.string().min(1), count: z.number().int().positive() })).default([]),
  // The code subjects the page's ledger claims are about.
  claimSubjects: z.array(symbolSourceKeySchema).default([]),
  // The PagePlan outline the page was written against, when one exists.
  plan: z.string().min(1).optional()
});
export type StructuralSnapshotPage = z.infer<typeof structuralSnapshotPageSchema>;

export const structuralSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: isoTimestampSchema,
  // Nav groups/cohorts from resolved ia.yml.
  groups: z
    .array(
      z.object({
        groupId: z.string().min(1),
        title: z.string().min(1).optional(),
        pageIds: z.array(pageIdSchema).default([])
      })
    )
    .default([]),
  pages: z.array(structuralSnapshotPageSchema).default([]),
  // Scopes whose content changed since the last structure pass (what detectors re-evaluate).
  changedScopes: z.array(structuralScopeSchema).default([]),
  // Scopes skipped this pass (budget exhausted → publish still allowed, decision 21).
  pendingScopes: z.array(structuralScopeSchema).default([]),
  // Keys of prior findings the pass must reconcile (auto-resolve/reopen).
  priorFindingKeys: z.array(z.string().min(1)).default([])
});
export type StructuralSnapshot = z.infer<typeof structuralSnapshotSchema>;
