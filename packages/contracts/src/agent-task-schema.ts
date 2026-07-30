import { z } from 'zod';
import { writerClaimLedgerSchema } from './claim-ledger-schema.ts';
import { hashValue } from './hashing.ts';
import { observedReadSchema } from './provenance-schema.ts';
import { repoPathSchema, taskIdSchema } from './primitives.ts';

// The agent-runtime contract (ARCHITECTURE.md §8): docstube owns one loop and one tool surface;
// transports (API or vendor CLI) only carry model traffic. Everything here is serializable so
// tasks can be cached, recorded, and replayed byte-identically in CI.

export const agentTaskKindSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
export const knownAgentTaskKinds = [
  'write-page',
  'review-page',
  'translate-page',
  'propose-ia',
  'categorize-feedback',
  'extract-theme-tokens',
  'audit-extract-claims',
  // Setup's tiny live transport check (PRODUCT §3.9.2 phase 2): proves the chosen provider can
  // actually authenticate and answer, so credential failures surface in setup instead of
  // forty minutes into a run. Never cached — a cache hit would prove nothing.
  'preflight'
] as const;
export type KnownAgentTaskKind = (typeof knownAgentTaskKinds)[number];

// THE ROLE A TASK PLAYS. Roles are the ROUTING unit for `agents.roles` in docstube.yml: every
// model task declares one, and a role can be pointed at a different transport/model than the run
// default — the lever that puts reviews and translations on a cheaper model without touching the
// writer. The set is closed and derived from the task kinds that actually exist; a new kind must
// join an existing role (or add one here) to be routable, so a role can never be configurable
// without being read.
export const agentRoleSchema = z.enum(['writer', 'reviewer', 'translator', 'architect', 'extractor']);
export type AgentRole = z.infer<typeof agentRoleSchema>;

// Every known kind, exhaustively — the Record type makes an unrouted new kind a compile error.
export const agentRoleByTaskKind: Record<KnownAgentTaskKind, AgentRole> = {
  'write-page': 'writer',
  'review-page': 'reviewer',
  'translate-page': 'translator',
  // Setup's IA proposal: structural, high-leverage, one call per project.
  'propose-ia': 'architect',
  // Cheap read-and-return-structured-data work: theme tokens, audit claim extraction, feedback
  // triage. Grouped so one override moves all of it onto an economy model.
  'categorize-feedback': 'extractor',
  'extract-theme-tokens': 'extractor',
  'audit-extract-claims': 'extractor',
  // The connectivity probe proves the run's PRIMARY routing answers, so it rides the writer role.
  preflight: 'writer'
};

// An unregistered kind (a plugin's, or one added without a mapping) routes as the WRITER — the run
// default — never silently onto the cheapest role.
export const agentRoleForTaskKind = (kind: string): AgentRole =>
  agentRoleByTaskKind[kind as KnownAgentTaskKind] ?? 'writer';

// Serializable tool descriptor; handlers live in the runtime and are matched by name.
export const toolDescriptorSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().min(1),
  paramsJsonSchema: z.record(z.string(), z.unknown())
});
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;

export const taskOutputSpecSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mdx') }),
  // The writer contract (ARCHITECTURE §8.1): MDX plus the writer claim ledger, delivered in ONE
  // task via the submit_page tool — the task result is the accepted submission, never final text.
  z.object({ type: z.literal('mdx-ledger') }),
  z.object({ type: z.literal('text') }),
  z.object({ type: z.literal('structured'), jsonSchema: z.record(z.string(), z.unknown()) })
]);
export type TaskOutputSpec = z.infer<typeof taskOutputSpecSchema>;

export const agentTaskSpecSchema = z.object({
  id: taskIdSchema,
  kind: agentTaskKindSchema,
  systemPrompt: z.string().min(1),
  userPrompt: z.string().min(1),
  tools: z.array(toolDescriptorSchema).default([]),
  workspace: z.object({
    readRoots: z.array(repoPathSchema).default(['.']),
    writableRoots: z.array(repoPathSchema).default([])
  }),
  budget: z.object({
    maxTurns: z.number().int().positive(),
    maxToolCalls: z.number().int().positive()
  }),
  output: taskOutputSpecSchema,
  modelHint: z.string().optional()
});
export type AgentTaskSpec = z.infer<typeof agentTaskSpecSchema>;

export const transcriptBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('tool-call'), toolCallId: z.string(), name: z.string(), args: z.unknown() }),
  z.object({
    type: z.literal('tool-result'),
    toolCallId: z.string(),
    result: z.unknown(),
    isError: z.boolean().default(false)
  })
]);
export type TranscriptBlock = z.infer<typeof transcriptBlockSchema>;

export const transcriptTurnSchema = z.object({
  role: z.enum(['assistant', 'tool']),
  blocks: z.array(transcriptBlockSchema)
});

export const taskStopReasonSchema = z.enum(['complete', 'max-turns', 'max-tool-calls', 'budget-frozen', 'error']);

export const taskUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().optional(),
  // Subscription plan usage (0-100) as reported by the vendor CLI at the time of this task
  // (codex rate_limits used_percent, max of the 5h and weekly windows). The plan-usage governor
  // freezes runs on this instead of estimated dollars when present.
  planUsedPercent: z.number().min(0).max(100).optional(),
  cacheHit: z.boolean().default(false)
});

export const taskResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mdx'), mdx: z.string() }),
  // The accepted submit_page artifact: markers validated against the ledger in-session.
  z.object({ type: z.literal('mdx-ledger'), mdx: z.string(), ledger: writerClaimLedgerSchema }),
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('structured'), value: z.unknown() })
]);
export type TaskResult = z.infer<typeof taskResultSchema>;

export const transcriptSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: taskIdSchema,
  cacheKey: z.string(),
  transport: z.string().min(1),
  model: z.string().min(1),
  turns: z.array(transcriptTurnSchema),
  // Derived by the harness from read-tool calls — provenance input (PRODUCT §3.5 stage 3).
  observedReads: z.array(observedReadSchema).default([]),
  usage: taskUsageSchema,
  stopReason: taskStopReasonSchema,
  result: taskResultSchema.optional(),
  error: z.string().optional()
});
export type Transcript = z.infer<typeof transcriptSchema>;

// Cache key covers everything that changes model behavior — never the minted task id.
export const computeTaskCacheKey = (
  spec: AgentTaskSpec,
  context: { transport: string; model: string; contextHashes?: Record<string, string> | undefined }
): string => {
  const { id: _id, ...cacheable } = spec;
  return hashValue({
    spec: cacheable,
    transport: context.transport,
    model: context.model,
    contextHashes: context.contextHashes ?? {}
  });
};
