import { computeTaskCacheKey, transcriptSchema } from '@docstube/contracts';
import type { AgentTaskSpec, TaskResult, Transcript } from '@docstube/contracts';
import type { TranscriptCache } from './cache.ts';
import { BudgetExceededError, ToolPolicyError, TransportError } from './errors.ts';
import { checkJsonSchema } from './json-schema-check.ts';
import { estimateCostUsd } from './model-pricing.ts';
import { createObservedReadsCollector, createStandardTools } from './tools.ts';
import type { ObservedReadsCollector, ToolImplementation } from './tools.ts';
import type {
  LoopMessage,
  LoopTransport,
  SessionTransport,
  SessionTurn,
  TokenUsage,
  ToolCallBlock,
  ToolResultBlock,
  Transport
} from './transport.ts';

// The unified agent harness (ARCHITECTURE.md §8): one loop, one tool surface, every transport.
// Resolution order: cache → transport. Budgets are hard; structured outputs get one repair retry.

export type RunAgentTaskOptions = {
  transport: Transport;
  model: string;
  repoRoot: string;
  cache?: TranscriptCache;
  contextHashes?: Record<string, string>;
  // Task-specific tools beyond the standard read-only surface; matched to spec.tools by name.
  extraTools?: ToolImplementation[];
  // Backoff schedule for retryable transport errors (rate limits wait 3x); tests inject [1, 1].
  retryDelaysMs?: number[];
};

type TaskStopReason = Transcript['stopReason'];

type SessionState = {
  turns: SessionTurn[];
  usage: TokenUsage;
  stopReason: TaskStopReason;
  result?: TaskResult;
  error?: string;
};

const structuredOutputInstruction = (jsonSchema: Record<string, unknown>): string =>
  `\n\nRespond with exactly one JSON object that conforms to this JSON Schema — no prose, no code fences:\n${JSON.stringify(jsonSchema)}`;

const effectiveSystemPrompt = (spec: AgentTaskSpec): string =>
  spec.output.type === 'structured'
    ? spec.systemPrompt + structuredOutputInstruction(spec.output.jsonSchema)
    : spec.systemPrompt;

