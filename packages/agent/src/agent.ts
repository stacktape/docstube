import { z } from 'zod';
import {
  identifierSchema,
  jsonValueSchema,
  relativePathSchema,
  semverSchema,
  timestampSchema
} from '@docstube/contracts';
import type { JsonValue, RelativePath, Semver, Timestamp } from '@docstube/contracts';

export const builtInAgentIds = ['api', 'claude', 'codex', 'gemini'] as const;

export const builtInAgentIdSchema = z.enum(builtInAgentIds);

export type BuiltInAgentId = z.infer<typeof builtInAgentIdSchema>;

export const agentSandboxShellModes = ['none', 'declared'] as const;

export const agentSandboxShellModeSchema = z.enum(agentSandboxShellModes);

export type AgentSandboxShellMode = z.infer<typeof agentSandboxShellModeSchema>;

export const agentSandboxSchema = z.strictObject({
  readOnlyRoots: z.array(z.string().min(1)).default([]),
  writableRoots: z.array(z.string().min(1)).default([]),
  allowNetwork: z.boolean().default(false),
  shell: agentSandboxShellModeSchema.default('none')
});

export type AgentSandbox = z.infer<typeof agentSandboxSchema>;

export const agentRunInputSchema = z.strictObject({
  taskId: identifierSchema,
  prompt: z.string().min(1),
  model: z.string().min(1),
  sandbox: agentSandboxSchema,
  metadata: z.record(z.string(), jsonValueSchema).optional()
});

export type AgentRunInput = z.infer<typeof agentRunInputSchema>;

export const agentTextArtifactSchema = z.strictObject({
  path: relativePathSchema,
  content: z.string(),
  encoding: z.literal('utf8').default('utf8')
});

export type AgentTextArtifact = z.infer<typeof agentTextArtifactSchema>;

const agentEventBaseSchema = z.strictObject({
  sequence: z.int().nonnegative(),
  timestamp: timestampSchema
});

export const agentEventSchema = z.discriminatedUnion('type', [
  agentEventBaseSchema.extend({
    type: z.literal('run-started'),
    adapterId: z.string().min(1),
    adapterVersion: semverSchema,
    model: z.string().min(1),
    sandbox: agentSandboxSchema
  }),
  agentEventBaseSchema.extend({
    type: z.literal('message'),
    role: z.enum(['adapter', 'assistant', 'system']),
    text: z.string()
  }),
  agentEventBaseSchema.extend({
    type: z.literal('artifact-written'),
    path: relativePathSchema,
    bytes: z.int().nonnegative()
  }),
  agentEventBaseSchema.extend({
    type: z.literal('run-completed'),
    exitCode: z.int().nonnegative().default(0)
  }),
  agentEventBaseSchema.extend({
    type: z.literal('run-failed'),
    error: z.string().min(1)
  })
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;

const agentRunResultBaseSchema = z.strictObject({
  adapterId: z.string().min(1),
  adapterVersion: semverSchema,
  startedAt: timestampSchema,
  completedAt: timestampSchema,
  events: z.array(agentEventSchema).min(1),
  artifacts: z.array(agentTextArtifactSchema).default([]),
  output: jsonValueSchema.optional()
});

export const agentRunResultSchema = z.discriminatedUnion('status', [
  agentRunResultBaseSchema.extend({
    status: z.literal('completed')
  }),
  agentRunResultBaseSchema.extend({
    status: z.literal('failed'),
    error: z.string().min(1)
  })
]);

export type AgentRunResult = z.infer<typeof agentRunResultSchema>;

export const agentReplayFixtureSchema = z.strictObject({
  version: z.literal(1),
  name: identifierSchema,
  recordedAt: timestampSchema,
  input: agentRunInputSchema,
  result: agentRunResultSchema
});

export type AgentReplayFixture = z.infer<typeof agentReplayFixtureSchema>;

export type AgentAdapter = {
  id: BuiltInAgentId | string;
  version: Semver;
  run: (input: AgentRunInput) => Promise<AgentRunResult>;
};

export class AgentReplayMismatchError extends Error {
  readonly expected: AgentRunInput;
  readonly received: AgentRunInput;

  constructor(expected: AgentRunInput, received: AgentRunInput) {
    super('agent replay input does not match the recorded fixture');
    this.name = 'AgentReplayMismatchError';
    this.expected = expected;
    this.received = received;
  }
}

export type MockAgentAdapterOptions = {
  id?: string;
  version?: Semver;
  now?: () => Timestamp;
  artifacts?: AgentTextArtifact[];
  output?: JsonValue;
};

const stableTimestamp = '2026-06-16T00:00:00.000Z';

const makeCompletedEvents = (
  input: AgentRunInput,
  options: Required<Pick<MockAgentAdapterOptions, 'id' | 'version' | 'now'>>
) => {
  const timestamp = options.now();
  return [
    {
      type: 'run-started',
      sequence: 0,
      timestamp,
      adapterId: options.id,
      adapterVersion: options.version,
      model: input.model,
      sandbox: input.sandbox
    },
    {
      type: 'message',
      sequence: 1,
      timestamp,
      role: 'adapter',
      text: 'mock adapter replayed deterministic output'
    },
    {
      type: 'run-completed',
      sequence: 2,
      timestamp,
      exitCode: 0
    }
  ] satisfies AgentEvent[];
};

export const createMockAgentAdapter = (options: MockAgentAdapterOptions = {}): AgentAdapter => {
  const id = options.id ?? 'mock';
  const version = options.version ?? '0.0.0';
  const now = options.now ?? (() => stableTimestamp);
  const artifacts = options.artifacts ?? [];

  return {
    id,
    version,
    async run(input) {
      const parsedInput = agentRunInputSchema.parse(input);
      return agentRunResultSchema.parse({
        adapterId: id,
        adapterVersion: version,
        status: 'completed',
        startedAt: now(),
        completedAt: now(),
        events: makeCompletedEvents(parsedInput, { id, version, now }),
        artifacts,
        output: options.output
      });
    }
  };
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
  }

  return JSON.stringify(value);
};

export const createReplayAgentAdapter = (fixture: AgentReplayFixture | unknown): AgentAdapter => {
  const parsed = agentReplayFixtureSchema.parse(fixture);

  return {
    id: parsed.result.adapterId,
    version: parsed.result.adapterVersion,
    async run(input) {
      const parsedInput = agentRunInputSchema.parse(input);
      if (canonicalJson(parsedInput) !== canonicalJson(parsed.input)) {
        throw new AgentReplayMismatchError(parsed.input, parsedInput);
      }
      return parsed.result;
    }
  };
};

export const createAgentReplayFixture = (fixture: AgentReplayFixture): AgentReplayFixture =>
  agentReplayFixtureSchema.parse(fixture);

export const artifactPaths = (result: AgentRunResult): RelativePath[] =>
  result.artifacts.map((artifact) => artifact.path);
