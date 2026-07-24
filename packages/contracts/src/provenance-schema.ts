import { z } from 'zod';
import {
  isoTimestampSchema,
  lineSpanSchema,
  repoPathSchema,
  semverSchema,
  sha256HexSchema,
  sourceKeySchema
} from './primitives.ts';

// The proven/scored/out-of-domain guarantee ladder is REMOVED (wave 2b demolition): trust state
// lives on the claim ledger + ClaimEvidence; reader surfaces render literal claim counts.

// Grounding: which source symbol (by normalized hash, never by name) an entity derives from.
export const sourceRefSchema = z.object({
  symbol: sourceKeySchema,
  file: repoPathSchema,
  span: lineSpanSchema.optional(),
  // 7..64 hex chars: abbreviated through full SHA-1 (40) and SHA-256 (64) git object ids.
  commit: z.string().regex(/^[0-9a-f]{7,64}$/)
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

// A file the writer agent actually read during generation, recorded by the harness.
export const observedReadSchema = z.object({
  file: repoPathSchema,
  contentHash: sha256HexSchema
});
export type ObservedRead = z.infer<typeof observedReadSchema>;

export const verificationResultSchema = z.enum(['pass', 'fail', 'error', 'skipped']);

export const verificationRecordSchema = z.object({
  verifier: z.string().min(1),
  plugin: z.string().min(1),
  pluginVersion: semverSchema,
  result: verificationResultSchema,
  summary: z.string().optional(),
  at: isoTimestampSchema
});
export type VerificationRecord = z.infer<typeof verificationRecordSchema>;

// Review evidence for a 'scored' badge: which persona reviewed, what each criterion concluded,
// and in which run — the committed manifest must explain every badge, not just 'proven' ones
// (founder decision 2026-07-17; the v2 signed manifest needs this evidence anyway). Reasoning
// prose stays in the run journal; the manifest carries only the compact verdicts.
export const reviewRecordSchema = z.object({
  persona: z.string().min(1),
  criteria: z.array(
    z.object({
      criterion: z.string().min(1),
      outcome: z.enum(['met', 'not-met', 'not-applicable'])
    })
  ),
  runId: z.string().min(1),
  at: isoTimestampSchema
});
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

export const provenanceSchema = z.object({
  sources: z.array(sourceRefSchema).default([]),
  // Context-assembly items handed to the writer (ctx_… ids into the run journal).
  seedContext: z.array(z.string()).default([]),
  observedReads: z.array(observedReadSchema).default([]),
  verifications: z.array(verificationRecordSchema).default([]),
  reviews: z.array(reviewRecordSchema).default([])
});
export type Provenance = z.infer<typeof provenanceSchema>;
