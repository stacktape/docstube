import { z } from 'zod';
import {
  isoTimestampSchema,
  lineSpanSchema,
  repoPathSchema,
  semverSchema,
  sha256HexSchema,
  sourceKeySchema
} from './primitives.ts';

// Guarantee levels are computed, never asserted (ARCHITECTURE.md §4):
//   proven         at least one passing deterministic verification covers the claim class
//   scored         criteria-based AI review only
//   out-of-domain  declared unprovable (tribal knowledge, intent) — flagged, never silently wrong
export const guaranteeLevelSchema = z.enum(['proven', 'scored', 'out-of-domain']);
export type GuaranteeLevel = z.infer<typeof guaranteeLevelSchema>;

const guaranteeRank: Record<GuaranteeLevel, number> = { proven: 2, scored: 1, 'out-of-domain': 0 };

// Pessimistic roll-up: a parent displays the weakest guarantee among its children. Callers pass
// only the levels of PROVABLE children (code blocks, claim-bearing prose) — claimless narrative
// has no deterministic check to pass, so it never drags a parent down, and "proven" on a parent
// means "everything provable underneath is proven". No provable children ⇒ 'scored' (there is
// nothing to prove, but also nothing alarming — 'out-of-domain' here read as a red flag).
export const rollUpGuarantee = (levels: readonly GuaranteeLevel[]): GuaranteeLevel => {
  let weakest: GuaranteeLevel = 'proven';
  for (const level of levels) {
    if (guaranteeRank[level] < guaranteeRank[weakest]) {
      weakest = level;
    }
  }
  return levels.length === 0 ? 'scored' : weakest;
};

// Grounding: which source symbol (by normalized hash, never by name) an entity derives from.
export const sourceRefSchema = z.object({
  symbol: sourceKeySchema,
  file: repoPathSchema,
  span: lineSpanSchema.optional(),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/)
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

export const provenanceSchema = z.object({
  sources: z.array(sourceRefSchema).default([]),
  // Context-assembly items handed to the writer (ctx_… ids into the run journal).
  seedContext: z.array(z.string()).default([]),
  observedReads: z.array(observedReadSchema).default([]),
  verifications: z.array(verificationRecordSchema).default([])
});
export type Provenance = z.infer<typeof provenanceSchema>;
