import type { AgentRole, DocstubeConfig } from '@docstube/contracts';
import type { InternalTransportId, RoleRouting } from './agent-role-routing.ts';
import { resolveRoleRouting, resolveRunRoleRoutings, roleRoutingKey } from './agent-role-routing.ts';

// WHAT THE CONFIGURED TRANSPORTS ACTUALLY NEED, resolved from the parsed config — not guessed from
// the text of docstube.yml. Every requirement is derived from a RoleRouting, the same object the
// task runner constructs transports from, so the CI preflight can answer "will this authenticate?"
// without constructing a transport and without making a billable call.
//
// EVERY ROLE, NOT JUST THE DEFAULT (the role-routing wave): once `agents.roles` can send reviews or
// translations to a different provider, checking only the top-level transport would pass a run that
// dies on its first review. resolveRunCredentialRequirements walks all five roles and returns one
// requirement per DISTINCT provider+credential — a missing key for any of them is fatal preflight,
// never a mid-run surprise.
//
// A missing credential for a transport this run WILL use is fatal. An unrelated provider's key
// being absent is not — nothing in the run will ever read it.

export type TransportCredentialKind = 'vendor-cli' | 'api-key' | 'keyless';

export type TransportCredentialRequirement = {
  transportId: InternalTransportId;
  // The roles that route here. Reported so a failure names the role whose tasks would break.
  roles: AgentRole[];
  // Resolved exactly as the task runner resolves it; undefined when the transport requires an
  // explicit model and the config does not set one (the run would throw before any call).
  model?: string;
  kind: TransportCredentialKind;
  // Vendor-CLI transports: the executable that must be on PATH.
  binary?: string;
  // ANY ONE of these env vars being non-empty satisfies the credential requirement.
  credentialEnvVars: readonly string[];
  // The endpoint an API transport will call.
  endpoint?: string;
  // Loopback/private endpoints are the only place "no key" is legitimately correct.
  endpointIsPrivate?: boolean;
  // Set when the config cannot produce a working transport at all.
  configProblem?: string;
};

const anthropicDefaultBaseUrl = 'https://api.anthropic.com';
const openAiDefaultBaseUrl = 'https://api.openai.com/v1';

// Private per RFC1918/loopback, or an explicitly local hostname. A keyless endpoint here is an
// Ollama-style local server (PRODUCT §3.6); a keyless PUBLIC endpoint is a misconfiguration.
export const isPrivateEndpoint = (endpoint: string): boolean => {
  let host: string;
  try {
    host = new URL(endpoint).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return true;
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    return true;
  }
  return /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
};

// One routing → one requirement. Every credential fact comes off the routing, so a role that
// switched providers is checked against ITS provider's env var, never the top-level one.
export const credentialRequirementForRouting = (routing: RoleRouting): TransportCredentialRequirement => {
  const base: Pick<TransportCredentialRequirement, 'transportId' | 'roles' | 'model' | 'configProblem'> = {
    transportId: routing.transportId,
    roles: [routing.role],
    ...(routing.model === undefined ? {} : { model: routing.model }),
    ...(routing.configProblem === undefined ? {} : { configProblem: routing.configProblem })
  };

  switch (routing.transportId) {
    case 'claude-cli':
      return {
        ...base,
        kind: 'vendor-cli',
        binary: 'claude',
        // A headless runner cannot complete the interactive `claude login`, so an unattended run
        // authenticates through one of these.
        credentialEnvVars: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']
      };
    case 'codex-cli':
      return { ...base, kind: 'vendor-cli', binary: 'codex', credentialEnvVars: ['OPENAI_API_KEY'] };
    case 'google':
      return { ...base, kind: 'vendor-cli', binary: 'gemini', credentialEnvVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] };
    case 'anthropic-api':
      // The transport defaults apiKeyEnvVar to ANTHROPIC_API_KEY, so the key is always required.
      return {
        ...base,
        kind: 'api-key',
        credentialEnvVars: [routing.apiKeyEnv ?? 'ANTHROPIC_API_KEY'],
        endpoint: routing.baseUrl ?? anthropicDefaultBaseUrl
      };
    case 'openai-compatible': {
      const endpoint = routing.baseUrl ?? openAiDefaultBaseUrl;
      if (routing.apiKeyEnv === undefined) {
        // No apiKeyEnv means the transport sends NO authorization header — correct for a local
        // server, broken against a hosted API.
        return {
          ...base,
          kind: 'keyless',
          credentialEnvVars: [],
          endpoint,
          endpointIsPrivate: isPrivateEndpoint(endpoint)
        };
      }
      return { ...base, kind: 'api-key', credentialEnvVars: [routing.apiKeyEnv], endpoint };
    }
    case 'replay':
      return { ...base, kind: 'keyless', credentialEnvVars: [], endpointIsPrivate: true };
  }
};

// The PRIMARY requirement: what the writer role — and therefore the run banner and the setup
// preflight probe — will authenticate against.
export const resolveTransportCredentialRequirement = (
  config: DocstubeConfig,
  env: NodeJS.ProcessEnv = process.env
): TransportCredentialRequirement => credentialRequirementForRouting(resolveRoleRouting(config, 'writer', env));

// EVERY provider this run could touch, deduped, writer first. Roles sharing a provider collapse
// into one requirement listing all of them.
export const resolveRunCredentialRequirements = (
  config: DocstubeConfig,
  env: NodeJS.ProcessEnv = process.env
): TransportCredentialRequirement[] => {
  const byRouting = new Map<string, TransportCredentialRequirement>();
  for (const routing of resolveRunRoleRoutings(config, env)) {
    const key = roleRoutingKey(routing);
    const existing = byRouting.get(key);
    if (existing === undefined) {
      byRouting.set(key, credentialRequirementForRouting(routing));
      continue;
    }
    existing.roles.push(routing.role);
  }
  return [...byRouting.values()];
};

export const credentialEnvVarPresent = (
  requirement: TransportCredentialRequirement,
  env: NodeJS.ProcessEnv
): string | undefined => requirement.credentialEnvVars.find((name) => (env[name] ?? '').trim().length > 0);
