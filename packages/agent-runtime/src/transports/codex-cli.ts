import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscriptBlock } from '@docstube/contracts';
import { isRateLimitSignal, TransportError } from '../errors.ts';
import { mcpServerEnvVars } from '../mcp-stdio-server.ts';
import { runSubprocess } from '../subprocess.ts';
import type { SubprocessRunner } from '../subprocess.ts';
import type { SessionOutcome, SessionTransport, SessionTurn, TokenUsage } from '../transport.ts';
import { readObservedReadsSink, resolveDefaultMcpServer } from './mcp-session-helpers.ts';
import { prepareForwardedTools } from './forwarded-tools.ts';

// SessionTransport over `codex exec --json` (knowledge/design/agent-transports.md; flags re-verified
// 2026-07-13 against https://developers.openai.com/codex/noninteractive and
// https://developers.openai.com/codex/cli/reference — both now redirect to learn.chatgpt.com, and
// event shapes against codex-rs/exec/src/exec_events.rs on github.com/openai/codex@main).
//
// Verified capabilities and gaps:
// - Tool injection is MCP via per-invocation `-c mcp_servers.docstube.*` overrides. The CLI
//   reference documents `-c` as "Values parse as TOML if possible; otherwise the literal string is
//   used", so scalars and dotted nested keys are on the documented path; passing the args array as
//   a TOML array literal is implied by TOML-value parsing but no doc shows that exact combo — it
//   needs one live smoke test. Chosen over a temp CODEX_HOME config.toml because
//   `--ignore-user-config` + `-c` is fully flag-driven (no file lifecycle) and keeps ChatGPT
//   subscription auth working (`--ignore-user-config` skips only $CODEX_HOME/config.toml).
// - Built-in tool reduction: `features.shell_tool=false`, `tools.web_search=false` (live-verified on codex 0.139: the string enum form fails config parsing; boolean works),
//   `tools.view_image=false`, plus `--sandbox read-only`. `apply_patch` CANNOT be disabled, so the
//   process runs with cwd = a fresh scratch directory: stray patches land in a directory that is
//   deleted afterwards and never touch the repo.
// - No system-prompt replacement flag exists (capability gap): the system prompt is prepended to
//   the user prompt under an explicit delimiter instead of being carried out-of-band.
// - No max-turns flag exists (capability gap): `spec.budget.maxTurns` is not enforceable here;
//   turn budgets degrade to the process timeout.
// - structuredOutput is declared false even though `--output-schema` exists — the harness contract
//   for structured output is not wired through this transport.

const MCP_SERVER_NAME = 'docstube';
const DEFAULT_TIMEOUT_MS = 20 * 60_000;

const SYSTEM_PROMPT_DELIMITER = '=== TASK PROMPT ===';

// codex has no full system-prompt override, so the system prompt rides in-band.
export const combineCodexPrompt = (systemPrompt: string, userPrompt: string): string =>
  `${systemPrompt}\n\n${SYSTEM_PROMPT_DELIMITER}\n\n${userPrompt}`;

// TOML basic-string escaping for -c override values (backslashes in Windows paths, quotes, newlines).
const tomlString = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;

const tomlStringArray = (values: readonly string[]): string => `[${values.map(tomlString).join(',')}]`;

export type CodexCliArgsInput = {
  prompt: string;
  model: string;
  mcpServer: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
};

