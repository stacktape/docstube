import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRateLimitSignal, TransportError } from '../errors.ts';
import { mcpServerEnvVars } from '../mcp-stdio-server.ts';
import { runSubprocess } from '../subprocess.ts';
import type { SubprocessRunner } from '../subprocess.ts';
import type { SessionOutcome, SessionTransport, SessionTurn, TokenUsage } from '../transport.ts';
import { readObservedReadsSink, resolveDefaultMcpServer } from './mcp-session-helpers.ts';
import { prepareForwardedTools } from './forwarded-tools.ts';

// SessionTransport over gemini-cli in API-key mode (knowledge/design/agent-transports.md founder
// decision: personal-OAuth billing died 2026-06-18; Antigravity `agy` stays out until its headless
// surface is documentable). Flags and shapes re-verified 2026-07-13 from
// github.com/google-gemini/gemini-cli@main:
// - docs/cli/cli-reference.md: `-p/--prompt` forces non-interactive mode, `--output-format
//   stream-json`, `-m/--model`, `--skip-trust`.
// - docs/cli/headless.md: exit codes 0 success / 1 error / 42 input error / 53 turn limit.
// - packages/core/src/output/types.ts + packages/cli/src/nonInteractiveCli.ts: stream-json JSONL
//   events init / message (assistant content always arrives as delta chunks; no consolidated
//   message event) / tool_use / tool_result / error / result.
// - docs/tools/mcp-server.md: `mcpServers.<name>` with command/args/env, `trust: true` bypasses
//   tool confirmations, settings read from `<HOME>/.gemini/settings.json` and
//   `<cwd>/.gemini/settings.json`.
// - packages/cli/src/config/settingsSchema.ts + config.ts registerCoreTool: `tools.core` is a
//   built-in tool allowlist; an empty array disables every built-in tool (isEnabled =
//   coreTools.some(...) over []).
// - docs/cli/system-prompt.md: GEMINI_SYSTEM_MD=<file> fully replaces the built-in system prompt.
// - `model.maxSessionTurns` (settings) carries the turn budget; there is no CLI flag for it.
//
// Isolation: the process runs with cwd = a fresh scratch dir and HOME/USERPROFILE pointed at it,
// so the user's real ~/.gemini (settings, extensions, GEMINI.md) never leaks into a docs run.
// os.homedir() honors HOME (POSIX) and USERPROFILE (Windows), so user+workspace settings both
// resolve to the settings file this transport writes. Auth is GEMINI_API_KEY passthrough from the
// parent environment (settings pin security.auth.selectedType to "gemini-api-key").
//
// Assumed (needs one live smoke test): that tool confirmations never block a trusted-server
// headless run, and that `tools.core: []` plus MCP trust is sufficient with no interactive
// auth prompt when GEMINI_API_KEY is set.

const MCP_SERVER_NAME = 'docstube';
const DEFAULT_TIMEOUT_MS = 20 * 60_000;
const TURN_LIMIT_EXIT_CODE = 53;
const MAX_TURNS_MESSAGE = 'Maximum session turns exceeded';

export type GeminiCliArgsInput = {
  prompt: string;
  model: string;
};

export const buildGeminiCliArgs = (input: GeminiCliArgsInput): string[] => [
  '-p',
  input.prompt,
  '--output-format',
  'stream-json',
  '--model',
  input.model,
  '--skip-trust'
];

export type GeminiSettingsInput = {
  serverPath: string;
  command?: string;
  nodeArgs?: string[];
  env?: Record<string, string>;
  maxTurns: number;
};

// The whole settings surface this transport relies on, written to <scratch>/.gemini/settings.json.
export const buildGeminiSettings = (input: GeminiSettingsInput): Record<string, unknown> => ({
  general: { enableAutoUpdate: false, enableNotifications: false },
  security: { auth: { selectedType: 'gemini-api-key' }, folderTrust: { enabled: false } },
  model: { maxSessionTurns: input.maxTurns },
  // Empty allowlist: every built-in tool (shell, edit, web, ...) is disabled; only MCP tools remain.
  tools: { core: [] },
  mcpServers: {
    [MCP_SERVER_NAME]: {
      command: input.command ?? 'node',
      args: [...(input.nodeArgs ?? []), input.serverPath],
      env: input.env ?? {},
      trust: true
    }
  }
});

