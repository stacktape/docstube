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
import type { AgentRole, DocstubeConfig, ToolDescriptor } from '@docstube/contracts';
import { agentRoleForTaskKind } from '@docstube/contracts';
import { configError } from '../errors.ts';
import type { RoleRouting } from './agent-role-routing.ts';
import { resolveRoleRouting, resolveRunRoleRoutings, roleRoutingKey } from './agent-role-routing.ts';
import type { TaskRunner } from './generate.ts';

// Maps a resolved RoleRouting onto an agent-runtime transport + model + cache — the one place
// transport CONSTRUCTION lives. What each role routes to is decided in agent-role-routing.ts and
// never re-derived here. Everything downstream sees only the TaskRunner function.

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

export const createTransportForRouting = (
  routing: RoleRouting,
  repoRoot: string
): { transport: Transport; model: string } => {
  if (routing.model === undefined) {
    throw configError(routing.configProblem ?? `agents.roles.${routing.role} resolved no model`);
  }
  const model = routing.model;
  const apiOptions = {
    ...(routing.apiKeyEnv === undefined ? {} : { apiKeyEnvVar: routing.apiKeyEnv }),
    ...(routing.baseUrl === undefined ? {} : { baseUrl: routing.baseUrl })
  };
  switch (routing.transportId) {
    case 'claude-cli': {
      const mcp = resolveMcpServerPath();
      return { transport: createClaudeCliTransport({ mcpServerPath: mcp.path, nodeArgs: mcp.nodeArgs }), model };
    }
    case 'codex-cli':
      return { transport: createCodexCliTransport(), model };
    case 'google':
      return { transport: createGoogleTransport(), model };
    case 'anthropic-api':
      return { transport: createAnthropicApiTransport(apiOptions), model };
    case 'openai-compatible':
      return { transport: createOpenAiCompatibleTransport(apiOptions), model };
    case 'replay':
      return { transport: createReplayTransport(join(repoRoot, '.docstube', 'fixtures', 'transcripts')), model };
  }
};

// The transport a single role would run on. Defaults to the writer — the run's primary routing,
// which is also what the setup preflight probes.
export const createTransportFromConfig = (
  config: DocstubeConfig,
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  role: AgentRole = 'writer'
): { transport: Transport; model: string } =>
  createTransportForRouting(resolveRoleRouting(config, role, env), repoRoot);

export type ConfiguredTaskRunner = {
  runTask: TaskRunner;
  toolDescriptors: ToolDescriptor[];
  // The WRITER routing — the run's primary, what CLI banners report.
  transportId: string;
  model: string;
  // Every role's resolved routing, in role order.
  routings: RoleRouting[];
  // The exact routing a task of this kind runs on — cache keys and transcripts carry its model.
  routingForTaskKind: (kind: string) => RoleRouting;
};

export const createTaskRunnerFromConfig = (
  config: DocstubeConfig,
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env
): ConfiguredTaskRunner => {
  const routings = resolveRunRoleRoutings(config, env);
  const routingByRole = new Map<AgentRole, RoleRouting>(routings.map((routing) => [routing.role, routing]));
  const routingForTaskKind = (kind: string): RoleRouting => {
    const role = agentRoleForTaskKind(kind);
    const routing = routingByRole.get(role);
    if (routing === undefined) {
      throw configError(`no routing resolved for agent role "${role}"`);
    }
    return routing;
  };

  // Roles that resolve to the same transport+model+credential share ONE transport instance; a role
  // that is never used never constructs one (and never throws for a model it does not need).
  const built = new Map<string, { transport: Transport; model: string }>();
  const transportForRouting = (routing: RoleRouting): { transport: Transport; model: string } => {
    const key = roleRoutingKey(routing);
    const existing = built.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created = createTransportForRouting(routing, repoRoot);
    built.set(key, created);
    return created;
  };

  // The writer routing is built EAGERLY: an unusable primary configuration must fail at wiring
  // time — before a run starts and a banner claims it is generating — exactly as it always has.
  const primary = transportForRouting(routingForTaskKind('write-page'));
  const cache = createTranscriptCache(join(repoRoot, '.docstube', 'cache', 'transcripts'));
  return {
    // extraTools reach the model natively on loop transports and via forwarded record-style MCP
    // tools on session transports (agent-runtime/src/transports/forwarded-tools.ts): the child
    // acks calls and the parent replays them through the real handlers post-session.
    // Transport AND model are resolved per role, so a role override bills, caches, and transcribes
    // under the provider it actually ran on.
    runTask: (spec, extraTools) => {
      const { transport, model } = transportForRouting(routingForTaskKind(spec.kind));
      return runAgentTask(spec, {
        transport,
        model,
        repoRoot,
        cache,
        ...(extraTools === undefined ? {} : { extraTools })
      });
    },
    toolDescriptors: standardToolDescriptors(),
    transportId: primary.transport.id,
    model: primary.model,
    routings,
    routingForTaskKind
  };
};
