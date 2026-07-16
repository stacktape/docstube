import { describe, expect, it } from 'vitest';
import { TransportError } from '../errors.ts';
import type { CompleteInput } from '../transport.ts';
import { buildAnthropicRequestBody, createAnthropicApiTransport, mapAnthropicResponse } from './anthropic-api.ts';

const input: CompleteInput = {
  systemPrompt: 'You write verified documentation.',
  model: 'claude-sonnet-5',
  toolDescriptors: [
    { name: 'read_file', description: 'Read a repo file.', paramsJsonSchema: { type: 'object', required: ['path'] } }
  ],
  messages: [
    { role: 'user', text: 'Write the retry page.' },
    {
      role: 'assistant',
      blocks: [{ type: 'tool-call', toolCallId: 'toolu_01', name: 'read_file', args: { path: 'src/retry.ts' } }]
    },
    {
      role: 'tool',
      results: [{ type: 'tool-result', toolCallId: 'toolu_01', result: { content: 'x' }, isError: false }]
    }
  ]
};

describe('buildAnthropicRequestBody', () => {
  it('maps messages, tool calls, tool results, and tools to the Messages API shape', () => {
    const body = buildAnthropicRequestBody(input, 4096);
    expect(body).toEqual({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: 'You write verified documentation.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Write the retry page.' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_01', name: 'read_file', input: { path: 'src/retry.ts' } }]
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: '{"content":"x"}', is_error: false }]
        }
      ],
      tools: [
        { name: 'read_file', description: 'Read a repo file.', input_schema: { type: 'object', required: ['path'] } }
      ]
    });
  });

  it('omits the tools key when the surface is empty', () => {
    const body = buildAnthropicRequestBody({ ...input, toolDescriptors: [], messages: [{ role: 'user', text: 'hi' }] });
    expect(body).not.toHaveProperty('tools');
  });
});

describe('mapAnthropicResponse', () => {
  it('maps text, tool_use, usage, and stop_reason', () => {
    const turn = mapAnthropicResponse({
      content: [
        { type: 'text', text: 'Let me read the file.' },
        { type: 'tool_use', id: 'toolu_02', name: 'read_file', input: { path: 'src/retry.ts' } }
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 30 }
    });
    expect(turn.blocks).toEqual([
      { type: 'text', text: 'Let me read the file.' },
      { type: 'tool-call', toolCallId: 'toolu_02', name: 'read_file', args: { path: 'src/retry.ts' } }
    ]);
    expect(turn.usage).toEqual({ inputTokens: 100, outputTokens: 30 });
    expect(turn.stopReason).toBe('tool-use');
  });

  it('treats end_turn as end and skips unknown block kinds', () => {
    const turn = mapAnthropicResponse({
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'done' }
      ],
      stop_reason: 'end_turn'
    });
    expect(turn.blocks).toEqual([{ type: 'text', text: 'done' }]);
    expect(turn.stopReason).toBe('end');
  });
});

describe('createAnthropicApiTransport', () => {
  it('fails without the API key env var and marks 429 responses as retryable rate limits', async () => {
    const keyVar = 'DOCSTUBE_TEST_ANTHROPIC_KEY';
    delete process.env[keyVar];
    const missingKey = createAnthropicApiTransport({ apiKeyEnvVar: keyVar });
    await expect(missingKey.complete(input)).rejects.toThrow(keyVar);

    process.env[keyVar] = 'test-key';
    try {
      const transport = createAnthropicApiTransport({
        apiKeyEnvVar: keyVar,
        fetchImpl: (async () => new Response('rate limit', { status: 429 })) as typeof fetch
      });
      const failure = await transport.complete(input).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(TransportError);
      expect((failure as TransportError).retryable).toBe(true);
      expect((failure as TransportError).rateLimited).toBe(true);
    } finally {
      delete process.env[keyVar];
    }
  });
});
