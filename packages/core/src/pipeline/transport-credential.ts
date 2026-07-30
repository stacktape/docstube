import type { DocstubeConfig } from '@docstube/contracts';
import { resolveTransportId, transportDefaultModels } from './task-runner.ts';
import type { InternalTransportId } from './task-runner.ts';

// WHAT THE CONFIGURED TRANSPORT ACTUALLY NEEDS, resolved from the parsed config — not guessed from
// the text of docstube.yml. This mirrors createTransportFromConfig exactly (same transport id,
// same model fallback, same apiKeyEnv/baseUrl defaults), so the CI preflight can answer "will this
// authenticate?" without constructing a transport and without making a billable call.
//
// A missing credential for the CONFIGURED transport is fatal. An unrelated provider's key being
// absent is not — nothing in the run will ever read it.

export type TransportCredentialKind = 'vendor-cli' | 'api-key' | 'keyless';

export type TransportCredentialRequirement = {
  transportId: InternalTransportId;
  // Resolved exactly as the task runner resolves it; undefined when the transport requires an
  // explicit agents.model and the config does not set one (the run would throw before any call).
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

export const resolveTransportCredentialRequirement = (
  config: DocstubeConfig,
  env: NodeJS.ProcessEnv = process.env
): TransportCredentialRequirement => {
  const agents = config.agents;
  const transportId = resolveTransportId(config, env);
  const model = agents.model ?? transportDefaultModels[transportId];
  const base: { transportId: InternalTransportId; model?: string; configProblem?: string } = {
    transportId,
    ...(model === undefined
      ? {
          configProblem: `agents.transport "${transportId}" has no default model, so docstube.yml must set agents.model`
        }
      : { model })
  };

  switch (transportId) {
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
        credentialEnvVars: [agents.apiKeyEnv ?? 'ANTHROPIC_API_KEY'],
        endpoint: agents.baseUrl ?? anthropicDefaultBaseUrl
      };
    case 'openai-compatible': {
      const endpoint = agents.baseUrl ?? openAiDefaultBaseUrl;
      if (agents.apiKeyEnv === undefined) {
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
      return { ...base, kind: 'api-key', credentialEnvVars: [agents.apiKeyEnv], endpoint };
    }
    case 'replay':
      return { ...base, kind: 'keyless', credentialEnvVars: [], endpointIsPrivate: true };
  }
};

export const credentialEnvVarPresent = (
  requirement: TransportCredentialRequirement,
  env: NodeJS.ProcessEnv
): string | undefined => requirement.credentialEnvVars.find((name) => (env[name] ?? '').trim().length > 0);
