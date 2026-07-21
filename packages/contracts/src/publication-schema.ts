import { z } from 'zod';
import {
  claimIdSchema,
  contentHashSchema,
  gitCommitSchema,
  isoTimestampSchema,
  pageIdSchema,
  repoPathSchema,
  semverSchema,
  waiverIdSchema
} from './primitives.ts';

// Kernel-owned fail-closed PublicationDecision (quality-ci-reader-v2 decision 9): `generate --ci`
// emits exactly one of these bound to the candidate tree; the Action validates and enforces.
// Absence, mismatch, missing shards, deferred work, or unknown reason codes fail closed — the
// schema itself rejects contradictory artifacts, so a forged-or-buggy "publishable frozen run"
// never parses.

export const publicationExecutionSchema = z.enum(['completed', 'paused-budget', 'failed']);

// Semantic base-vs-candidate ledger regressions (quality-ci-reader-v2 decision 12).
export const publicationRegressionKindSchema = z.enum([
  'badge-loss',
  'disposition-regression',
  'checked-count-drop',
  'evidence-authority-weakening',
  'attestation-loss'
]);

export const publicationRegressionSchema = z.object({
  kind: publicationRegressionKindSchema,
  pageId: pageIdSchema,
  detail: z.string().optional()
});
export type PublicationRegression = z.infer<typeof publicationRegressionSchema>;

export const blockingDispositionSchema = z.object({
  pageId: pageIdSchema,
  claimId: claimIdSchema,
  // A blocking condition is either contradicted correctness or the maintainer-input disposition.
  status: z.enum(['contradicted', 'maintainer-input-needed'])
});

// The documented coverage-obligation statuses (quality-ci-reader-v2 decision 13).
export const coverageObligationStatusSchema = z.enum([
  'documented',
  'generated-reference-only',
  'intentionally-omitted',
  'not-public-for-docs',
  'unassigned'
]);
export type CoverageObligationStatus = z.infer<typeof coverageObligationStatusSchema>;

// Typed per-obligation deltas: the ratchet (no-new-debt, decision 13) needs to see WHICH
// obligation moved and in what scope — counts alone cannot detect a status regression.
export const coverageObligationDeltaSchema = z.object({
  obligationId: z.string().min(1),
  // The obligation's scope (a glob or symbol container path from the owning IA page).
  scope: z.string().min(1),
  beforeStatus: coverageObligationStatusSchema,
  afterStatus: coverageObligationStatusSchema
});
export type CoverageObligationDelta = z.infer<typeof coverageObligationDeltaSchema>;

// The reason-code registry is CLOSED and versioned with the decision schema: unknown codes are a
// schema break by design — the Action fails closed on anything it cannot interpret.
export const publicationReasonCodeRegistryVersion = 1;
export const reasonCodeSchema = z.enum([
  'budget.frozen',
  'execution.failed',
  'gate.blocked',
  'plan.deferred',
  'ledger.regression',
  'ledger.blocking-disposition',
  'coverage.regression',
  'inventory.mismatch'
]);
export type PublicationReasonCode = z.infer<typeof reasonCodeSchema>;

export const publicationDecisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    toolVersion: semverSchema,
    baseSha: gitCommitSchema,
    sourceSha: gitCommitSchema,
    // Hash binding the decision to the exact candidate output tree (the OutputInventory hash).
    candidateArtifactHash: contentHashSchema,
    execution: publicationExecutionSchema,
    plan: z.object({
      planned: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
      deferred: z.number().int().nonnegative()
    }),
    deterministicGate: z.enum(['clean', 'blocked']),
    regressions: z.array(publicationRegressionSchema).default([]),
    newBlockingDispositions: z.array(blockingDispositionSchema).default([]),
    coverageDelta: z.array(coverageObligationDeltaSchema).default([]),
    // Frozen runs → publishable:false (staged-atomic; the site never shows a half-applied change).
    publishable: z.boolean(),
    autoMergeEligible: z.boolean(),
    reasonCodes: z.array(reasonCodeSchema).default([])
  })
  .superRefine((decision, ctx) => {
    if (decision.execution !== 'completed' && decision.publishable) {
      ctx.addIssue({
        code: 'custom',
        path: ['publishable'],
        message: `a ${decision.execution} run is never publishable — staged work publishes atomically on completion`
      });
    }
    if (decision.publishable && decision.deterministicGate !== 'clean') {
      ctx.addIssue({
        code: 'custom',
        path: ['publishable'],
        message: 'publishable requires a clean deterministic gate'
      });
    }
    if (decision.plan.deferred > 0 && decision.autoMergeEligible) {
      ctx.addIssue({
        code: 'custom',
        path: ['autoMergeEligible'],
        message: 'deferred work fails closed — an incomplete plan is never auto-merge eligible'
      });
    }
    if (decision.autoMergeEligible && !decision.publishable) {
      ctx.addIssue({
        code: 'custom',
        path: ['autoMergeEligible'],
        message: 'auto-merge eligibility requires publishable'
      });
    }
    if (decision.deterministicGate === 'blocked' && decision.reasonCodes.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasonCodes'],
        message: 'a blocked gate must state its reason codes'
      });
    }
  });
export type PublicationDecision = z.infer<typeof publicationDecisionSchema>;

// The commit-boundary allowlist (decision 11): the Action stages only declared paths and marks the
// candidate ineligible on any undeclared write or hash mismatch.
export const outputInventorySchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(z.object({ path: repoPathSchema, contentHash: contentHashSchema })).default([])
});
export type OutputInventory = z.infer<typeof outputInventorySchema>;

// A recorded waiver replaces silent dismissal (decision 13). Strict scope arms: a claim waiver
// without its claim id, or a project waiver smuggling an entity binding, must not parse.
export const waiverScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('claim'), pageId: pageIdSchema, claimId: claimIdSchema }),
  z.strictObject({ kind: z.literal('page'), pageId: pageIdSchema }),
  z.strictObject({ kind: z.literal('project') }),
  z.strictObject({ kind: z.literal('system') })
]);
export type WaiverScope = z.infer<typeof waiverScopeSchema>;

export const waiverSchema = z.object({
  schemaVersion: z.literal(1),
  waiverId: waiverIdSchema,
  actor: z.string().min(1),
  timestamp: isoTimestampSchema,
  reason: z.string().min(1),
  scope: waiverScopeSchema,
  // The waived subject at grant time: the waiver invalidates when the subject materially changes
  // (fingerprint no longer matches).
  grantedAgainst: z.object({
    fingerprint: contentHashSchema,
    commit: gitCommitSchema.optional()
  }),
  // Where the waiver was granted (config path, PR comment URL, dashboard action id).
  policySource: z.string().min(1).optional(),
  expiry: isoTimestampSchema.optional()
});
export type Waiver = z.infer<typeof waiverSchema>;
