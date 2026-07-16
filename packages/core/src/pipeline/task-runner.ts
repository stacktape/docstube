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

const defaultModels: Partial<Record<DocstubeConfig['agents']['transport'], string>> = {
  'claude-cli': 'sonnet',
  'anthropic-api': 'claude-sonnet-5',
  replay: 'replay'
};

export const createTransportFromConfig = (
  config: DocstubeConfig,
  repoRoot: string
): { transport: Transport; model: string } => {
  const agents = config.agents;
  const model = agents.model ?? defaultModels[agents.transport];
  if (model === undefined) {
    throw configError(`agents.transport "${agents.transport}" requires an explicit agents.model in docstube.yml`);
  }
  switch (agents.transport) {
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

export type ConfiguredTaskRunner = {
  runTask: TaskRunner;
  toolDescriptors: ToolDescriptor[];
  transportId: string;
  model: string;
};

export const createTaskRunnerFromConfig = (config: DocstubeConfig, repoRoot: string): ConfiguredTaskRunner => {
  const { transport, model } = createTransportFromConfig(config, repoRoot);
  const cache = createTranscriptCache(join(repoRoot, '.docstube', 'cache', 'transcripts'));
  return {
    // extraTools reach the model natively on loop transports and via forwarded record-style MCP
    // tools on session transports (agent-runtime/src/transports/forwarded-tools.ts): the child
    // acks calls and the parent replays them through the real handlers post-session.
    runTask: (spec, extraTools) =>
      runAgentTask(spec, { transport, model, repoRoot, cache, ...(extraTools === undefined ? {} : { extraTools }) }),
    toolDescriptors: standardToolDescriptors(),
    transportId: transport.id,
    model
  };
};
