import { z } from 'zod';
import {
  blockIdSchema,
  contentHashSchema,
  isoTimestampSchema,
  pageIdSchema,
  sectionIdSchema,
  symbolSourceKeySchema
} from './primitives.ts';

// Group ids are ia.yml v2 identities (ia-v2-schema `iaGroupNodeV2ObjectSchema.groupId`); the same
// pattern is spelled here so the finding contracts do not depend on the IA schema.
export const structuralGroupIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

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
    groupId: structuralGroupIdSchema,
    pageIds: z.array(pageIdSchema).min(1)
  })
]);
export type StructuralScope = z.infer<typeof structuralScopeSchema>;

// THE RE-EVALUATION UNIT. Auto-resolve is only allowed "after the same scope is re-evaluated"
// (decision 17), so the pass must be able to say which scopes it looked at — and a nav-group scope
// is the group, NOT the particular cohort membership it happened to carry when a finding was
// minted. Membership changes are exactly what a re-evaluation is supposed to notice.
export const structuralScopeKey = (scope: StructuralScope): string =>
  scope.kind === 'entity' ? `entity:${scope.pageId}` : `nav-group:${scope.groupId}`;

// The evidence ladder (quality-ci-reader-v2 decision 19): WHY the expectation holds determines
// how the finding is labeled and how much authority it carries. Explicit rules and accepted
// profiles are deterministic; AI-derived plan conformance is labeled AI-derived; inferred sibling
// conventions are candidate-only and require per-page AI applicability.
const ruleCodeSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/);

