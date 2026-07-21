import { z } from 'zod';
import { blockIdSchema, pageIdSchema, sectionIdSchema, sha256HexSchema } from './primitives.ts';

// Committed structural-quality findings (quality-ci-reader-v2 decision 17) — separate from
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

// Auto-resolve happens only after the same scope is re-evaluated; suppression reopens when the
// scope fingerprint no longer matches (material change).
export const structuralFindingStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('open') }),
  z.object({ state: z.literal('resolved') }),
  z.object({ state: z.literal('suppressed'), reason: z.string().min(1), scopeFingerprint: sha256HexSchema })
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
  // Stable semantic key (detector + scope + facet), NOT a minted id — the same defect re-detected
  // across runs must collapse onto one finding.
  key: z.string().min(1),
  code: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/),
  scope: structuralScopeSchema,
  detector: structuralDetectorSchema,
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
  scopeFingerprint: sha256HexSchema
});
export type StructuralFinding = z.infer<typeof structuralFindingSchema>;
