import { z } from 'zod';
import {
  blockIdSchema,
  claimIdSchema,
  gitShaSchema,
  isoTimestampSchema,
  lineSpanSchema,
  pageIdSchema,
  repoPathSchema,
  sectionIdSchema,
  sourceKeySchema
} from './primitives.ts';

// The claim ledger is the v2 trust spine (trust-model-v2 decisions 1-6): the writer emits MDX plus
// this structured ledger in one task, the kernel anchors and validates it BEFORE verification, and
// every reader-facing trust surface derives from it.

// v2 claim classes (trust-model-v2 decision 3, quality-ci-reader-v2 decision 5). The class formerly
// called 'structural' is 'code-structure' — page-structure quality is never a claim.
export const claimClassV2Schema = z.enum(['shape', 'value', 'behavior', 'code-structure']);
export type ClaimClassV2 = z.infer<typeof claimClassV2Schema>;

// Environment fingerprint recorded with execution evidence (pipeline-v2 decision 5). `sandbox` is an
// open lowercase token ('none' today) so future sandbox kinds extend without a schema break.
export const executionEnvironmentSchema = z.object({
  os: z.string().min(1),
  runtimeVersions: z.record(z.string().min(1), z.string().min(1)).default({}),
  sandbox: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .default('none')
});
export type ExecutionEnvironment = z.infer<typeof executionEnvironmentSchema>;

export const evidenceKindSchema = z.enum([
  'codemap-grounding',
  'source-linked',
  'execution',
  'schema-check',
  'owner-attestation',
  // For origin:ai knowledge facts — rendered as a cited external fact, never "maintainer-attested".
  'external-citation',
  // Third-party verifier evidence: does not mint the built-in badge unless promoted in config.
  'project-defined'
]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const evidenceRefSchema = z.discriminatedUnion('kind', [
  // Grounding suffices as "checked" for shape claims only; for value/behavior it confers merely
  // source-linked (subject real, assertion unchecked) — trust-model-v2 decision 3.
  z.object({
    kind: z.literal('codemap-grounding'),
    symbol: sourceKeySchema,
    file: repoPathSchema.optional(),
    span: lineSpanSchema.optional(),
    commit: gitShaSchema.optional()
  }),
  z.object({
    kind: z.literal('source-linked'),
    symbol: sourceKeySchema,
    file: repoPathSchema.optional(),
    span: lineSpanSchema.optional(),
    commit: gitShaSchema.optional()
  }),
  z.object({ kind: z.literal('execution'), check: z.string().min(1), environment: executionEnvironmentSchema }),
  z.object({ kind: z.literal('schema-check'), check: z.string().min(1) }),
  z.object({ kind: z.literal('owner-attestation'), author: z.string().min(1), at: isoTimestampSchema }),
  z.object({ kind: z.literal('external-citation'), url: z.url() }),
  z.object({
    kind: z.literal('project-defined'),
    verifier: z.string().min(1),
    plugin: z.string().min(1),
    // Explicit config promotion is what lets this evidence mint the built-in badge.
    promoted: z.boolean().default(false)
  })
]);
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

// Explicit reason states replacing the old 'out-of-domain' bucket (trust-model-v2 provisional).
export const uncheckedReasonSchema = z.enum(['no-checker-available', 'needs-owner-input']);

// Correctness axis. Owner-attested claims are modeled as 'checked' with 'owner-attestation'
// evidence — attestation counts toward 100% (trust-model-v2 decision 5); the popover distinguishes
// it from mechanical checks via the evidence kind.
export const claimDispositionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('checked'), evidence: evidenceRefSchema }),
  z.object({ status: z.literal('unchecked'), reason: uncheckedReasonSchema }),
  z.object({ status: z.literal('contradicted'), evidence: evidenceRefSchema, detail: z.string().optional() })
]);
export type ClaimDisposition = z.infer<typeof claimDispositionSchema>;

export const isOwnerAttested = (disposition: ClaimDisposition): boolean =>
  disposition.status === 'checked' && disposition.evidence.kind === 'owner-attestation';

// Typed fingerprint subscriptions (pipeline-v2 decision 4): a claim subscribes to the fingerprint
// kind it actually depends on. Value subscriptions carry the cited value so a value-print change
// can be compared against what the docs assert.
export const fingerprintSubscriptionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('signature'), symbolHash: sourceKeySchema }),
  z.object({
    kind: z.literal('value'),
    symbolHash: sourceKeySchema,
    valueName: z.string().min(1),
    citedValue: z.string()
  }),
  z.object({ kind: z.literal('body'), symbolHash: sourceKeySchema })
]);
export type FingerprintSubscription = z.infer<typeof fingerprintSubscriptionSchema>;

// The id attribute of the inline <Claim id> marker in the MDX (harness-state-v2 decision 5).
export const claimMarkerIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const ledgerClaimSchema = z.object({
  claimId: claimIdSchema,
  class: claimClassV2Schema,
  // Normalized predicate text — what the claim asserts, stripped of surrounding prose.
  predicate: z.string().min(1),
  // Claims are authored inline: the anchor is the owning block plus the marker id, never offsets.
  anchor: z.object({ blockId: blockIdSchema, markerId: claimMarkerIdSchema }),
  // Which entity revision the claim was minted against.
  scope: z.object({
    entityId: z.union([pageIdSchema, sectionIdSchema, blockIdSchema]),
    revision: gitShaSchema
  }),
  subscriptions: z.array(fingerprintSubscriptionSchema).default([]),
  // All evidence collected for the claim; the disposition carries the deciding ref.
  evidence: z.array(evidenceRefSchema).default([]),
  disposition: claimDispositionSchema
});
export type LedgerClaim = z.infer<typeof ledgerClaimSchema>;

// Coverage-linter output (harness-state-v2 decision 5): assertion-shaped spans (identifiers,
// defaults, numbers, modal statements) not covered by any claim — ledger omission cannot
// manufacture "100% checked".
export const coverageLintSpanSchema = z.object({
  blockId: blockIdSchema,
  excerpt: z.string().min(1),
  detector: z.string().optional()
});
export type CoverageLintSpan = z.infer<typeof coverageLintSpanSchema>;

export const claimLedgerSchema = z.object({
  schemaVersion: z.literal(1),
  pageId: pageIdSchema,
  sourceRevision: gitShaSchema,
  claims: z.array(ledgerClaimSchema).default([]),
  coverageLint: z.object({ uncovered: z.array(coverageLintSpanSchema).default([]) }).prefault({})
});
export type ClaimLedger = z.infer<typeof claimLedgerSchema>;