export const structuralAuthoritySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('explicit-ia-rule'),
    // The registry-addressed consistency-rule code from ia.yml.
    ruleCode: ruleCodeSchema
  }),
  // OUTLINE INTEGRITY IS NOT A CONSISTENCY EXPECTATION. The evidence ladder above grades why a
  // CROSS-PAGE expectation holds; a heading with nothing under it, or the same heading twice on one
  // page, is an intrinsic defect that holds on its own — no rule in ia.yml, no profile, no cohort.
  // Without this arm such a finding would have to masquerade as an `explicit-ia-rule` the user never
  // wrote, which is exactly the kind of invented authority the ladder exists to prevent. Always
  // deterministic: the tool asserts the rule, so nothing is left to judge.
  z.strictObject({ kind: z.literal('builtin-rule'), ruleCode: ruleCodeSchema }),
  z.strictObject({ kind: z.literal('accepted-profile'), profileId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('ai-plan-conformance'), model: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('inferred-convention'),
    // Candidate thresholds are binding (quality-ci-reader-v2 decision 19): a convention inferred
    // from fewer than 4 cohort pages or below 0.6 prevalence is not a candidate at all.
    cohortSize: z.number().int().min(4),
    prevalence: z.number().min(0.6).max(1)
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

// Authority is coupled to detector kind: an inferred convention exists only via AI adjudication;
// explicit rules and accepted profiles are deterministic by definition; AI plan conformance may be
// surfaced by either detector kind but is always labeled with the deriving model.
const structuralAuthorityDetectorKinds: Record<StructuralAuthority['kind'], readonly StructuralDetector['kind'][]> = {
  'explicit-ia-rule': ['deterministic'],
  'builtin-rule': ['deterministic'],
  'accepted-profile': ['deterministic'],
  'ai-plan-conformance': ['deterministic', 'ai-assessed'],
  'inferred-convention': ['ai-assessed']
};

const structuralFindingObjectSchema = z.object({
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

export const structuralFindingSchema = structuralFindingObjectSchema.superRefine((finding, ctx) => {
  const allowed = structuralAuthorityDetectorKinds[finding.authority.kind];
  if (!allowed.includes(finding.detector.kind)) {
    ctx.addIssue({
      code: 'custom',
      path: ['authority'],
      message: `'${finding.authority.kind}' authority cannot come from a '${finding.detector.kind}' detector`
    });
  }
});
export type StructuralFinding = z.infer<typeof structuralFindingSchema>;

// The structure pass input (quality-ci-reader-v2 decision 18): built over the staged canonical
// site, it is everything detectors and the group assessor see — nav cohorts, per-page structure
// summaries, what changed, what could not be evaluated, and the prior findings to reconcile.
// One heading in a page's outline. `sectionId`/`anchor`/`blockTypes` carry the entity identity and
// the section's block composition (decision 18 names "outlines, block types" as snapshot content),
// which is what lets an outline-integrity finding scope to the offending SECTION rather than
// vaguely to the page.
export const structuralOutlineEntrySchema = z.object({
  title: z.string().min(1),
  level: z.number().int().positive(),
  sectionId: sectionIdSchema.optional(),
  anchor: z.string().min(1).optional(),
  blockTypes: z.array(z.string().min(1)).default([])
});
export type StructuralOutlineEntry = z.infer<typeof structuralOutlineEntrySchema>;

export const structuralSnapshotPageSchema = z.object({
  pageId: pageIdSchema,
  // The owning nav group, when the page belongs to one.
  groupId: structuralGroupIdSchema.optional(),
  brief: z.string().min(1),
  primaryPersona: z.string().min(1),
  structureProfile: z.string().min(1).optional(),
  // Facet/rule codes ia.yml declares this page exempt from (user intent, never AI-derived).
  structuralExceptions: z.array(z.string().min(1)).default([]),
  // The content hash of the page's outline — the group-assessment cache key ingredient that makes
  // "this cohort's structure is unchanged" cheap to decide (decision 7).
  outlineHash: contentHashSchema.optional(),
  outline: z.array(structuralOutlineEntrySchema).default([]),
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
        groupId: structuralGroupIdSchema,
        title: z.string().min(1).optional(),
        pageIds: z.array(pageIdSchema).default([]),
        // ia.yml's consistency posture for the group: 'off' skips it entirely, 'inferred' allows
        // sibling-convention CANDIDATES (AI-adjudicated), 'explicit' makes the listed rules
        // deterministic. Mirrored from ia.yml so detectors never reach back into the IA.
        consistencyMode: z.enum(['off', 'inferred', 'explicit']).default('inferred'),
        consistencyRules: z
          .array(z.object({ code: z.string().min(1), parameters: z.record(z.string().min(1), z.unknown()).optional() }))
          .default([])
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

// GROUP FINDINGS GET THEIR OWN SHARD, one per nav group (decision 17):
// `.docstube/manifest/structure/<groupId>.json`. They cannot live on a page shard — a
// sibling-asymmetry finding is ABOUT the cohort, and duplicating it onto eight shards would make
// eight parallel PRs conflict on the same fact. There is deliberately NO locale dimension:
// renditions are structurally isomorphic to the canonical page, so the group is assessed once, in
// the source locale, and every locale inherits the verdict (decision 7).
export const structuralGroupShardSchema = z
  .object({
    schemaVersion: z.literal(1),
    groupId: structuralGroupIdSchema,
    generatedAt: isoTimestampSchema,
    // Cohort membership at the last evaluation. This is what lets the NEXT run find the group a
    // page LEFT: without it, a page moving between groups would silently strand its old group's
    // finding, which is exactly the "recorded state disagrees with reality" failure to avoid.
    pageIds: z.array(pageIdSchema).default([]),
    findings: z.array(structuralFindingSchema).default([])
  })
  .superRefine((shard, ctx) => {
    for (const finding of shard.findings) {
      if (finding.scope.kind !== 'nav-group') {
        ctx.addIssue({
          code: 'custom',
          path: ['findings'],
          message: `finding "${finding.key}" is ${finding.scope.kind}-scoped — only nav-group findings persist in a structural group shard`
        });
        continue;
      }
      if (finding.scope.groupId !== shard.groupId) {
        ctx.addIssue({
          code: 'custom',
          path: ['findings'],
          message: `finding "${finding.key}" is scoped to group "${finding.scope.groupId}", not this shard's "${shard.groupId}"`
        });
      }
    }
  });
export type StructuralGroupShard = z.infer<typeof structuralGroupShardSchema>;

export const structuralGroupShardRelativePath = (groupId: string): string => `structure/${groupId}.json`;
