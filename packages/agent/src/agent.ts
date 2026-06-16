import { spawn } from 'node:child_process';
import { isAbsolute, resolve, sep } from 'node:path';
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

export type AdapterProcessRequest = {
  command: string;
  args: string[];
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type AdapterProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export type AdapterProcessRunner = (request: AdapterProcessRequest) => Promise<AdapterProcessResult>;

export type AgentAdapterErrorCode = 'guard_failed' | 'process_failed' | 'rate_limited' | 'timeout';

export class AgentAdapterExecutionError extends Error {
  readonly code: AgentAdapterErrorCode;

  constructor(code: AgentAdapterErrorCode, message: string) {
    super(message);
    this.name = 'AgentAdapterExecutionError';
    this.code = code;
  }
}

export const runAdapterProcess: AdapterProcessRunner = (request) =>
  new Promise((resolveProcess, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env ? { ...process.env, ...request.env } : process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timeout =
      request.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 500).unref();
          }, request.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolveProcess({ stdout, stderr, exitCode, timedOut });
    });

    if (request.input !== undefined) {
      child.stdin.end(request.input);
    } else {
      child.stdin.end();
    }
  });

export const parseCliVersionOutput = (output: string): Semver | null => {
  const match = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/u.exec(output);
  return match ? semverSchema.parse(match[1]) : null;
};

export const detectCliVersion = async (
  command: string,
  args: readonly string[],
  runner: AdapterProcessRunner = runAdapterProcess
): Promise<Semver | null> => {
  const result = await runner({ command, args: [...args], timeoutMs: 5000 });
  return parseCliVersionOutput(`${result.stdout}\n${result.stderr}`);
};

export const isRateLimitOutput = (output: string): boolean =>
  /\b(429|rate limit|quota exceeded|too many requests)\b/iu.test(output);

