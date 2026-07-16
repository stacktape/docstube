import { z } from 'zod';
import { flagSchema } from './flag-schema.ts';
import { findingSchema } from './findings-schema.ts';
import { isoTimestampSchema, pageIdSchema, runIdSchema, taskIdSchema } from './primitives.ts';
import { taskUsageSchema } from './agent-task-schema.ts';

// The run journal (.docstube/runs/<runId>/journal.jsonl) is the source of truth for run state.
// Dashboard timelines are pure renderers over it (+ the sqlite view) — refresh-safe, identical
// after resume (PRODUCT §3.9.3). Events are append-only, one JSON object per line.

export const pipelineStageSchema = z.enum([
  'codemap',
  'context-assembly',
  'write',
  'review',
  'verify',
  'gate',
  'assemble',
  'maintain'
]);
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

export const pageStatusSchema = z.enum(['queued', 'writing', 'checking', 'judging', 'retrying', 'passed', 'flagged']);
export type PageStatus = z.infer<typeof pageStatusSchema>;

export const runModeSchema = z.enum(['generate', 'refresh', 'refine', 'audit']);

const eventBase = {
  runId: runIdSchema,
  seq: z.number().int().nonnegative(),
  at: isoTimestampSchema
} as const;

export const runEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('run-started'), mode: runModeSchema, commit: z.string() }),
  z.object({
    ...eventBase,
    type: z.literal('stage-started'),
    stage: pipelineStageSchema,
    pageId: pageIdSchema.optional()
  }),
  z.object({
    ...eventBase,
    type: z.literal('stage-completed'),
    stage: pipelineStageSchema,
    pageId: pageIdSchema.optional(),
    // Hash of the stage's inputs — resume skips stages whose input hash is unchanged.
    inputHash: z.string(),
    durationMs: z.number().nonnegative()
  }),
  z.object({ ...eventBase, type: z.literal('page-status'), pageId: pageIdSchema, status: pageStatusSchema }),
  z.object({ ...eventBase, type: z.literal('task-started'), taskId: taskIdSchema, pageId: pageIdSchema.optional() }),
  z.object({
    ...eventBase,
    type: z.literal('task-completed'),
    taskId: taskIdSchema,
    pageId: pageIdSchema.optional(),
    usage: taskUsageSchema
  }),
  z.object({
    ...eventBase,
    type: z.literal('findings'),
    pageId: pageIdSchema.optional(),
    findings: z.array(findingSchema)
  }),
  z.object({
    ...eventBase,
    type: z.literal('retry-scheduled'),
    pageId: pageIdSchema,
    attempt: z.number().int().positive(),
    maxAttempts: z.number().int().positive()
  }),
  z.object({ ...eventBase, type: z.literal('flag-raised'), flag: flagSchema }),
  // Usage caps are approximate: freeze with margin, surface a banner (PRODUCT §3.5).
  z.object({ ...eventBase, type: z.literal('run-frozen'), reason: z.string(), spentUsd: z.number().nonnegative() }),
  z.object({
    ...eventBase,
    type: z.literal('run-completed'),
    outcome: z.enum(['passed', 'flagged', 'frozen', 'failed']),
    error: z.string().optional()
  })
]);
export type RunEvent = z.infer<typeof runEventSchema>;
