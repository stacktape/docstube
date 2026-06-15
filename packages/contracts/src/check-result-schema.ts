import { z } from 'zod';
import { findingSchema } from './findings-schema';
import { identifierSchema } from './primitives';

// Deterministic-check result taxonomy.
//
// Every deterministic verifier returns one of a fixed set of result statuses. `passed` and
// `failed` are gate outcomes; `skipped` is for unavailable optional tooling (recorded explicitly,
// never silently); `errored` is for a check that could not run to a verdict. Failures carry
// structured findings; skips carry a reason; errors carry a message. No numeric scores.

export const checkStatuses = ['passed', 'failed', 'skipped', 'errored'] as const;

export const checkStatusSchema = z.enum(checkStatuses);

export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const checkResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    checkId: identifierSchema,
    status: z.literal('passed')
  }),
  z.strictObject({
    checkId: identifierSchema,
    status: z.literal('failed'),
    findings: z.array(findingSchema).min(1, { error: 'a failed check must report at least one finding' })
  }),
  z.strictObject({
    checkId: identifierSchema,
    status: z.literal('skipped'),
    reason: z.string().min(1, { error: 'a skipped check must record a reason' })
  }),
  z.strictObject({
    checkId: identifierSchema,
    status: z.literal('errored'),
    error: z.string().min(1, { error: 'an errored check must record an error message' })
  })
]);

export type CheckResult = z.infer<typeof checkResultSchema>;
