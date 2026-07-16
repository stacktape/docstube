import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Transcript } from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { runGenerate } from './generate.ts';
import type { TaskToolImplementation } from './page-runner.ts';
import { questionKey } from './tribal-knowledge.ts';

// The full tribal-knowledge lifecycle (PRODUCT §4.1): the writer asks through the harness tool
// (non-blocking), the question becomes exactly one open flag (ask-once), a human answer becomes
// committed knowledge, and the answer is injected into every later writer prompt.

let repoRoot: string;

const theQuestion = 'Why was the loud option added to greet instead of a separate shout function?';

const mdx = `---
title: Getting started
description: Greet.
---

# Getting started

The \`greet\` function greets people.
`;

const runWith = async (onWritePrompt?: (spec: AgentTaskSpec) => void) => {
  const runTask = async (spec: AgentTaskSpec, extraTools?: TaskToolImplementation[]): Promise<Transcript> => {
    const base: Omit<Transcript, 'result'> = {
      schemaVersion: 1,
      taskId: spec.id,
      cacheKey: 'test',
      transport: 'replay',
      model: 'scripted',
      turns: [],
      observedReads: [],
      usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
      stopReason: 'complete'
    };
    if (spec.kind === 'audit-extract-claims') {
      return { ...base, result: { type: 'structured', value: { claims: [] } } };
    }
    if (spec.kind === 'review-page') {
      return {
        ...base,
        result: {
          type: 'structured',
          value: { persona: 'app-developer', criteria: [], findings: [] }
        }
      };
    }
    onWritePrompt?.(spec);
    // The scripted writer always asks its question — ask-once must come from the kernel, not
    // from agent cooperation.
    const flagQuestion = extraTools?.find((tool) => tool.descriptor.name === 'flag_question');
    expect(spec.tools.some((tool) => tool.name === 'flag_question')).toBe(true);
    if (flagQuestion) {
      const response = (await flagQuestion.handler({ question: theQuestion, subject: 'greet' })) as {
        recorded: boolean;
      };
      expect(response.recorded).toBe(true);
    }
    return { ...base, result: { type: 'mdx', mdx } };
  };
  return runGenerate({ repoRoot, runTask, toolDescriptors: [] });
};

const readShard = async () => {
  const store = createManifestStore(repoRoot, 'latest');
  const index = await store.readIndex();
  return store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-tribal-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(
    join(repoRoot, 'src', 'greeter.ts'),
    'export const greet = (name: string): string => `Hello, ${name}`;\n'
  );
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'greeter', type: 'module' }));
  await writeFile(
    join(repoRoot, 'docstube.yml'),
    'schemaVersion: 1\ndocType: external-library\npersonas:\n  - id: app-developer\n    description: Builds apps\nsite:\n  title: Greeter\n'
  );
  await writeFile(
    join(repoRoot, 'ia.yml'),
    'schemaVersion: 1\ntree:\n  - title: Getting started\n    slug: getting-started\n    brief: Greet someone.\n'
  );
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('tribal-knowledge lifecycle', () => {
  it('captures the question as one open flag without blocking the page, deduped across runs', async () => {
    const first = await runWith();
    // Non-blocking: the page ships; the run surfaces the open flag.
    expect(first.pages[0]?.status).toBe('passed');
    expect(first.outcome).toBe('flagged');

    let shard = await readShard();
    const tribalFlags = shard?.flags.filter((flag) => flag.kind === 'tribal-knowledge') ?? [];
    expect(tribalFlags).toHaveLength(1);
    expect(tribalFlags[0]?.question).toBe(theQuestion);
    // Subject "greet" resolved to the symbol hash (durable per-symbol context key).
    expect(tribalFlags[0]?.subjectSymbol).toMatch(/^ts:[0-9a-f]{64}$/);

    // Second run: the writer asks again, the kernel refuses to duplicate the open flag.
    await runWith();
    shard = await readShard();
    expect(shard?.flags.filter((flag) => flag.kind === 'tribal-knowledge')).toHaveLength(1);
  }, 60_000);

  it('persists a human answer to the knowledge store and injects it into later prompts', async () => {
    await runWith();
    const store = createManifestStore(repoRoot, 'latest');
    const shard = await readShard();
    const flag = shard?.flags.find((candidate) => candidate.kind === 'tribal-knowledge');
    expect(flag).toBeDefined();

    // The human answers (flag queue / shard edit / digest issue — all end up here).
    await store.writePageShard({
      ...shard!,
      flags: shard!.flags.map((candidate) =>
        candidate.id === flag!.id
          ? {
              ...candidate,
              status: 'answered' as const,
              answer: {
                text: 'A separate shout() felt like API bloat; loud is a presentation concern.',
                answeredAt: new Date().toISOString()
              }
            }
          : candidate
      )
    });

    const prompts: string[] = [];
    const third = await runWith((spec) => prompts.push(spec.systemPrompt));

    // Answer committed as durable knowledge, keyed by the normalized question.
    const files = await readdir(join(repoRoot, '.docstube', 'knowledge'));
    expect(files).toContain(`${questionKey(theQuestion)}.md`);
    const stored = await readFile(join(repoRoot, '.docstube', 'knowledge', files[0] ?? ''), 'utf8');
    expect(stored).toContain('API bloat');

    // Injected into the writer prompt; the re-asked question raises no new flag.
    expect(prompts[0]).toContain('API bloat');
    const finalShard = await readShard();
    const finalTribal = finalShard?.flags.filter((candidate) => candidate.kind === 'tribal-knowledge') ?? [];
    expect(finalTribal).toHaveLength(1);
    expect(finalTribal[0]?.status).toBe('resolved');
    // Answered knowledge means the run is clean again.
    expect(third.outcome).toBe('passed');
  }, 60_000);
});
