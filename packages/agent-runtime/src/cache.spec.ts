import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentTaskSpecSchema, computeTaskCacheKey, idPrefixes, mintId, transcriptSchema } from '@docstube/contracts';
import type { AgentTaskSpec, Transcript } from '@docstube/contracts';
import { createTranscriptCache } from './cache.ts';
import { runAgentTask } from './harness.ts';
import type { LoopTransport } from './transport.ts';

let cacheDir: string;

beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'docstube-cache-'));
});

afterAll(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

const buildSpec = (): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'write-page',
    systemPrompt: 'system',
    userPrompt: 'user',
    tools: [],
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 4, maxToolCalls: 8 },
    output: { type: 'text' }
  });

const buildTranscript = (spec: AgentTaskSpec, cacheKey: string): Transcript =>
  transcriptSchema.parse({
    schemaVersion: 1,
    taskId: spec.id,
    cacheKey,
    transport: 'fake-loop',
    model: 'test-model',
    turns: [{ role: 'assistant', blocks: [{ type: 'text', text: 'hello' }] }],
    observedReads: [],
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: 'complete',
    result: { type: 'text', text: 'hello' }
  });

describe('transcript cache', () => {
  it('round-trips a transcript by cache key', async () => {
    const cache = createTranscriptCache(join(cacheDir, 'round-trip'));
    const spec = buildSpec();
    const cacheKey = computeTaskCacheKey(spec, { transport: 'fake-loop', model: 'test-model' });
    const transcript = buildTranscript(spec, cacheKey);
    await cache.put(transcript);
    expect(await cache.get(cacheKey)).toEqual(transcript);
  });

  it('treats missing and corrupt entries as misses', async () => {
    const dir = join(cacheDir, 'corrupt');
    const cache = createTranscriptCache(dir);
    expect(await cache.get('0'.repeat(64))).toBeUndefined();
    const spec = buildSpec();
    const transcript = buildTranscript(
      spec,
      computeTaskCacheKey(spec, { transport: 'fake-loop', model: 'test-model' })
    );
    await cache.put(transcript);
    await writeFile(join(dir, `${transcript.cacheKey}.json`), '{ not json', 'utf8');
    expect(await cache.get(transcript.cacheKey)).toBeUndefined();
  });

  it('short-circuits runAgentTask and marks the usage as a cache hit', async () => {
    const cache = createTranscriptCache(join(cacheDir, 'hit'));
    const spec = buildSpec();
    const transport: LoopTransport = {
      mode: 'loop',
      id: 'fake-loop',
      capabilities: { toolInjection: 'native', structuredOutput: true },
      complete: async () => ({
        blocks: [{ type: 'text', text: 'hello' }],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'end'
      })
    };

    const first = await runAgentTask(spec, { transport, model: 'test-model', repoRoot: cacheDir, cache });
    expect(first.usage.cacheHit).toBe(false);

    const failingTransport: LoopTransport = {
      ...transport,
      complete: async () => {
        throw new Error('cache should have short-circuited the transport');
      }
    };
    const second = await runAgentTask(spec, {
      transport: failingTransport,
      model: 'test-model',
      repoRoot: cacheDir,
      cache
    });
    expect(second.usage.cacheHit).toBe(true);
    expect(second.result).toEqual({ type: 'text', text: 'hello' });
  });

  it('does not cache non-complete transcripts', async () => {
    const cache = createTranscriptCache(join(cacheDir, 'no-error-cache'));
    const spec = buildSpec();
    const transport: LoopTransport = {
      mode: 'loop',
      id: 'fake-loop',
      capabilities: { toolInjection: 'native', structuredOutput: true },
      // Always tool-calls an unknown tool → loop runs out of turns.
      complete: async () => ({
        blocks: [{ type: 'tool-call', toolCallId: 'x', name: 'read_file', args: { path: 'nope.txt' } }],
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'tool-use'
      })
    };
    const spec2 = { ...spec, tools: [] };
    const transcript = await runAgentTask(spec2, { transport, model: 'test-model', repoRoot: cacheDir, cache });
    expect(transcript.stopReason).toBe('max-turns');
    const cacheKey = computeTaskCacheKey(spec2, { transport: 'fake-loop', model: 'test-model' });
    expect(await cache.get(cacheKey)).toBeUndefined();
  });
});
