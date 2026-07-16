import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observedReadSchema } from '@docstube/contracts';
import type { ObservedRead, TranscriptBlock } from '@docstube/contracts';
import { isRateLimitSignal, TransportError } from '../errors.ts';
import { mcpServerEnvVars } from '../mcp-stdio-server.ts';
import { runSubprocess } from '../subprocess.ts';
import { prepareForwardedTools } from './forwarded-tools.ts';
import type { SubprocessRunner } from '../subprocess.ts';
import type { SessionOutcome, SessionTransport, SessionTurn, TokenUsage } from '../transport.ts';

// SessionTransport over the Claude Code CLI (knowledge/design/agent-transports.md): all built-in
// tools disabled (--tools ""), only our MCP stdio server visible (--strict-mcp-config), full
// transcript as stream-json. Subscription billing works through `claude setup-token`.
//
// The arg-building and event-parsing logic is pure and unit-tested; the live spawn stays thin.
// Observed reads cross the process boundary through a JSONL sink file the MCP server appends to.

const MCP_SERVER_NAME = 'docstube';
const DEFAULT_TIMEOUT_MS = 20 * 60_000;

export type ClaudeCliArgsInput = {
  systemPrompt: string;
  model: string;
  maxTurns: number;
  mcpConfig: string;
};

// With --input-format stream-json the CLI reads user messages from STDIN and ignores an argv
// prompt entirely (live-hit: the run exited silently with no result event). Stdin delivery also
// sidesteps the Windows long-argv limits that crash codex.
export const buildClaudeCliArgs = (input: ClaudeCliArgsInput): string[] => [
  '-p',
  '--output-format',
  'stream-json',
  '--input-format',
  'stream-json',
  '--verbose',
  '--tools',
  '',
  '--strict-mcp-config',
  // Non-interactive runs have nobody to click "approve": without this, every docstube tool call
  // returns a permission error (live-hit). Allowing the whole server is safe — built-ins are off
  // and --strict-mcp-config means ours is the only server.
  '--allowedTools',
  `mcp__${MCP_SERVER_NAME}`,
  '--mcp-config',
  input.mcpConfig,
  '--max-turns',
  String(input.maxTurns),
  '--system-prompt',
  input.systemPrompt,
  '--model',
  input.model
];