export type UsageEstimateInput = {
  inputTokens: number;
  outputTokens: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export type UsageEstimate = UsageEstimateInput & {
  estimatedUsd: number;
};

export const estimateUsage = (input: UsageEstimateInput): UsageEstimate => ({
  ...input,
  estimatedUsd:
    (input.inputTokens / 1_000_000) * input.inputUsdPerMillion +
    (input.outputTokens / 1_000_000) * input.outputUsdPerMillion
});

export type UsageCaps = {
  maxUsd?: number;
  maxTokens?: number;
};

export const usageExceedsCaps = (usage: UsageEstimate, caps: UsageCaps): boolean =>
  (caps.maxUsd !== undefined && usage.estimatedUsd > caps.maxUsd) ||
  (caps.maxTokens !== undefined && usage.inputTokens + usage.outputTokens > caps.maxTokens);

const normalizeRoot = (path: string): string => {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const isInsideRoot = (target: string, root: string): boolean => {
  const normalizedTarget = normalizeRoot(target);
  const normalizedRoot = normalizeRoot(root);
  const rootWithSeparator = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootWithSeparator);
};

export type PostRunGuardInput = {
  repoRoot: string;
  writableRoots: readonly string[];
  changedPaths: readonly string[];
};

export const assertChangesWithinWritableRoots = (input: PostRunGuardInput): void => {
  const outside = input.changedPaths.filter((changedPath) => {
    const absolutePath = isAbsolute(changedPath) ? changedPath : resolve(input.repoRoot, changedPath);
    return !input.writableRoots.some((root) => isInsideRoot(absolutePath, root));
  });

  if (outside.length > 0) {
    throw new AgentAdapterExecutionError(
      'guard_failed',
      `agent changed files outside writable roots: ${outside.join(', ')}`
    );
  }
};

const eventTimestamp = '2026-06-16T00:00:00.000Z';

const messageText = (value: Record<string, unknown>): string | null => {
  for (const key of ['text', 'content', 'message', 'delta']) {
    const candidate = value[key];
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return null;
};

const eventKind = (value: Record<string, unknown>): string =>
  String(value.type ?? value.event ?? value.kind ?? '').toLowerCase();

export const parseAdapterJsonEvents = (
  output: string,
  options: { adapterId: string; adapterVersion: Semver; model: string; sandbox: AgentSandbox; timestamp?: Timestamp }
): AgentEvent[] => {
  const timestamp = options.timestamp ?? eventTimestamp;
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  const rawEvents =
    trimmed.startsWith('{') && !trimmed.includes('\n')
      ? [JSON.parse(trimmed)]
      : trimmed.split(/\r?\n/u).map((line) => JSON.parse(line));
  const events: AgentEvent[] = [];

  for (const rawEvent of rawEvents) {
    if (!rawEvent || typeof rawEvent !== 'object') {
      continue;
    }

    const record = rawEvent as Record<string, unknown>;
    const kind = eventKind(record);
    const sequence = events.length;

    if (kind.includes('start')) {
      events.push({
        type: 'run-started',
        sequence,
        timestamp,
        adapterId: options.adapterId,
        adapterVersion: options.adapterVersion,
        model: options.model,
        sandbox: options.sandbox
      });
      continue;
    }

    const path = typeof record.path === 'string' ? record.path : undefined;
    if ((kind.includes('artifact') || kind.includes('file')) && path) {
      events.push({
        type: 'artifact-written',
        sequence,
        timestamp,
        path: relativePathSchema.parse(path),
        bytes: typeof record.bytes === 'number' ? record.bytes : 0
      });
      continue;
    }

    if (kind.includes('complete') || kind.includes('result') || kind === 'done') {
      events.push({ type: 'run-completed', sequence, timestamp, exitCode: 0 });
      continue;
    }

    if (kind.includes('error') || kind.includes('fail')) {
      events.push({
        type: 'run-failed',
        sequence,
        timestamp,
        error: messageText(record) ?? 'adapter reported failure'
      });
      continue;
    }

    const text = messageText(record);
    if (text !== null) {
      events.push({ type: 'message', sequence, timestamp, role: 'assistant', text });
    }
  }

  return events;
};

const ensureBoundaryEvents = (
  events: AgentEvent[],
  input: AgentRunInput,
  options: { adapterId: string; adapterVersion: Semver; startedAt: Timestamp; completedAt: Timestamp; exitCode: number }
): AgentEvent[] => {
  const normalized = [...events];
  if (!normalized.some((event) => event.type === 'run-started')) {
    normalized.unshift({
      type: 'run-started',
      sequence: 0,
      timestamp: options.startedAt,
      adapterId: options.adapterId,
      adapterVersion: options.adapterVersion,
      model: input.model,
      sandbox: input.sandbox
    });
  }
  if (!normalized.some((event) => event.type === 'run-completed' || event.type === 'run-failed')) {
    normalized.push({
      type: 'run-completed',
      sequence: normalized.length,
      timestamp: options.completedAt,
      exitCode: options.exitCode
    });
  }
  return normalized.map((event, sequence) => ({ ...event, sequence }));
};

export type CliAdapterDefinition = {
  id: BuiltInAgentId;
  version: Semver;
  buildRequest: (input: AgentRunInput) => AdapterProcessRequest;
  runner?: AdapterProcessRunner;
  now?: () => Timestamp;
  listChangedPaths?: () => Promise<string[]> | string[];
  repoRoot?: string;
};

export const createCliAgentAdapter = (definition: CliAdapterDefinition): AgentAdapter => {
  const runner = definition.runner ?? runAdapterProcess;
  const now = definition.now ?? (() => new Date().toISOString());

  return {
    id: definition.id,
    version: definition.version,
    async run(input) {
      const parsedInput = agentRunInputSchema.parse(input);
      const startedAt = now();
      const request = definition.buildRequest(parsedInput);
      const processResult = await runner(request);
      const completedAt = now();
      const output = `${processResult.stdout}\n${processResult.stderr}`;

      if (processResult.timedOut) {
        throw new AgentAdapterExecutionError('timeout', `${definition.id} adapter timed out`);
      }
      if (isRateLimitOutput(output)) {
        throw new AgentAdapterExecutionError('rate_limited', `${definition.id} adapter was rate limited`);
      }
      if (processResult.exitCode !== 0) {
        throw new AgentAdapterExecutionError(
          'process_failed',
          `${definition.id} exited with ${processResult.exitCode}`
        );
      }

      const changedPaths = await definition.listChangedPaths?.();
      if (changedPaths && definition.repoRoot) {
        assertChangesWithinWritableRoots({
          repoRoot: definition.repoRoot,
          writableRoots: parsedInput.sandbox.writableRoots,
          changedPaths
        });
      }

      const events = ensureBoundaryEvents(
        parseAdapterJsonEvents(processResult.stdout, {
          adapterId: definition.id,
          adapterVersion: definition.version,
          model: parsedInput.model,
          sandbox: parsedInput.sandbox,
          timestamp: startedAt
        }),
        parsedInput,
        {
          adapterId: definition.id,
          adapterVersion: definition.version,
          startedAt,
          completedAt,
          exitCode: processResult.exitCode ?? 0
        }
      );

      return agentRunResultSchema.parse({
        adapterId: definition.id,
        adapterVersion: definition.version,
        status: 'completed',
        startedAt,
        completedAt,
        events,
        output: processResult.stdout
      });
    }
  };
};

const adapterCwd = (input: AgentRunInput): string =>
  input.sandbox.readOnlyRoots[0] ?? input.sandbox.writableRoots[0] ?? process.cwd();

export const buildCodexCliRequest = (input: AgentRunInput): AdapterProcessRequest => {
  const cwd = adapterCwd(input);
  const args = [
    'exec',
    '--json',
    '--sandbox',
    input.sandbox.writableRoots.length > 0 ? 'workspace-write' : 'read-only',
    '--ask-for-approval',
    'never',
    '--cd',
    cwd,
    '-'
  ];
  if (input.model !== 'default') {
    args.splice(2, 0, '--model', input.model);
  }
  for (const root of input.sandbox.writableRoots.slice(1)) {
    args.push('--add-dir', root);
  }
  return { command: 'codex', args, cwd, input: input.prompt, timeoutMs: 20 * 60_000 };
};

export const buildClaudeCliRequest = (input: AgentRunInput): AdapterProcessRequest => {
  const cwd = adapterCwd(input);
  const args = ['-p', '--input-format', 'text', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits'];
  if (input.model !== 'default') {
    args.push('--model', input.model);
  }
  if (input.sandbox.shell === 'none') {
    args.push('--disallowedTools', 'Bash');
  }
  for (const root of input.sandbox.writableRoots) {
    args.push('--add-dir', root);
  }
  return { command: 'claude', args, cwd, input: input.prompt, timeoutMs: 20 * 60_000 };
};

export const buildGeminiCliRequest = (input: AgentRunInput): AdapterProcessRequest => ({
  command: 'gemini',
  args:
    input.model === 'default'
      ? ['-p', input.prompt, '--output-format', 'stream-json']
      : ['-p', input.prompt, '--output-format', 'stream-json', '--model', input.model],
  cwd: adapterCwd(input),
  timeoutMs: 20 * 60_000
});

export const createCodexAdapter = (options: Omit<CliAdapterDefinition, 'buildRequest' | 'id'>): AgentAdapter =>
  createCliAgentAdapter({ ...options, id: 'codex', buildRequest: buildCodexCliRequest });

export const createClaudeAdapter = (options: Omit<CliAdapterDefinition, 'buildRequest' | 'id'>): AgentAdapter =>
  createCliAgentAdapter({ ...options, id: 'claude', buildRequest: buildClaudeCliRequest });

export const createGeminiAdapter = (options: Omit<CliAdapterDefinition, 'buildRequest' | 'id'>): AgentAdapter =>
  createCliAgentAdapter({ ...options, id: 'gemini', buildRequest: buildGeminiCliRequest });

export type DirectApiProvider = 'anthropic' | 'openai';

export type DirectApiAdapterOptions = {
  provider: DirectApiProvider;
  baseUrl?: string;
  apiKey: string;
  version?: Semver;
  fetchJson?: (
    url: string,
    init: { body: string; headers: Record<string, string>; method: 'POST' }
  ) => Promise<JsonValue>;
  now?: () => Timestamp;
};

export const buildDirectApiRequest = (
  provider: DirectApiProvider,
  input: AgentRunInput,
  options: Pick<DirectApiAdapterOptions, 'apiKey' | 'baseUrl'>
) => {
  if (provider === 'openai') {
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.apiKey}`,
      'content-type': 'application/json'
    };
    return {
      url: `${options.baseUrl ?? 'https://api.openai.com/v1'}/responses`,
      headers,
      body: JSON.stringify({ model: input.model, input: input.prompt })
    };
  }

  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
    'x-api-key': options.apiKey
  };
  return {
    url: `${options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
    headers,
    body: JSON.stringify({ model: input.model, max_tokens: 4096, messages: [{ role: 'user', content: input.prompt }] })
  };
};

export const createDirectApiAdapter = (options: DirectApiAdapterOptions): AgentAdapter => {
  const version = options.version ?? '0.0.0';
  const now = options.now ?? (() => new Date().toISOString());
  const fetchJson =
    options.fetchJson ??
    (async (url, init) => {
      const response = await fetch(url, init);
      if (!response.ok) {
        throw new AgentAdapterExecutionError(
          response.status === 429 ? 'rate_limited' : 'process_failed',
          `API request failed: ${response.status}`
        );
      }
      return (await response.json()) as JsonValue;
    });

  return {
    id: 'api',
    version,
    async run(input) {
      const parsedInput = agentRunInputSchema.parse(input);
      const startedAt = now();
      const request = buildDirectApiRequest(options.provider, parsedInput, options);
      const output = await fetchJson(request.url, { method: 'POST', headers: request.headers, body: request.body });
      const completedAt = now();
      return agentRunResultSchema.parse({
        adapterId: 'api',
        adapterVersion: version,
        status: 'completed',
        startedAt,
        completedAt,
        events: ensureBoundaryEvents([], parsedInput, {
          adapterId: 'api',
          adapterVersion: version,
          startedAt,
          completedAt,
          exitCode: 0
        }),
        output
      });
    }
  };
};
