import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentTaskSpecSchema, computeTaskCacheKey, idPrefixes, mintId, transcriptSchema } from '@docstube/contracts';
import type { AgentTaskSpec, Transcript } from '@docstube/contracts';
import { ReplayMismatchError } from '../errors.ts';
import { runAgentTask } from '../harness.ts';
import type { LoopTransport } from '../transport.ts';
import { createReplayTransport, recordingWrapper, replayFixtureFileName, sanitizeTranscript } from './replay.ts';

let baseDir: string;

beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'docstube-replay-'));
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

const buildSpec = (userPrompt = 'Write the retry page.'): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'write-page',
    systemPrompt: 'system',
    userPrompt,
    tools: [],
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 4, maxToolCalls: 8 },
    output: { type: 'mdx' }
  });

const buildTranscript = (spec: AgentTaskSpec, cacheKey: string, mdx = '# Retry'): Transcript =>
  transcriptSchema.parse({
    schemaVersion: 1,
    taskId: spec.id,
    cacheKey,
    transport: 'replay',
    model: 'test-model',
    turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
    observedReads: [{ file: 'src/retry.ts', contentHash: '1'.repeat(64) }],
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: 'complete',
    result: { type: 'mdx', mdx }
  });

describe('replay transport', () => {
  it('matches a fixture by cache key and re-stamps the current task id', async () => {
    const dir = join(baseDir, 'by-cache-key');
    await mkdir(dir, { recursive: true });
    const spec = buildSpec();
    const cacheKey = computeTaskCacheKey(spec, { transport: 'replay', model: 'test-model' });
    const fixture = buildTranscript({ ...spec, id: mintId(idPrefixes.task) }, cacheKey);
    await writeFile(join(dir, 'anything.json'), JSON.stringify(fixture), 'utf8');

    const transcript = await runAgentTask(spec, {
      transport: createReplayTransport(dir),
      model: 'test-model',
      repoRoot: dir
    });

    expect(transcript.taskId).toBe(spec.id);
    expect(transcript.result).toEqual({ type: 'mdx', mdx: '# Retry' });
  });

  it('falls back to the (kind, userPrompt-hash) filename convention', async () => {
    const dir = join(baseDir, 'by-filename');
    await mkdir(dir, { recursive: true });
    const spec = buildSpec('A prompt recorded under a different model.');
    // Different model → different cacheKey, so only the filename can match.
    const fixture = buildTranscript(spec, '0'.repeat(64), '# Fallback');
    await writeFile(join(dir, replayFixtureFileName(spec)), JSON.stringify(fixture), 'utf8');

    const transcript = await runAgentTask(spec, {
      transport: createReplayTransport(dir),
      model: 'other-model',
      repoRoot: dir
    });
    expect(transcript.result).toEqual({ type: 'mdx', mdx: '# Fallback' });
  });

  it('fails with a mismatch error that lists the available fixtures', async () => {
    const dir = join(baseDir, 'mismatch');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'review-page.aaaa.json'), '{}', 'utf8');
    const spec = buildSpec('Nothing recorded for this.');

    await expect(
      runAgentTask(spec, { transport: createReplayTransport(dir), model: 'test-model', repoRoot: dir })
    ).rejects.toThrow(ReplayMismatchError);
    await expect(
      runAgentTask(spec, { transport: createReplayTransport(dir), model: 'test-model', repoRoot: dir })
    ).rejects.toThrow('review-page.aaaa.json');
  });
});

describe('recording', () => {
  it('sanitizeTranscript strips absolute repo paths to repo-relative POSIX', () => {
    const spec = buildSpec();
    const repoRoot = 'C:\\work\\my-repo';
    const transcript = transcriptSchema.parse({
      ...buildTranscript(spec, '2'.repeat(64)),
      turns: [
        {
          role: 'assistant',
          blocks: [{ type: 'text', text: 'Read C:\\work\\my-repo\\src\\retry.ts and C:/work/my-repo/src/other.ts.' }]
        }
      ]
    });
    const sanitized = sanitizeTranscript(transcript, repoRoot);
    const text = sanitized.turns[0]?.blocks[0];
    expect(text && 'text' in text ? text.text : '').toBe('Read src/retry.ts and src/other.ts.');
  });

  it('recordingWrapper persists a sanitized fixture after a live run', async () => {
    const fixturesDir = join(baseDir, 'recorded');
    const repoRoot = join(baseDir, 'fake-repo');
    await mkdir(repoRoot, { recursive: true });
    const spec = buildSpec('Record me.');
    const inner: LoopTransport = {
      mode: 'loop',
      id: 'fake-loop',
      capabilities: { toolInjection: 'native', structuredOutput: true },
      complete: async () => ({
        blocks: [{ type: 'text', text: `# Docs\n\nGenerated from ${repoRoot}\\src\\a.ts` }],
        usage: { inputTokens: 5, outputTokens: 5 },
        stopReason: 'end'
      })
    };

    await runAgentTask(spec, { transport: recordingWrapper(inner, fixturesDir), model: 'test-model', repoRoot });

    const recorded = JSON.parse(await readFile(join(fixturesDir, replayFixtureFileName(spec)), 'utf8')) as Transcript;
    expect(transcriptSchema.parse(recorded).stopReason).toBe('complete');
    const block = recorded.turns[0]?.blocks[0];
    const text = block && 'text' in block ? String(block.text) : '';
    expect(text).toContain('src/a.ts');
    expect(text).not.toContain(repoRoot);

    // The recorded fixture replays for the identical task input.
    const replayed = await runAgentTask(spec, {
      transport: createReplayTransport(fixturesDir),
      model: 'test-model',
      repoRoot
    });
    expect(replayed.result).toEqual({ type: 'mdx', mdx: '# Docs\n\nGenerated from src/a.ts' });
  });
});