export const buildClaudeStdinPrompt = (prompt: string): string =>
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } })}\n`;

export const buildClaudeMcpConfig = (input: {
  serverPath: string;
  command?: string;
  nodeArgs?: string[];
  env?: Record<string, string>;
}): string =>
  JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'stdio',
        command: input.command ?? 'node',
        args: [...(input.nodeArgs ?? []), input.serverPath],
        env: input.env ?? {}
      }
    }
  });

// Tools exposed over MCP appear to the model as "mcp__<server>__<tool>"; transcripts keep the
// harness-canonical tool names so provenance and replay are transport-independent.
const normalizeToolName = (name: string): string => {
  const match = /^mcp__.+?__(.+)$/.exec(name);
  return match?.[1] ?? name;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textFromToolResultContent = (content: unknown): unknown => {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
      .filter((text) => text.length > 0)
      .join('\n');
  }
  return content;
};

export type ClaudeStreamParseResult = {
  turns: SessionTurn[];
  finalText?: string;
  usage: TokenUsage;
  stopReason: 'complete' | 'max-turns' | 'error';
  errorMessage?: string;
  // True when the stream contained a result event: the CLI ran the session to a conclusion, even
  // if it then exited non-zero (it does for max-turns and error results).
  sawResult: boolean;
};

export const parseClaudeStreamEvents = (lines: readonly string[]): ClaudeStreamParseResult => {
  const turns: SessionTurn[] = [];
  let finalText: string | undefined;
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let stopReason: ClaudeStreamParseResult['stopReason'] = 'error';
  let errorMessage: string | undefined = 'claude CLI produced no result event';
  let sawResult = false;

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
    if (!isRecord(event)) {
      continue;
    }

    if (event.type === 'assistant' && isRecord(event.message) && Array.isArray(event.message.content)) {
      const blocks: TranscriptBlock[] = [];
      for (const item of event.message.content) {
        if (!isRecord(item)) {
          continue;
        }
        if (item.type === 'text' && typeof item.text === 'string') {
          blocks.push({ type: 'text', text: item.text });
        } else if (item.type === 'tool_use' && typeof item.id === 'string' && typeof item.name === 'string') {
          blocks.push({ type: 'tool-call', toolCallId: item.id, name: normalizeToolName(item.name), args: item.input });
        }
      }
      if (blocks.length > 0) {
        turns.push({ role: 'assistant', blocks });
      }
      continue;
    }

    if (event.type === 'user' && isRecord(event.message) && Array.isArray(event.message.content)) {
      const blocks: TranscriptBlock[] = [];
      for (const item of event.message.content) {
        if (isRecord(item) && item.type === 'tool_result' && typeof item.tool_use_id === 'string') {
          blocks.push({
            type: 'tool-result',
            toolCallId: item.tool_use_id,
            result: textFromToolResultContent(item.content),
            isError: item.is_error === true
          });
        }
      }
      if (blocks.length > 0) {
        turns.push({ role: 'tool', blocks });
      }
      continue;
    }

    if (event.type === 'result') {
      sawResult = true;
      // total_cost_usd sits on the result event root and is the vendor-authoritative run cost.
      const costUsd = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : undefined;
      if (isRecord(event.usage)) {
        usage = {
          inputTokens: typeof event.usage.input_tokens === 'number' ? event.usage.input_tokens : 0,
          outputTokens: typeof event.usage.output_tokens === 'number' ? event.usage.output_tokens : 0,
          ...(costUsd !== undefined ? { costUsd } : {})
        };
      } else if (costUsd !== undefined) {
        usage = { ...usage, costUsd };
      }
      if (typeof event.result === 'string') {
        finalText = event.result;
      }
      const subtype = typeof event.subtype === 'string' ? event.subtype : '';
      if (subtype === 'success' && event.is_error !== true) {
        stopReason = 'complete';
        errorMessage = undefined;
      } else if (subtype.includes('max_turns')) {
        stopReason = 'max-turns';
        errorMessage = undefined;
      } else {
        stopReason = 'error';
        errorMessage = typeof event.result === 'string' ? event.result : `claude CLI reported ${subtype || 'an error'}`;
      }
    }
  }

  return { turns, finalText, usage, stopReason, errorMessage, sawResult };
};

export const parseObservedReadLines = (content: string): ObservedRead[] => {
  const reads: ObservedRead[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = observedReadSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) {
        reads.push(parsed.data);
      }
    } catch {
      // skip malformed lines — the sink is best-effort append-only
    }
  }
  return reads;
};

const readObservedReadsSink = async (file: string): Promise<ObservedRead[]> => {
  try {
    return parseObservedReadLines(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
};

export type ClaudeCliTransportOptions = {
  // Path to the MCP stdio server entry (src/mcp-stdio-server-bin.ts in dev, dist/mcp-stdio-server-bin.mjs built).
  mcpServerPath: string;
  executable?: string;
  nodeCommand?: string;
  // e.g. ['--conditions=docstube-source'] when running the server from TypeScript source.
  nodeArgs?: string[];
  timeoutMs?: number;
  runner?: SubprocessRunner;
  env?: Record<string, string>;
};

export const createClaudeCliTransport = (options: ClaudeCliTransportOptions): SessionTransport => {
  const executable = options.executable ?? 'claude';
  const runner = options.runner ?? runSubprocess;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    mode: 'session',
    id: 'claude-cli',
    capabilities: { toolInjection: 'mcp', structuredOutput: false },
    runSession: async (input, hooks): Promise<SessionOutcome> => {
      const sinkFile = join(tmpdir(), `docstube-observed-reads-${crypto.randomUUID()}.jsonl`);
      const forwarded = await prepareForwardedTools(input.tools);
      try {
        const mcpConfig = buildClaudeMcpConfig({
          serverPath: options.mcpServerPath,
          command: options.nodeCommand,
          nodeArgs: options.nodeArgs,
          env: {
            ...options.env,
            ...forwarded.env,
            [mcpServerEnvVars.repoRoot]: input.repoRoot,
            [mcpServerEnvVars.readRoots]: JSON.stringify(input.spec.workspace.readRoots),
            [mcpServerEnvVars.observedReadsFile]: sinkFile
          }
        });
        const args = buildClaudeCliArgs({
          systemPrompt: input.spec.systemPrompt,
          model: input.model,
          maxTurns: input.spec.budget.maxTurns,
          mcpConfig
        });
        const result = await runner({
          command: executable,
          args,
          cwd: input.repoRoot,
          timeoutMs,
          env: options.env,
          input: buildClaudeStdinPrompt(input.spec.userPrompt)
        });
        if (result.timedOut) {
          throw new TransportError({ transport: 'claude-cli', message: 'claude CLI timed out', retryable: true });
        }
        // Only a FAILED process can be rate limited, and only stderr is the CLI's own voice —
        // stdout carries model output, which may legitimately mention rate limits.
        if (result.exitCode !== 0 && isRateLimitSignal(result.stderr)) {
          throw new TransportError({
            transport: 'claude-cli',
            message: 'claude CLI was rate limited',
            retryable: true,
            rateLimited: true
          });
        }
        const parsed = parseClaudeStreamEvents(result.stdout.split(/\r?\n/));
        // The CLI exits non-zero after max-turns and error results too (live-hit: a review task
        // over its turn budget crashed the whole run). If the stream reached a result event, the
        // session concluded — return the parsed outcome and let the harness decide; only a stream
        // with no result is a real transport failure.
        if (result.exitCode !== 0 && !parsed.sawResult) {
          throw new TransportError({
            transport: 'claude-cli',
            message: `claude CLI exited with ${result.exitCode}: ${result.stderr.slice(0, 400)}`,
            retryable: false
          });
        }
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
        await forwarded.cleanup();
      }
    }
  };
};
