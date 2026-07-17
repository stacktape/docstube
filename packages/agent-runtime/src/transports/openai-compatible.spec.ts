import { describe, expect, it } from 'vitest';
import type { CompleteInput } from '../transport.ts';
import {
  buildOpenAiRequestBody,
  mapOpenAiResponse,
  ollamaPreset,
  openAiPreset,
  createOpenAiCompatibleTransport
} from './openai-compatible.ts';

const input: CompleteInput = {
  systemPrompt: 'You write verified documentation.',
  model: 'gpt-5.6',
  toolDescriptors: [
    { name: 'read_file', description: 'Read a repo file.', paramsJsonSchema: { type: 'object', required: ['path'] } }
  ],
  messages: [
    { role: 'user', text: 'Write the retry page.' },
    {
      role: 'assistant',
      blocks: [{ type: 'tool-call', toolCallId: 'call_1', name: 'read_file', args: { path: 'src/retry.ts' } }]
    },
    { role: 'tool', results: [{ type: 'tool-result', toolCallId: 'call_1', result: { content: 'x' }, isError: false }] }
  ]
};

describe('buildOpenAiRequestBody', () => {
  it('maps system prompt, tool calls, and tool messages to the chat-completions shape', () => {
    const body = buildOpenAiRequestBody(input);
    expect(body).toEqual({
      model: 'gpt-5.6',
      messages: [
        { role: 'system', content: 'You write verified documentation.' },
        { role: 'user', content: 'Write the retry page.' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"src/retry.ts"}' } }
          ]
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"content":"x"}' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a repo file.',
            parameters: { type: 'object', required: ['path'] }
          }
        }
      ]
    });
  });
});

describe('mapOpenAiResponse', () => {
  it('maps tool_calls with JSON arguments and the tool_calls finish reason', () => {
    const turn = mapOpenAiResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 'call_2', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }]
          },
          finish_reason: 'tool_calls'
        }
      ],
      usage: { prompt_tokens: 50, completion_tokens: 12 }
    });
    expect(turn.blocks).toEqual([
      { type: 'tool-call', toolCallId: 'call_2', name: 'read_file', args: { path: 'a.ts' } }
    ]);
    expect(turn.usage).toEqual({ inputTokens: 50, outputTokens: 12 });
    expect(turn.stopReason).toBe('tool-use');
  });

  it('maps a length finish reason to an error turn instead of a finished answer', () => {
    const turn = mapOpenAiResponse({
      choices: [{ message: { content: 'This page covers retr' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 50, completion_tokens: 4096 }
    });
    expect(turn.stopReason).toBe('error');
    expect(turn.errorMessage).toContain('output truncated at 4096 tokens');
    expect(turn.blocks).toEqual([{ type: 'text', text: 'This page covers retr' }]);
  });

  it('keeps unparseable tool arguments as the raw string and maps stop to end', () => {
    const turn = mapOpenAiResponse({
      choices: [
        {
          message: {
            content: 'done',
            tool_calls: [{ id: 'call_3', function: { name: 'grep', arguments: '{broken' } }]
          },
          finish_reason: 'stop'
        }
      ]
    });
    expect(turn.blocks[0]).toEqual({ type: 'text', text: 'done' });
    expect(turn.blocks[1]).toEqual({ type: 'tool-call', toolCallId: 'call_3', name: 'grep', args: '{broken' });
    expect(turn.stopReason).toBe('end');
  });

  it('maps content_filter and unknown finish reasons to error turns — filtered output never ships', () => {
    const filtered = mapOpenAiResponse({
      choices: [{ message: { content: 'partial output' }, finish_reason: 'content_filter' }]
    });
    expect(filtered.stopReason).toBe('error');
    expect(filtered.errorMessage).toContain('content_filter');

    const unknown = mapOpenAiResponse({
      choices: [{ message: { content: 'x' }, finish_reason: 'mystery_reason' }]
    });
    expect(unknown.stopReason).toBe('error');
    expect(unknown.errorMessage).toContain('mystery_reason');
  });

  it('treats an absent finish reason as a finished answer', () => {
    const turn = mapOpenAiResponse({ choices: [{ message: { content: 'done' }, finish_reason: null }] });
    expect(turn.stopReason).toBe('end');
  });
});

describe('presets', () => {
  it('declare OpenAI (keyed) and Ollama (keyless) endpoints', () => {
    expect(openAiPreset).toEqual({
      id: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnvVar: 'OPENAI_API_KEY'
    });
    expect(ollamaPreset.apiKeyEnvVar).toBeUndefined();
    const transport = createOpenAiCompatibleTransport(ollamaPreset);
    expect(transport.id).toBe('ollama');
    expect(transport.capabilities.toolInjection).toBe('native');
  });
});
