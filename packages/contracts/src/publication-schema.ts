import { z } from 'zod';
import {
  claimIdSchema,
  gitShaSchema,
  isoTimestampSchema,
  pageIdSchema,
  repoPathSchema,
  semverSchema,
  sha256HexSchema
} from './primitives.ts';

// Kernel-owned fail-closed PublicationDecision (quality-ci-reader-v2 decision 9): `generate --ci`
// emits exactly one of these bound to the candidate tree; the Action validates and enforces.
// Absence, mismatch, missing shards, deferred work, or unknown reason codes fail closed.

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
  status: z.enum(['contradicted', 'needs-owner-input'])
});

// Coverage ratchet input (no-new-debt, decision 13): counts of covered obligations before/after.
export const coverageDeltaSchema = z.object({
  before: z.number().int().nonnegative(),
  after: z.number().int().nonnegative()
});

export const reasonCodeSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/);

export const publicationDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  toolVersion: semverSchema,
  baseSha: gitShaSchema,
  sourceSha: gitShaSchema,
  // Hash binding the decision to the exact candidate output tree (the OutputInventory hash).
  candidateArtifactHash: sha256HexSchema,
  execution: publicationExecutionSchema,
  plan: z.object({
    planned: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    deferred: z.number().int().nonnegative()
  }),
  deterministicGate: z.enum(['clean', 'blocked']),
  regressions: z.array(publicationRegressionSchema).default([]),
  newBlockingDispositions: z.array(blockingDispositionSchema).default([]),
  coverageDelta: coverageDeltaSchema,
  // Frozen runs → publishable:false (staged-atomic; the site never shows a half-applied change).
  publishable: z.boolean(),
  autoMergeEligible: z.boolean(),
  reasonCodes: z.array(reasonCodeSchema).default([])
});
export type PublicationDecision = z.infer<typeof publicationDecisionSchema>;

// The commit-boundary allowlist (decision 11): the Action stages only declared paths and marks the
// candidate ineligible on any undeclared write or hash mismatch.
export const outputInventorySchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(z.object({ path: repoPathSchema, contentHash: sha256HexSchema })).default([])
});
export type OutputInventory = z.infer<typeof outputInventorySchema>;

// A recorded waiver replaces silent dismissal (decision 13): invalidated when the waived claim
// materially changes.
export const waiverScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claim'), pageId: pageIdSchema, claimId: claimIdSchema }),
  z.object({ kind: z.literal('page'), pageId: pageIdSchema })
]);

export const waiverSchema = z.object({
  actor: z.string().min(1),
  timestamp: isoTimestampSchema,
  reason: z.string().min(1),
  scope: waiverScopeSchema,
  // Where the waiver was granted (config path, PR comment URL, dashboard action id).
  policySource: z.string().min(1),
  expiry: isoTimestampSchema.optional()
});
export type Waiver = z.infer<typeof waiverSchema>;
