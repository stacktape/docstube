import { z } from 'zod';
import { entityAddressSchema } from './entity-schema.ts';
import { flagIdSchema, isoTimestampSchema, knowledgeNeedIdSchema, runIdSchema, sourceKeySchema } from './primitives.ts';

// Flags are the ONLY human touchpoint in the L4 posture (PRODUCT §3.3): exceptions, not
// supervision. They live in the page shard they belong to (travel with branches); cross-page and
// system-level flags live in the manifest index. The flag queue is a derived view.
export const flagKindSchema = z.enum([
  // A claim declared unprovable (tribal knowledge, intent, "why").
  'out-of-domain',
  // A tribal-knowledge question: ask once, non-blocking, answer becomes durable context.
  'tribal-knowledge',
  // An existing entity's guarantee dropped (e.g. proven → scored) — auto-merge exception.
  'guarantee-downgrade',
  // Structural/IA change on existing docs — auto-merge exception.
  'structural-change',
  // Declared partial coverage (large repos, budget freezes).
  'coverage',
  // System-level failure classes (build-system misidentification, provider mismatch, …).
  'system'
]);
export type FlagKind = z.infer<typeof flagKindSchema>;

export const flagStatusSchema = z.enum(['open', 'answered', 'resolved', 'dismissed']);

export const flagAnswerSchema = z.object({
  text: z.string().min(1),
  answeredAt: isoTimestampSchema,
  // Free-form attribution ("github:someuser", "wizard"); never required.
  author: z.string().optional()
});

export const flagSchema = z.object({
  id: flagIdSchema,
  kind: flagKindSchema,
  status: flagStatusSchema,
  summary: z.string().min(1),
  detail: z.string().optional(),
  entity: entityAddressSchema.optional(),
  // For tribal-knowledge flags: the durable-context key the answer is stored under.
  subjectSymbol: sourceKeySchema.optional(),
  // The KnowledgeNeed this flag is a QUEUE PROJECTION of (dx-knowledge-v2 decision 6). The need —
  // not the flag, and never the question text — owns the durable identity: several pages asking
  // for the same missing fact carry several flags pointing at ONE need, and answering any of them
  // answers all of them. Optional only so flags raised before the KnowledgeNeed store existed stay
  // answerable (the answer path mints the need on the fly).
  needId: knowledgeNeedIdSchema.optional(),
  question: z.string().optional(),
  answer: flagAnswerSchema.optional(),
  runId: runIdSchema.optional(),
  createdAt: isoTimestampSchema
});
export type Flag = z.infer<typeof flagSchema>;

// Hardcoded v1 auto-merge exception rules (PRODUCT §3.3); the v2 policy engine replaces this
// table, not the gate. Any open flag of these kinds blocks auto-merge. tribal-knowledge is
// deliberately absent: docs ship with visible open questions and the answer arrives on a future
// run (PRODUCT §4.1 — non-blocking by design), so an open question must never hold a merge.
export const autoMergeBlockingFlagKinds: readonly FlagKind[] = [
  'out-of-domain',
  'coverage',
  'guarantee-downgrade',
  'structural-change',
  'system'
];
