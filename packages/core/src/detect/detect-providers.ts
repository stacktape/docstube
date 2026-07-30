import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TransportId } from '@docstube/contracts';

// Provider detection for first-run setup (PRODUCT §3.9.2 phase 2, dx-knowledge-v2 decision 2).
// Deterministic and cheap — installed CLIs on PATH plus credential env-var NAMES. It never reads a
// credential value, only whether the named variable is set, and it never RANKS one subscription or
// API over another: exactly one viable candidate is preselected, several stay an explicit choice.
//
// Viability here means "the transport can be constructed and has something to authenticate with".
// Whether that credential actually works is what the preflight call answers — this module must not
// claim "logged in" for evidence it does not have.

const execFileAsync = promisify(execFile);

export type ProviderCandidate = {
  transport: TransportId;
  label: string;
  viable: boolean;
  // Shown verbatim next to the choice. Evidence, never a guess.
  reason: string;
  // Env var whose presence made this candidate viable (API transports only).
  apiKeyEnv?: string;
  // Pre-filled when the transport has a default model; otherwise setup must ask for one, because
  // createTransportFromConfig refuses to run without it.
  defaultModel?: string;
  requiresModel: boolean;
};

export type DetectProvidersInput = {
  env?: NodeJS.ProcessEnv;
  // Injected by tests so provider detection never shells out in CI.
  probeBinary?: (binary: string) => Promise<boolean>;
};

const binaryOnPath = async (binary: string): Promise<boolean> => {
  try {
    await execFileAsync(binary, ['--version'], { timeout: 10_000, shell: process.platform === 'win32' });
    return true;
  } catch {
    return false;
  }
};

const envSet = (env: NodeJS.ProcessEnv, name: string): boolean => {
  const value = env[name];
  return value !== undefined && value.trim().length > 0;
};

export const detectProviders = async (input: DetectProvidersInput = {}): Promise<ProviderCandidate[]> => {
  const env = input.env ?? process.env;
  const probe = input.probeBinary ?? binaryOnPath;
  const [claudeCli, codexCli] = await Promise.all([probe('claude'), probe('codex')]);

  const anthropicKey = envSet(env, 'ANTHROPIC_API_KEY');
  const openAiKey = envSet(env, 'OPENAI_API_KEY');

  return [
    {
      transport: 'claude-cli',
      label: 'Claude CLI',
      viable: claudeCli,
      reason: claudeCli ? 'installed on PATH — billed to your Claude subscription' : '`claude` not found on PATH',
      defaultModel: 'sonnet',
      requiresModel: false
    },
    {
      transport: 'codex-cli',
      label: 'Codex CLI',
      viable: codexCli,
      reason: codexCli ? 'installed on PATH — billed to your Codex plan' : '`codex` not found on PATH',
      requiresModel: true
    },
    {
      transport: 'anthropic-api',
      label: 'Anthropic API',
      viable: anthropicKey,
      reason: anthropicKey ? 'ANTHROPIC_API_KEY is set — billed per token' : 'ANTHROPIC_API_KEY is not set',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      defaultModel: 'claude-sonnet-5',
      requiresModel: false
    },
    {
      transport: 'openai-compatible',
      label: 'OpenAI-compatible API',
      viable: openAiKey,
      reason: openAiKey ? 'OPENAI_API_KEY is set — billed per token' : 'OPENAI_API_KEY is not set',
      apiKeyEnv: 'OPENAI_API_KEY',
      requiresModel: true
    }
  ];
};

// Exactly one viable provider → preselect it (with its reason visible). Several → undefined, and
// the user chooses; docstube never picks for them.
export const soleViableProvider = (candidates: readonly ProviderCandidate[]): ProviderCandidate | undefined => {
  const viable = candidates.filter((candidate) => candidate.viable);
  return viable.length === 1 ? viable[0] : undefined;
};
