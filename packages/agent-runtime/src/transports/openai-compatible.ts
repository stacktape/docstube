import { z } from 'zod';
import type { TranscriptBlock } from '@docstube/contracts';
import { isRateLimitSignal, TransportError } from '../errors.ts';
import type { AssistantTurn, CompleteInput, LoopTransport } from '../transport.ts';

// LoopTransport over any OpenAI-compatible /chat/completions endpoint with function calling.
// Presets cover OpenAI itself and Ollama; tool-calling quality on local models is an eval
// concern (documented recommended-models list), never a platform guarantee.

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const stringifyToolResult = (result: unknown): string =>
  typeof result === 'string' ? result : JSON.stringify(result ?? null);

export const buildOpenAiRequestBody = (input: CompleteInput): Record<string, unknown> => {
  const messages: Record<string, unknown>[] = [{ role: 'system', content: input.systemPrompt }];
  for (const message of input.messages) {
    if (message.role === 'user') {
      messages.push({ role: 'user', content: message.text });
    } else if (message.role === 'assistant') {
      const text = message.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      const toolCalls = message.blocks
        .filter((block): block is Extract<TranscriptBlock, { type: 'tool-call' }> => block.type === 'tool-call')
        .map((block) => ({
          id: block.toolCallId,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.args ?? {}) }
        }));
      messages.push({
        role: 'assistant',
        content: text.length > 0 ? text : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
      });
    } else {
      for (const result of message.results) {
        messages.push({ role: 'tool', tool_call_id: result.toolCallId, content: stringifyToolResult(result.result) });
      }
    }
  }
  return {
    model: input.model,
    messages,
    ...(input.toolDescriptors.length > 0
      ? {
          tools: input.toolDescriptors.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.paramsJsonSchema }
          }))
        }
      : {})
  };
};

const openAiResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) }))
            .optional()
        }),
        finish_reason: z.string().nullish()
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().default(0),
      completion_tokens: z.number().int().nonnegative().default(0)
    })
    .optional()
});

const parseToolArguments = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

export const mapOpenAiResponse = (payload: unknown, transportId = 'openai-compatible'): AssistantTurn => {
  const parsed = openAiResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new TransportError({
      transport: transportId,
      message: `unexpected chat-completions response shape: ${parsed.error.message}`,
      retryable: false
    });
  }
  const choice = parsed.data.choices[0];
  const blocks: TranscriptBlock[] = [];
  if (typeof choice?.message.content === 'string' && choice.message.content.length > 0) {
    blocks.push({ type: 'text', text: choice.message.content });
  }
  for (const toolCall of choice?.message.tool_calls ?? []) {
    blocks.push({
      type: 'tool-call',
      toolCallId: toolCall.id,
      name: toolCall.function.name,
      args: parseToolArguments(toolCall.function.arguments)
    });
  }
  const usage = {
    inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
    outputTokens: parsed.data.usage?.completion_tokens ?? 0
  };
  // finish_reason 'length' means the response hit the output-token limit — a cut-off answer, not
  // a finished one.
  if (choice?.finish_reason === 'length') {
    return {
      blocks,
      usage,
      stopReason: 'error',
      errorMessage: `output truncated at ${usage.outputTokens} tokens (finish_reason length)`
    };
  }
  if (choice?.finish_reason === 'tool_calls') {
    return { blocks, usage, stopReason: 'tool-use' };
  }
  // Allowlist: only 'stop' (or an endpoint reporting no finish reason at all) is a finished
  // answer. 'content_filter' and any unknown value mean filtered or partial output — an error
  // turn, never a shipped page.
  if (choice?.finish_reason === 'stop' || choice?.finish_reason === undefined || choice?.finish_reason === null) {
    return { blocks, usage, stopReason: 'end' };
  }
  return {
    blocks,
    usage,
    stopReason: 'error',
    errorMessage: `response ended with finish_reason "${choice?.finish_reason}" — filtered or incomplete output`
  };
};

export type OpenAiCompatibleTransportOptions = {
  id?: string;
  baseUrl?: string;
  // Omit for keyless endpoints such as a local Ollama server.
  apiKeyEnvVar?: string;
  fetchImpl?: typeof fetch;
};

export const openAiPreset: OpenAiCompatibleTransportOptions = {
  id: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnvVar: 'OPENAI_API_KEY'
};

export const ollamaPreset: OpenAiCompatibleTransportOptions = {
  id: 'ollama',
  baseUrl: 'http://127.0.0.1:11434/v1'
};

export const createOpenAiCompatibleTransport = (options: OpenAiCompatibleTransportOptions = {}): LoopTransport => {
  const id = options.id ?? 'openai-compatible';
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    mode: 'loop',
    id,
    capabilities: { toolInjection: 'native', structuredOutput: true },
    complete: async (input) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.apiKeyEnvVar) {
        const apiKey = process.env[options.apiKeyEnvVar];
        if (!apiKey) {
          throw new TransportError({
            transport: id,
            message: `missing API key: set the ${options.apiKeyEnvVar} environment variable`,
            retryable: false
          });
        }
        headers.authorization = `Bearer ${apiKey}`;
      }
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildOpenAiRequestBody(input))
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new TransportError({
          transport: id,
          message: `chat-completions request failed (${response.status}): ${body.slice(0, 400)}`,
          retryable: response.status === 429 || response.status >= 500,
          rateLimited: response.status === 429 || isRateLimitSignal(body)
        });
      }
      return mapOpenAiResponse(await response.json(), id);
    }
  };
};