export const buildCodexCliArgs = (input: CodexCliArgsInput): string[] => [
  'exec',
  input.prompt,
  '--json',
  '--skip-git-repo-check',
  '--ignore-user-config',
  '--sandbox',
  'read-only',
  '--model',
  input.model,
  '-c',
  'features.shell_tool=false',
  '-c',
  'tools.web_search=false',
  '-c',
  'tools.view_image=false',
  '-c',
  `mcp_servers.${MCP_SERVER_NAME}.command=${tomlString(input.mcpServer.command)}`,
  '-c',
  `mcp_servers.${MCP_SERVER_NAME}.args=${tomlStringArray(input.mcpServer.args)}`,
  '-c',
  `mcp_servers.${MCP_SERVER_NAME}.required=true`,
  // Live-verified on codex 0.139: MCP tool calls need per-server approval mode `approve`
  // (always-approve) or exec mode cancels every call ("user cancelled MCP tool call"). The other
  // enum values fail non-interactively: `prompt` has nowhere to ask, `auto` still cancels, and
  // approval_policy="never" means never-ask-and-DENY.
  '-c',
  `mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode="approve"`,
  ...Object.entries(input.mcpServer.env).flatMap(([key, value]) => [
    '-c',
    `mcp_servers.${MCP_SERVER_NAME}.env.${key}=${tomlString(value)}`
  ])
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// MCP tool results arrive as MCP content blocks ([{type:'text',text}]) in item.result.content.
const textFromMcpContent = (content: unknown): unknown => {
  if (!Array.isArray(content)) {
    return content;
  }
  return content
    .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
    .filter((text) => text.length > 0)
    .join('\n');
};

export type CodexJsonParseResult = {
  turns: SessionTurn[];
  finalText?: string;
  usage: TokenUsage;
  stopReason: 'complete' | 'error';
  errorMessage?: string;
};

// Maps the `--json` JSONL stream (event shapes verified from codex-rs/exec/src/exec_events.rs):
// item.completed agent_message -> assistant text turn; item.completed mcp_tool_call -> assistant
// tool-call turn + tool tool-result turn; turn.completed accumulates usage; turn.failed / error
// are fatal. Unknown event and item types are ignored, never fatal.
export const parseCodexJsonEvents = (lines: readonly string[]): CodexJsonParseResult => {
  const turns: SessionTurn[] = [];
  let finalText: string | undefined;
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let sawTurnCompleted = false;
  let errorMessage: string | undefined;

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

    // turn.completed usage carries token counts only — codex never reports a USD cost
    // (exec_events.rs); the harness estimates one from model-pricing.ts when the model is known.
    if (event.type === 'turn.completed') {
      sawTurnCompleted = true;
      if (isRecord(event.usage)) {
        usage.inputTokens += typeof event.usage.input_tokens === 'number' ? event.usage.input_tokens : 0;
        usage.outputTokens += typeof event.usage.output_tokens === 'number' ? event.usage.output_tokens : 0;
      }
      continue;
    }

    if (event.type === 'turn.failed') {
      errorMessage =
        isRecord(event.error) && typeof event.error.message === 'string'
          ? event.error.message
          : 'codex CLI reported a failed turn';
      continue;
    }

    if (event.type === 'error') {
      errorMessage = typeof event.message === 'string' ? event.message : 'codex CLI reported a stream error';
      continue;
    }

    if (event.type !== 'item.completed' || !isRecord(event.item)) {
      continue;
    }
    const item = event.item;
    const itemId = typeof item.id === 'string' ? item.id : '';

    if (item.type === 'agent_message' && typeof item.text === 'string') {
      const blocks: TranscriptBlock[] = [{ type: 'text', text: item.text }];
      turns.push({ role: 'assistant', blocks });
      finalText = item.text;
      continue;
    }

    if (item.type === 'mcp_tool_call' && typeof item.tool === 'string') {
      turns.push({
        role: 'assistant',
        blocks: [{ type: 'tool-call', toolCallId: itemId, name: item.tool, args: item.arguments }]
      });
      const failed = item.status === 'failed';
      const result =
        failed && isRecord(item.error) && typeof item.error.message === 'string'
          ? item.error.message
          : textFromMcpContent(isRecord(item.result) ? item.result.content : undefined);
      turns.push({
        role: 'tool',
        blocks: [{ type: 'tool-result', toolCallId: itemId, result, isError: failed }]
      });
    }
  }

  if (errorMessage !== undefined) {
    return { turns, finalText, usage, stopReason: 'error', errorMessage };
  }
  if (!sawTurnCompleted) {
    return {
      turns,
      finalText,
      usage,
      stopReason: 'error',
      errorMessage: 'codex CLI produced no turn completion event'
    };
  }
  return { turns, finalText, usage, stopReason: 'complete' };
};

export type CodexCliTransportOptions = {
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

export const createCodexCliTransport = (options: CodexCliTransportOptions = {}): SessionTransport => {
  const executable = options.executable ?? 'codex';
  const runner = options.runner ?? runSubprocess;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    mode: 'session',
    id: 'codex-cli',
    capabilities: { toolInjection: 'mcp', structuredOutput: false },
    runSession: async (input, hooks): Promise<SessionOutcome> => {
      const defaults = resolveDefaultMcpServer();
      const mcpServerPath = options.mcpServerPath ?? defaults.serverPath;
      const nodeArgs = options.nodeArgs ?? defaults.nodeArgs;
      const sinkFile = join(tmpdir(), `docstube-observed-reads-${crypto.randomUUID()}.jsonl`);
      const forwarded = await prepareForwardedTools(input.tools);
      // apply_patch cannot be disabled: cwd is a throwaway scratch dir so stray patches are discarded.
      const scratchDir = await mkdtemp(join(tmpdir(), 'docstube-codex-'));
      try {
        const args = buildCodexCliArgs({
          prompt: combineCodexPrompt(input.spec.systemPrompt, input.spec.userPrompt),
          model: input.model,
          mcpServer: {
            command: options.nodeCommand ?? 'node',
            args: [...nodeArgs, mcpServerPath],
            env: {
              ...options.env,
              [mcpServerEnvVars.repoRoot]: input.repoRoot,
              [mcpServerEnvVars.readRoots]: JSON.stringify(input.spec.workspace.readRoots),
              ...forwarded.env,
              [mcpServerEnvVars.observedReadsFile]: sinkFile
            }
          }
        });
        const result = await runner({ command: executable, args, cwd: scratchDir, timeoutMs, env: options.env });
        if (result.timedOut) {
          throw new TransportError({ transport: 'codex-cli', message: 'codex CLI timed out', retryable: true });
        }
        const combined = `${result.stdout}\n${result.stderr}`;
        if (isRateLimitSignal(combined)) {
          throw new TransportError({
            transport: 'codex-cli',
            message: 'codex CLI was rate limited',
            retryable: true,
            rateLimited: true
          });
        }
        if (result.exitCode !== 0) {
          throw new TransportError({
            transport: 'codex-cli',
            message: `codex CLI exited with ${result.exitCode}: ${result.stderr.slice(0, 400)}`,
            retryable: false
          });
        }
        const parsed = parseCodexJsonEvents(result.stdout.split(/\r?\n/));
        for (const turn of parsed.turns) {
          hooks.onTurn(turn);
        }
        for (const read of await readObservedReadsSink(sinkFile)) {
          input.observedReads.record(read);
        }
        await forwarded.replay();
        return {
          finalText: parsed.finalText,
          usage: parsed.usage,
          stopReason: parsed.stopReason,
          errorMessage: parsed.errorMessage
        };
      } finally {
        await rm(sinkFile, { force: true });
        await rm(scratchDir, { recursive: true, force: true });
        await forwarded.cleanup();
      }
    }
  };
};
