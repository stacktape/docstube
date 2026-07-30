import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Transport } from '@docstube/agent-runtime';
import {
  createAnthropicApiTransport,
  createClaudeCliTransport,
  createCodexCliTransport,
  createGoogleTransport,
  createOpenAiCompatibleTransport,
  createReplayTransport,
  createTranscriptCache,
  runAgentTask,
  standardToolDescriptors
} from '@docstube/agent-runtime';
import type { DocstubeConfig, ToolDescriptor } from '@docstube/contracts';
import { configError } from '../errors.ts';
import type { TaskRunner } from './generate.ts';

// Maps the config's `agents:` block onto an agent-runtime transport + model + cache — the one
// place transport wiring lives. Everything downstream sees only the TaskRunner function.

const resolveMcpServerPath = (): { path: string; nodeArgs: string[] } => {
  // Resolves next to the agent-runtime entry: src/mcp-stdio-server-bin.ts when running from
  // source (docstube-source condition), dist/mcp-stdio-server-bin.mjs in built form.
  const entry = fileURLToPath(import.meta.resolve('@docstube/agent-runtime'));
  const fromSource = entry.endsWith('.ts');
  const dir = join(entry, '..');
  return {
    path: join(dir, fromSource ? 'mcp-stdio-server-bin.ts' : 'mcp-stdio-server-bin.mjs'),
    nodeArgs: fromSource ? ['--conditions=docstube-source'] : []
  };
};

// The public config enum stops at four transports; 'google' (experimental, Antigravity CLI drops
// subprocess stdout) and 'replay' (record/replay test transport) stay reachable only through the
// DOCSTUBE_TRANSPORT_OVERRIDE env var — internal escape hatch, never a docstube.yml value.
export type InternalTransportId = DocstubeConfig['agents']['transport'] | 'google' | 'replay';

const internalTransportIds: readonly InternalTransportId[] = [
  'claude-cli',
  'codex-cli',
  'anthropic-api',
  'openai-compatible',
  'google',
  'replay'
];

export const resolveTransportId = (
  config: DocstubeConfig,
  env: NodeJS.ProcessEnv = process.env
): InternalTransportId => {
  const override = env.DOCSTUBE_TRANSPORT_OVERRIDE;
  if (override === undefined || override === '') {
    return config.agents.transport;
  }
  if (!internalTransportIds.includes(override as InternalTransportId)) {
    throw configError(
      `DOCSTUBE_TRANSPORT_OVERRIDE "${override}" is not a known transport (${internalTransportIds.join(', ')})`
    );
  }
  return override as InternalTransportId;
};

// Exported so the CI preflight can answer "will this config even construct a transport?" without
// constructing one — the two must never drift apart.
export const transportDefaultModels: Partial<Record<InternalTransportId, string>> = {
  'claude-cli': 'sonnet',
  'anthropic-api': 'claude-sonnet-5',
  replay: 'replay'
};

export const createTransportFromConfig = (
  config: DocstubeConfig,
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env
): { transport: Transport; model: string } => {
  const agents = config.agents;
  const transportId = resolveTransportId(config, env);
  const model = agents.model ?? transportDefaultModels[transportId];
  if (model === undefined) {
    throw configError(`agents.transport "${transportId}" requires an explicit agents.model in docstube.yml`);
  }
  switch (transportId) {
    case 'claude-cli': {
      const mcp = resolveMcpServerPath();
      return { transport: createClaudeCliTransport({ mcpServerPath: mcp.path, nodeArgs: mcp.nodeArgs }), model };
    }
    case 'codex-cli':
      return { transport: createCodexCliTransport(), model };
    case 'google':
      return { transport: createGoogleTransport(), model };
    case 'anthropic-api':
      return {
        transport: createAnthropicApiTransport({
          ...(agents.apiKeyEnv === undefined ? {} : { apiKeyEnvVar: agents.apiKeyEnv }),
          ...(agents.baseUrl === undefined ? {} : { baseUrl: agents.baseUrl })
        }),
        model
      };
    case 'openai-compatible':
      return {
        transport: createOpenAiCompatibleTransport({
          ...(agents.apiKeyEnv === undefined ? {} : { apiKeyEnvVar: agents.apiKeyEnv }),
          ...(agents.baseUrl === undefined ? {} : { baseUrl: agents.baseUrl })
        }),
        model
      };
    case 'replay':
      return { transport: createReplayTransport(join(repoRoot, '.docstube', 'fixtures', 'transcripts')), model };
  }
};

// Review tasks may run on a cheaper model (agents.reviewModel); every other kind uses the primary
// model. Exported so the routing rule itself is spec-testable.
export const taskModelFor = (input: { kind: string; model: string; reviewModel?: string | undefined }): string =>
  input.kind === 'review-page' ? (input.reviewModel ?? input.model) : input.model;

export type ConfiguredTaskRunner = {
  runTask: TaskRunner;
  toolDescriptors: ToolDescriptor[];
  transportId: string;
  model: string;
  // The model review-page tasks actually run on (equals `model` unless agents.reviewModel is set).
  reviewModel: string;
  // The exact per-kind routing runTask applies — cache keys and transcripts carry this model.
  modelForTaskKind: (kind: string) => string;
};

export const createTaskRunnerFromConfig = (
  config: DocstubeConfig,
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env
): ConfiguredTaskRunner => {
  const { transport, model } = createTransportFromConfig(config, repoRoot, env);
  const reviewModel = config.agents.reviewModel ?? model;
  const modelForTaskKind = (kind: string): string =>
    taskModelFor({ kind, model, reviewModel: config.agents.reviewModel });
  const cache = createTranscriptCache(join(repoRoot, '.docstube', 'cache', 'transcripts'));
  return {
    // extraTools reach the model natively on loop transports and via forwarded record-style MCP
    // tools on session transports (agent-runtime/src/transports/forwarded-tools.ts): the child
    // acks calls and the parent replays them through the real handlers post-session.
    // The model is resolved per task kind, so review tasks bill, cache, and transcribe under the
    // model they actually ran on.
    runTask: (spec, extraTools) =>
      runAgentTask(spec, {
        transport,
        model: modelForTaskKind(spec.kind),
        repoRoot,
        cache,
        ...(extraTools === undefined ? {} : { extraTools })
      }),
    toolDescriptors: standardToolDescriptors(),
    transportId: transport.id,
    model,
    reviewModel,
    modelForTaskKind
  };
};