// MCP tools can surface as "<server>__<tool>" when gemini-cli prefixes to disambiguate; transcripts
// keep the harness-canonical tool names so provenance and replay are transport-independent.
const normalizeToolName = (name: string): string =>
  name.startsWith(`${MCP_SERVER_NAME}__`) ? name.slice(MCP_SERVER_NAME.length + 2) : name;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export type GeminiStreamParseResult = {
  turns: SessionTurn[];
  finalText?: string;
  usage: TokenUsage;
  stopReason: 'complete' | 'max-turns' | 'error';
  errorMessage?: string;
};

// Maps the stream-json JSONL events. Assistant text always arrives as `message` delta chunks, so
// contiguous chunks are accumulated and flushed into one assistant turn whenever a tool call (or
// the end of the stream) interrupts them. Unknown event types are ignored, never fatal.
export const parseGeminiStreamEvents = (lines: readonly string[]): GeminiStreamParseResult => {
  const turns: SessionTurn[] = [];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let pendingText = '';
  let finalText: string | undefined;
  let sawResult = false;
  let maxTurnsHit = false;
  let errorMessage: string | undefined;

  const flushText = () => {
    if (pendingText.length > 0) {
      turns.push({ role: 'assistant', blocks: [{ type: 'text', text: pendingText }] });
      finalText = pendingText;
      pendingText = '';
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(event) || typeof event.type !== 'string') {
      continue;
    }

    if (event.type === 'message') {
      if (event.role === 'assistant' && typeof event.content === 'string') {
        pendingText += event.content;
      }
      continue;
    }

    if (event.type === 'tool_use' && typeof event.tool_id === 'string' && typeof event.tool_name === 'string') {
      flushText();
      turns.push({
        role: 'assistant',
        blocks: [
          {
            type: 'tool-call',
            toolCallId: event.tool_id,
            name: normalizeToolName(event.tool_name),
            args: event.parameters
          }
        ]
      });
      continue;
    }

    if (event.type === 'tool_result' && typeof event.tool_id === 'string') {
      const isError = event.status === 'error';
      const result =
        isError && isRecord(event.error) && typeof event.error.message === 'string'
          ? event.error.message
          : event.output;
      turns.push({
        role: 'tool',
        blocks: [{ type: 'tool-result', toolCallId: event.tool_id, result, isError }]
      });
      continue;
    }

    if (event.type === 'error') {
      const message = typeof event.message === 'string' ? event.message : 'gemini CLI reported an error';
      if (message.includes(MAX_TURNS_MESSAGE)) {
        maxTurnsHit = true;
      } else if (event.severity === 'error') {
        errorMessage = message;
      }
      continue;
    }

    if (event.type === 'result') {
      sawResult = true;
      if (isRecord(event.stats)) {
        usage = {
          inputTokens: typeof event.stats.input_tokens === 'number' ? event.stats.input_tokens : 0,
          outputTokens: typeof event.stats.output_tokens === 'number' ? event.stats.output_tokens : 0
        };
      }
      if (event.status !== 'success') {
        errorMessage =
          errorMessage ??
          (isRecord(event.error) && typeof event.error.message === 'string'
            ? event.error.message
            : 'gemini CLI reported a failed run');
      }
    }
  }

  flushText();
  if (maxTurnsHit) {
    return { turns, finalText, usage, stopReason: 'max-turns' };
  }
  if (errorMessage !== undefined) {
    return { turns, finalText, usage, stopReason: 'error', errorMessage };
  }
  if (!sawResult) {
    return { turns, finalText, usage, stopReason: 'error', errorMessage: 'gemini CLI produced no result event' };
  }
  return { turns, finalText, usage, stopReason: 'complete' };
};

// Writes the isolated gemini workspace: settings.json wiring our MCP server and system.md carrying
// the full system-prompt replacement. Returns the system.md path for GEMINI_SYSTEM_MD.
export const writeGeminiWorkspace = async (input: {
  dir: string;
  settings: Record<string, unknown>;
  systemPrompt: string;
}): Promise<{ systemMdPath: string; settingsPath: string }> => {
  const geminiDir = join(input.dir, '.gemini');
  await mkdir(geminiDir, { recursive: true });
  const settingsPath = join(geminiDir, 'settings.json');
  const systemMdPath = join(geminiDir, 'system.md');
  await writeFile(settingsPath, `${JSON.stringify(input.settings, null, 2)}\n`, 'utf8');
  await writeFile(systemMdPath, input.systemPrompt, 'utf8');
  return { systemMdPath, settingsPath };
};

