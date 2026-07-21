import { z } from 'zod';
import { claimMarkerIdSchema } from './claim-ledger-schema.ts';
import { entityAddressSchema } from './entity-schema.ts';
import { blockIdSchema, lineSpanSchema, repoPathSchema, severitySchema, sha256HexSchema } from './primitives.ts';
import { verificationResultSchema } from './provenance-schema.ts';

// A finding is one actionable observation from a verifier, a persona reviewer, or a prose lint.
// Findings feed the gate (fail → bounded retry with findings attached) and the dashboard.
export const findingSourceSchema = z.enum(['verifier', 'review', 'lint']);

export const findingSchema = z.object({
  source: findingSourceSchema,
  // Verifier id ("code-typecheck-ts") or review criterion id ("audience-fit").
  check: z.string().min(1),
  severity: severitySchema,
  message: z.string().min(1),
  entity: entityAddressSchema.optional(),
  file: repoPathSchema.optional(),
  span: lineSpanSchema.optional(),
  suggestion: z.string().optional(),
  // Structured extras a retry prompt or the UI can use; shape owned by the emitting check.
  data: z.unknown().optional()
});
export type Finding = z.infer<typeof findingSchema>;

// Structured per-claim execution result (impl-07 finding 2): what one executed snippet actually
// did for one declared behavior claim. Snippet identity (block id + content hash), the ACTUAL
// runtime, the exit code, and the executed source travel with the declaration so the kernel can
// re-verify — a bare covers= token decides nothing on its own.
export const claimExecutionRecordSchema = z.object({
  markerId: claimMarkerIdSchema,
  blockId: blockIdSchema,
  // Same shape the block entity carries (sha256 hex of the fence source).
  contentHash: sha256HexSchema,
  language: z.string().min(1),
  runtime: z.enum(['node', 'bash']),
  exitCode: z.number().int(),
  // Deterministic failure-capable-assertion detection over the executed source (the verifier's
  // own computation; the kernel recomputes from `source` and refuses on disagreement).
  assertionBearing: z.boolean(),
  // The exact source that executed — lets the kernel recompute assertion detection and bind the
  // record to the page block by content hash. In-memory only; evidence records persist identity,
  // never the source.
  source: z.string()
});
export type ClaimExecutionRecord = z.infer<typeof claimExecutionRecordSchema>;

export const verifierRunResultSchema = z.object({
  verifier: z.string().min(1),
  plugin: z.string().min(1),
  status: verificationResultSchema,
  findings: z.array(findingSchema).default([]),
  // Entity ids this run actually checked — what a `pass` proves (guarantee assignment input).
  coveredEntityIds: z.array(z.string()).default([]),
  // Structured claim-execution results (snippet-exec): the ONLY channel that can decide behavior
  // claims — coveredEntityIds alone never mints behavior evidence. Absent for verifiers that
  // execute nothing.
  claimExecutions: z.array(claimExecutionRecordSchema).optional(),
  durationMs: z.number().nonnegative().optional()
});
export type VerifierRunResult = z.infer<typeof verifierRunResultSchema>;

// Persona review output: explainable criteria results only, never an opaque score.
export const criterionResultSchema = z.object({
  criterion: z.string().min(1),
  outcome: z.enum(['met', 'not-met', 'not-applicable']),
  reasoning: z.string().min(1)
});

export const reviewResultSchema = z.object({
  persona: z.string().min(1),
  criteria: z.array(criterionResultSchema),
  findings: z.array(findingSchema).default([])
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;
