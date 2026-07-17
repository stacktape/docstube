import { z } from 'zod';
import type { TranscriptBlock } from '@docstube/contracts';
import { isRateLimitSignal, TransportError } from '../errors.ts';
import type { AssistantTurn, CompleteInput, LoopMessage, LoopTransport } from '../transport.ts';

// LoopTransport over raw fetch to the Anthropic Messages API (native tool use, no SDK dependency).

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
// Generous by default: full documentation pages regularly exceed 8K output tokens, and a
// max_tokens stop is surfaced as an error rather than shipped as a silently cut-off page.
const DEFAULT_MAX_OUTPUT_TOKENS = 32_000;

const stringifyToolResult = (result: unknown): string =>
  typeof result === 'string' ? result : JSON.stringify(result ?? null);

const toAnthropicMessage = (message: LoopMessage): Record<string, unknown> => {
  if (message.role === 'user') {
    return { role: 'user', content: [{ type: 'text', text: message.text }] };
  }
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.blocks.flatMap((block): Record<string, unknown>[] => {
        if (block.type === 'text') {
          return [{ type: 'text', text: block.text }];
        }
        if (block.type === 'tool-call') {
          return [{ type: 'tool_use', id: block.toolCallId, name: block.name, input: block.args ?? {} }];
        }
        return [];
      })
    };
  }
  return {
    role: 'user',
    content: message.results.map((result) => ({
      type: 'tool_result',
      tool_use_id: result.toolCallId,
      content: stringifyToolResult(result.result),
      is_error: result.isError
    }))
  };
};

export const buildAnthropicRequestBody = (
  input: CompleteInput,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS
): Record<string, unknown> => ({
  model: input.model,
  max_tokens: maxOutputTokens,
  system: input.systemPrompt,
  messages: input.messages.map(toAnthropicMessage),
  ...(input.toolDescriptors.length > 0
    ? {
        tools: input.toolDescriptors.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.paramsJsonSchema
        }))
      }
    : {})
});

const anthropicResponseSchema = z.object({
  content: z.array(z.record(z.string(), z.unknown())).default([]),
  stop_reason: z.string().nullish(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().default(0),
      output_tokens: z.number().int().nonnegative().default(0)
    })
    .optional()
});

export const mapAnthropicResponse = (payload: unknown): AssistantTurn => {
  const parsed = anthropicResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new TransportError({
      transport: 'anthropic-api',
      message: `unexpected Anthropic response shape: ${parsed.error.message}`,
      retryable: false
    });
  }
  const blocks: TranscriptBlock[] = [];
  for (const item of parsed.data.content) {
    if (item.type === 'text' && typeof item.text === 'string') {
      blocks.push({ type: 'text', text: item.text });
    } else if (item.type === 'tool_use' && typeof item.id === 'string' && typeof item.name === 'string') {
      blocks.push({ type: 'tool-call', toolCallId: item.id, name: item.name, args: item.input });
    }
    // Other block kinds (thinking, redacted_thinking) are transport detail, not transcript content.
  }
  const usage = {
    inputTokens: parsed.data.usage?.input_tokens ?? 0,
    outputTokens: parsed.data.usage?.output_tokens ?? 0
  };
  // max_tokens means the response was cut off mid-thought — never a finished answer. Mapping it
  // to 'end' would ship a truncated page as if it were complete.
  if (parsed.data.stop_reason === 'max_tokens') {
    return {
      blocks,
      usage,
      stopReason: 'error',
      errorMessage: `output truncated at ${usage.outputTokens} tokens (stop_reason max_tokens); raise maxOutputTokens`
    };
  }
  if (parsed.data.stop_reason === 'tool_use') {
    return { blocks, usage, stopReason: 'tool-use' };
  }
  // Allowlist: only end_turn (or an absent stop reason) is a finished answer. 'refusal' is the
  // model declining, 'pause_turn' is an unfinished long turn the harness cannot continue, and any
  // unknown value is unproven — all surface as error turns rather than shipping as complete.
  if (
    parsed.data.stop_reason === 'end_turn' ||
    parsed.data.stop_reason === undefined ||
    parsed.data.stop_reason === null
  ) {
    return { blocks, usage, stopReason: 'end' };
  }
  const errorMessage =
    parsed.data.stop_reason === 'refusal'
      ? 'model refused to answer (stop_reason refusal)'
      : parsed.data.stop_reason === 'pause_turn'
        ? 'turn paused before completion (stop_reason pause_turn) — the harness has no continuation support'
        : `response ended with unknown stop_reason "${parsed.data.stop_reason}"`;
  return { blocks, usage, stopReason: 'error', errorMessage };
};

export type AnthropicApiTransportOptions = {
  apiKeyEnvVar?: string;
  baseUrl?: string;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
};

export const createAnthropicApiTransport = (options: AnthropicApiTransportOptions = {}): LoopTransport => {
  const apiKeyEnvVar = options.apiKeyEnvVar ?? 'ANTHROPIC_API_KEY';
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    mode: 'loop',
    id: 'anthropic-api',
    capabilities: { toolInjection: 'native', structuredOutput: true },
    complete: async (input) => {
      const apiKey = process.env[apiKeyEnvVar];
      if (!apiKey) {
        throw new TransportError({
          transport: 'anthropic-api',
          message: `missing API key: set the ${apiKeyEnvVar} environment variable`,
          retryable: false
        });
      }
      const response = await fetchImpl(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': ANTHROPIC_VERSION,
          'x-api-key': apiKey
        },
        body: JSON.stringify(buildAnthropicRequestBody(input, maxOutputTokens))
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new TransportError({
          transport: 'anthropic-api',
          message: `Anthropic request failed (${response.status}): ${body.slice(0, 400)}`,
          retryable: response.status === 429 || response.status >= 500,
          rateLimited: response.status === 429 || isRateLimitSignal(body)
        });
      }
      return mapAnthropicResponse(await response.json());
    }
  };
};
