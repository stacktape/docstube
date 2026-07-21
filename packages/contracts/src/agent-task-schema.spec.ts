import { describe, expect, it } from 'vitest';
import type { AgentTaskSpec } from './agent-task-schema.ts';
import { agentTaskSpecSchema, computeTaskCacheKey, transcriptSchema } from './agent-task-schema.ts';
import { idPrefixes, mintId } from './primitives.ts';

const buildSpec = (): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'write-page',
    systemPrompt: 'You write verified documentation.',
    userPrompt: 'Write the installation page.',
    tools: [{ name: 'read_file', description: 'Read a repo file', paramsJsonSchema: { type: 'object' } }],
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 8, maxToolCalls: 32 },
    output: { type: 'mdx' }
  });

describe('task cache key', () => {
  it('ignores the minted task id', () => {
    const a = buildSpec();
    const b = { ...a, id: mintId(idPrefixes.task) };
    const context = { transport: 'replay', model: 'test-model' };
    expect(computeTaskCacheKey(a, context)).toBe(computeTaskCacheKey(b, context));
  });

  it('changes when prompts, model, or context hashes change', () => {
    const spec = buildSpec();
    const base = computeTaskCacheKey(spec, { transport: 'replay', model: 'test-model' });
    expect(
      computeTaskCacheKey({ ...spec, userPrompt: 'other' }, { transport: 'replay', model: 'test-model' })
    ).not.toBe(base);
    expect(computeTaskCacheKey(spec, { transport: 'replay', model: 'other-model' })).not.toBe(base);
    expect(
      computeTaskCacheKey(spec, { transport: 'replay', model: 'test-model', contextHashes: { codemap: 'abc' } })
    ).not.toBe(base);
  });
});

describe('transcript schema', () => {
  it('parses a complete transcript with observed reads', () => {
    const spec = buildSpec();
    const transcript = transcriptSchema.parse({
      schemaVersion: 1,
      taskId: spec.id,
      cacheKey: computeTaskCacheKey(spec, { transport: 'replay', model: 'test-model' }),
      transport: 'replay',
      model: 'test-model',
      turns: [
        {
          role: 'assistant',
          blocks: [{ type: 'tool-call', toolCallId: 't1', name: 'read_file', args: { path: 'src/cli.ts' } }]
        },
        { role: 'tool', blocks: [{ type: 'tool-result', toolCallId: 't1', result: 'file contents' }] },
        { role: 'assistant', blocks: [{ type: 'text', text: '# Installation' }] }
      ],
      observedReads: [{ file: 'src/cli.ts', contentHash: '2'.repeat(64) }],
      usage: { inputTokens: 100, outputTokens: 50 },
      stopReason: 'complete',
      result: { type: 'mdx', mdx: '# Installation' }
    });
    expect(transcript.observedReads).toHaveLength(1);
    expect(transcript.turns[1]?.blocks[0]?.type).toBe('tool-result');
  });

  it('parses an mdx-ledger result and validates the embedded writer ledger', () => {
    const result = {
      type: 'mdx-ledger',
      mdx: '# Retry\n\n<Claim id="c1">`retries` defaults to 3.</Claim>\n',
      ledger: {
        schemaVersion: 1,
        claims: [{ markerId: 'c1', class: 'value', predicate: 'retries defaults to 3' }]
      }
    };
    const spec = buildSpec();
    const transcript = transcriptSchema.parse({
      schemaVersion: 1,
      taskId: spec.id,
      cacheKey: 'k',
      transport: 'replay',
      model: 'test-model',
      turns: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'complete',
      result
    });
    expect(transcript.result?.type).toBe('mdx-ledger');
    // Kernel-owned fields inside a writer ledger claim are rejected at the transcript boundary.
    const smuggled = {
      ...result,
      ledger: {
        schemaVersion: 1,
        claims: [{ markerId: 'c1', class: 'value', predicate: 'p', correctness: 'checked' }]
      }
    };
    expect(() => transcriptSchema.parse({ ...transcript, result: smuggled })).toThrow();
  });
});