export type GoogleTransportOptions = {
  // Path to the MCP stdio server entry (src/mcp-stdio-server-bin.ts in dev, dist/mcp-stdio-server-bin.mjs built).
  mcpServerPath?: string;
  executable?: string;
  nodeCommand?: string;
  // e.g. ['--conditions=docstube-source'] when running the server from TypeScript source.
  nodeArgs?: string[];
  timeoutMs?: number;
  runner?: SubprocessRunner;
  env?: Record<string, string>;
};

export const createGoogleTransport = (options: GoogleTransportOptions = {}): SessionTransport => {
  const executable = options.executable ?? 'gemini';
  const runner = options.runner ?? runSubprocess;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    mode: 'session',
    id: 'google',
    capabilities: { toolInjection: 'mcp', structuredOutput: false },
    runSession: async (input, hooks): Promise<SessionOutcome> => {
      const defaults = resolveDefaultMcpServer();
      const mcpServerPath = options.mcpServerPath ?? defaults.serverPath;
      const nodeArgs = options.nodeArgs ?? defaults.nodeArgs;
      const sinkFile = join(tmpdir(), `docstube-observed-reads-${crypto.randomUUID()}.jsonl`);
      const forwarded = await prepareForwardedTools(input.tools);
      const scratchDir = await mkdtemp(join(tmpdir(), 'docstube-gemini-'));
      try {
        const settings = buildGeminiSettings({
          serverPath: mcpServerPath,
          command: options.nodeCommand,
          nodeArgs,
          env: {
            ...options.env,
            [mcpServerEnvVars.repoRoot]: input.repoRoot,
            [mcpServerEnvVars.readRoots]: JSON.stringify(input.spec.workspace.readRoots),
            ...forwarded.env,
            [mcpServerEnvVars.observedReadsFile]: sinkFile
          },
          maxTurns: input.spec.budget.maxTurns
        });
        const { systemMdPath } = await writeGeminiWorkspace({
          dir: scratchDir,
          settings,
          systemPrompt: input.spec.systemPrompt
        });
        const args = buildGeminiCliArgs({ prompt: input.spec.userPrompt, model: input.model });
        const result = await runner({
          command: executable,
          args,
          cwd: scratchDir,
          timeoutMs,
          env: {
            ...options.env,
            // Point user-level config discovery at the scratch dir so ~/.gemini never leaks in.
            HOME: scratchDir,
            USERPROFILE: scratchDir,
            GEMINI_SYSTEM_MD: systemMdPath
          }
        });
        if (result.timedOut) {
          throw new TransportError({ transport: 'google', message: 'gemini CLI timed out', retryable: true });
        }
        const combined = `${result.stdout}\n${result.stderr}`;
        if (isRateLimitSignal(combined)) {
          throw new TransportError({
            transport: 'google',
            message: 'gemini CLI was rate limited',
            retryable: true,
            rateLimited: true
          });
        }
        if (result.exitCode !== 0 && result.exitCode !== TURN_LIMIT_EXIT_CODE) {
          throw new TransportError({
            transport: 'google',
            message: `gemini CLI exited with ${result.exitCode}: ${result.stderr.slice(0, 400)}`,
            retryable: false
          });
        }
        const parsed = parseGeminiStreamEvents(result.stdout.split(/\r?\n/));
        for (const turn of parsed.turns) {
          hooks.onTurn(turn);
        }
        for (const read of await readObservedReadsSink(sinkFile)) {
          input.observedReads.record(read);
        }
        await forwarded.replay();
        const stopReason = result.exitCode === TURN_LIMIT_EXIT_CODE ? 'max-turns' : parsed.stopReason;
        return {
          finalText: parsed.finalText,
          usage: parsed.usage,
          stopReason,
          errorMessage: stopReason === 'error' ? parsed.errorMessage : undefined
        };
      } finally {
        await rm(sinkFile, { force: true });
        await rm(scratchDir, { recursive: true, force: true });
        await forwarded.cleanup();
      }
    }
  };
};