const extractJsonCandidate = (text: string): string => {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  if (candidate.startsWith('{') || candidate.startsWith('[')) {
    return candidate;
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
};

type StructuredParseOutcome = { ok: true; value: unknown } | { ok: false; error: string };

const parseStructuredOutput = (text: string, jsonSchema: Record<string, unknown>): StructuredParseOutcome => {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonCandidate(text));
  } catch (error) {
    return { ok: false, error: `output is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const issues = checkJsonSchema(value, jsonSchema);
  if (issues.length > 0) {
    return {
      ok: false,
      error: `output failed schema validation: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`
    };
  }
  return { ok: true, value };
};

// Some models wrap the page in chat prose plus a ```mdx fence despite the "pure MDX" instruction
// (live-hit: sonnet shipped "Now I have enough to write the corrected page." + fenced page).
// Unwrap ONLY when the response does not already start with frontmatter and a fence body does —
// pages that legitimately contain mdx fence examples are untouched.
export const unwrapMdxResponse = (finalText: string): string => {
  const trimmed = finalText.trim();
  if (trimmed.startsWith('---')) {
    return trimmed;
  }
  // Greedy body match: pages contain their own inner ```ts fences, so the wrapper closes at the
  // LAST ``` — a lazy match truncates the page at its first code example (live-hit, caught by the
  // brief-conformance reviewer).
  const fence = /```(?:mdx|markdown|md)\r?\n([\s\S]*)\r?\n```/u.exec(trimmed);
  const body = fence?.[1]?.trim();
  if (body !== undefined && body.startsWith('---')) {
    return body;
  }
  return trimmed;
};

const buildTextResult = (spec: AgentTaskSpec, finalText: string): TaskResult =>
  spec.output.type === 'mdx' ? { type: 'mdx', mdx: unwrapMdxResponse(finalText) } : { type: 'text', text: finalText };

const resolveToolImplementations = (
  spec: AgentTaskSpec,
  options: RunAgentTaskOptions,
  observedReads: ObservedReadsCollector
): Map<string, ToolImplementation> => {
  const registry = new Map<string, ToolImplementation>();
  const standard = createStandardTools({
    repoRoot: options.repoRoot,
    readRoots: spec.workspace.readRoots,
    observedReads
  });
  for (const implementation of standard) {
    registry.set(implementation.descriptor.name, implementation);
  }
  for (const implementation of options.extraTools ?? []) {
    registry.set(implementation.descriptor.name, implementation);
  }
  const active = new Map<string, ToolImplementation>();
  for (const descriptor of spec.tools) {
    const implementation = registry.get(descriptor.name);
    if (!implementation) {
      throw new ToolPolicyError({
        tool: descriptor.name,
        message: `no handler registered for tool "${descriptor.name}"`
      });
    }
    active.set(descriptor.name, implementation);
  }
  return active;
};

const executeToolCall = async (
  tools: Map<string, ToolImplementation>,
  call: ToolCallBlock
): Promise<ToolResultBlock> => {
  const implementation = tools.get(call.name);
  if (!implementation) {
    return {
      type: 'tool-result',
      toolCallId: call.toolCallId,
      result: { error: `unknown tool: ${call.name}` },
      isError: true
    };
  }
  try {
    const result = await implementation.handler(call.args);
    return { type: 'tool-result', toolCallId: call.toolCallId, result, isError: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { type: 'tool-result', toolCallId: call.toolCallId, result: { error: message }, isError: true };
  }
};

const runLoopSession = async (
  spec: AgentTaskSpec,
  transport: LoopTransport,
  model: string,
  tools: Map<string, ToolImplementation>
): Promise<SessionState> => {
  const systemPrompt = effectiveSystemPrompt(spec);
  const messages: LoopMessage[] = [{ role: 'user', text: spec.userPrompt }];
  const turns: SessionTurn[] = [];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let toolCallsUsed = 0;
  let turnsUsed = 0;
  let repairAttempted = false;

  for (;;) {
    // One structured-output repair turn is allowed past maxTurns — the retry is part of the budget contract.
    if (turnsUsed >= spec.budget.maxTurns + (repairAttempted ? 1 : 0)) {
      return { turns, usage, stopReason: 'max-turns' };
    }
    turnsUsed += 1;

    // Snapshot so transports never observe (or depend on) later in-place mutation of the history.
    const assistant = await transport.complete({
      systemPrompt,
      messages: [...messages],
      toolDescriptors: spec.tools,
      model
    });
    usage.inputTokens += assistant.usage.inputTokens;
    usage.outputTokens += assistant.usage.outputTokens;
    if (assistant.usage.costUsd !== undefined) {
      usage.costUsd = (usage.costUsd ?? 0) + assistant.usage.costUsd;
    }
    turns.push({ role: 'assistant', blocks: assistant.blocks });
    messages.push({ role: 'assistant', blocks: assistant.blocks });

    const toolCalls = assistant.blocks.filter((block): block is ToolCallBlock => block.type === 'tool-call');
    if (toolCalls.length === 0) {
      const finalText = assistant.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      if (spec.output.type !== 'structured') {
        return { turns, usage, stopReason: 'complete', result: buildTextResult(spec, finalText) };
      }
      const parsed = parseStructuredOutput(finalText, spec.output.jsonSchema);
      if (parsed.ok) {
        return { turns, usage, stopReason: 'complete', result: { type: 'structured', value: parsed.value } };
      }
      if (repairAttempted) {
        return { turns, usage, stopReason: 'error', error: parsed.error };
      }
      repairAttempted = true;
      messages.push({
        role: 'user',
        text: `Your previous response was rejected: ${parsed.error}. Respond again with exactly one JSON object conforming to the schema and nothing else.`
      });
      continue;
    }

    const results: ToolResultBlock[] = [];
    let budgetExhausted = false;
    for (const call of toolCalls) {
      if (toolCallsUsed >= spec.budget.maxToolCalls) {
        budgetExhausted = true;
        const budgetError = new BudgetExceededError({
          budget: 'max-tool-calls',
          message: `tool-call budget (${spec.budget.maxToolCalls}) exhausted`
        });
        results.push({
          type: 'tool-result',
          toolCallId: call.toolCallId,
          result: { error: budgetError.message },
          isError: true
        });
        continue;
      }
      toolCallsUsed += 1;
      results.push(await executeToolCall(tools, call));
    }
    turns.push({ role: 'tool', blocks: results });
    messages.push({ role: 'tool', results });
    if (budgetExhausted) {
      return { turns, usage, stopReason: 'max-tool-calls' };
    }
  }
};

const runVendorSession = async (
  spec: AgentTaskSpec,
  transport: SessionTransport,
  model: string,
  tools: Map<string, ToolImplementation>,
  observedReads: ObservedReadsCollector,
  repoRoot: string
): Promise<SessionState> => {
  const sessionSpec: AgentTaskSpec = { ...spec, systemPrompt: effectiveSystemPrompt(spec) };
  const turns: SessionTurn[] = [];
  const outcome = await transport.runSession(
    { spec: sessionSpec, model, repoRoot, tools: [...tools.values()], observedReads },
    { onTurn: (turn) => turns.push(turn) }
  );
  if (outcome.stopReason !== 'complete') {
    return { turns, usage: outcome.usage, stopReason: outcome.stopReason, error: outcome.errorMessage };
  }
  const finalText = (outcome.finalText ?? '').trim();
  if (spec.output.type !== 'structured') {
    return { turns, usage: outcome.usage, stopReason: 'complete', result: buildTextResult(spec, finalText) };
  }
  // Session transports cannot be re-prompted mid-session, so there is no repair retry here.
  const parsed = parseStructuredOutput(finalText, spec.output.jsonSchema);
  return parsed.ok
    ? { turns, usage: outcome.usage, stopReason: 'complete', result: { type: 'structured', value: parsed.value } }
    : { turns, usage: outcome.usage, stopReason: 'error', error: parsed.error };
};

export const runAgentTask = async (spec: AgentTaskSpec, options: RunAgentTaskOptions): Promise<Transcript> => {
  const cacheKey = computeTaskCacheKey(spec, {
    transport: options.transport.id,
    model: options.model,
    contextHashes: options.contextHashes
  });

  const cached = await options.cache?.get(cacheKey);
  if (cached) {
    return { ...cached, usage: { ...cached.usage, cacheHit: true } };
  }

  if (options.transport.mode === 'replay') {
    const fixture = await options.transport.loadTranscript({ spec, cacheKey });
    return transcriptSchema.parse({ ...fixture, taskId: spec.id, cacheKey });
  }

  const observedReads = createObservedReadsCollector();
  const tools = resolveToolImplementations(spec, options, observedReads);

  // Live-calibrated: subscriptions rate-limit mid-run; a retryable transport error (timeout,
  // 429/529) gets a bounded backoff instead of killing the whole run. Non-retryable errors and
  // exhausted retries still throw — the orchestrator surfaces them honestly.
  const loopTransport = options.transport.mode === 'loop' ? options.transport : undefined;
  const sessionTransport = options.transport.mode === 'session' ? options.transport : undefined;
  const runOnce = () =>
    loopTransport !== undefined
      ? runLoopSession(spec, loopTransport, options.model, tools)
      : runVendorSession(spec, sessionTransport!, options.model, tools, observedReads, options.repoRoot);
  const delays = options.retryDelaysMs ?? [20_000, 60_000];
  let state: Awaited<ReturnType<typeof runOnce>> | undefined;
  for (let attempt = 0; state === undefined; attempt += 1) {
    try {
      state = await runOnce();
    } catch (error) {
      if (!(error instanceof TransportError) || !error.retryable || attempt >= delays.length) {
        throw error;
      }
      const waitMs = error.rateLimited ? delays[attempt]! * 3 : delays[attempt]!;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  // Cost seam: transports stay pure — they surface a vendor-authoritative cost when one exists
  // (claude CLI's total_cost_usd) and nothing else. The harness is the single point every
  // transport funnels through, so pricing-table estimation happens here, once, and only when the
  // vendor reported no cost. Unknown models keep costUsd undefined — never guessed.
  const costUsd = state.usage.costUsd ?? estimateCostUsd(options.model, state.usage);

  const transcript = transcriptSchema.parse({
    schemaVersion: 1,
    taskId: spec.id,
    cacheKey,
    transport: options.transport.id,
    model: options.model,
    turns: state.turns,
    observedReads: observedReads.list(),
    usage: {
      inputTokens: state.usage.inputTokens,
      outputTokens: state.usage.outputTokens,
      ...(costUsd !== undefined ? { costUsd } : {}),
      cacheHit: false
    },
    stopReason: state.stopReason,
    result: state.result,
    error: state.error
  });

  // Only completed transcripts are cacheable — budget stops and errors must rerun. A session
  // whose every tool call errored also reruns: it "concluded" blind (live-hit: a tool-permission
  // misconfig produced a degraded review that would have replayed even after the config fix).
  const toolResults = state.turns.flatMap((turn) => turn.blocks.filter((block) => block.type === 'tool-result'));
  const ranBlind = toolResults.length > 0 && toolResults.every((block) => block.isError === true);
  if (transcript.stopReason === 'complete' && !ranBlind && options.cache) {
    await options.cache.put(transcript);
  }
  await options.transport.onTranscript?.({ transcript, spec, repoRoot: options.repoRoot });
  return transcript;
};
