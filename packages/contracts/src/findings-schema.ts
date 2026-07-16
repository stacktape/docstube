import { z } from 'zod';
import { entityAddressSchema } from './entity-schema.ts';
import { lineSpanSchema, repoPathSchema, severitySchema } from './primitives.ts';
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

export const verifierRunResultSchema = z.object({
  verifier: z.string().min(1),
  plugin: z.string().min(1),
  status: verificationResultSchema,
  findings: z.array(findingSchema).default([]),
  // Entity ids this run actually checked — what a `pass` proves (guarantee assignment input).
  coveredEntityIds: z.array(z.string()).default([]),
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
