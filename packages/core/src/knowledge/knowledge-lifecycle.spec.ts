import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { cleanRiskCriticTranscript } from '../pipeline/risk-critic-test-support.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Flag, Transcript } from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { runGenerate } from '../pipeline/generate.ts';
import type { TaskToolImplementation } from '../pipeline/page-runner.ts';
import { loadKnowledgeState } from './knowledge-store.ts';

// The full tribal-knowledge lifecycle through the real pipeline (PRODUCT §3.10): the writer asks
// through the harness tool (non-blocking), each question becomes a KnowledgeNeed plus one queue
// flag, a human answer becomes a committed KnowledgeFact, and the answer is injected into every
// later writer prompt instead of being asked again.

let repoRoot: string;

type Ask = { question: string; subject?: string };

// Two subjects, one question shape. Under the shipped question-text-hash store these merged and
// the second subject was never asked about.
const greetAsk: Ask = {
  question: 'Why does greet accept a loud option instead of exposing a separate shout helper function?',
  subject: 'greet'
};
const farewellAsk: Ask = {
  question: 'Why does farewell accept a loud option instead of exposing a separate shout helper function?',
  subject: 'farewell'
};

const mdx = `---
title: Getting started
description: Greet.
---

# Getting started

The \`greet\` function greets people.
`;

const runWith = async (options: { asks?: Ask[]; onWritePrompt?: (spec: AgentTaskSpec) => void } = {}) => {
  const asks = options.asks ?? [greetAsk];
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
    if (spec.kind === 'assess-page-risk') {
      return cleanRiskCriticTranscript(spec);
    }
    if (spec.kind === 'review-page') {
      return {
        ...base,
        result: { type: 'structured', value: { persona: 'app-developer', criteria: [], findings: [] } }
      };
    }
    options.onWritePrompt?.(spec);
    // The scripted writer always asks; ask-once must come from the kernel, not agent cooperation.
    const flagQuestion = extraTools?.find((tool) => tool.descriptor.name === 'flag_question');
    expect(spec.tools.some((tool) => tool.name === 'flag_question')).toBe(true);
    for (const ask of asks) {
      await flagQuestion?.handler(ask);
    }
    return { ...base, result: { type: 'mdx-ledger', mdx, ledger: { schemaVersion: 1, claims: [] } } };
  };
  return runGenerate({ repoRoot, runTask, toolDescriptors: [] });
};

const readShard = async () => {
  const store = createManifestStore(repoRoot, 'latest');
  const index = await store.readIndex();
  return store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
};

const openQuestions = async (): Promise<Flag[]> =>
  ((await readShard())?.flags ?? []).filter((flag) => flag.kind === 'tribal-knowledge' && flag.status === 'open');

const answerFlag = async (flag: Flag, text: string) => {
  const store = createManifestStore(repoRoot, 'latest');
  const shard = (await readShard())!;
  await store.writePageShard({
    ...shard,
    flags: shard.flags.map((candidate) =>
      candidate.id === flag.id
        ? {
            ...candidate,
            status: 'answered' as const,
            answer: { text, answeredAt: new Date().toISOString(), author: 'cli:ada@example.com' }
          }
        : candidate
    )
  });
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-knowledge-run-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(
    join(repoRoot, 'src', 'greeter.ts'),
    'export const greet = (name: string): string => `Hello, ${name}`;\n' +
      'export const farewell = (name: string): string => `Bye, ${name}`;\n'
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

describe('knowledge lifecycle', () => {
  it('captures a question as one need and one flag without blocking the page, deduped across runs', async () => {
    const first = await runWith();
    expect(first.pages[0]?.status).toBe('passed');
    expect(first.outcome).toBe('flagged');

    let flags = await openQuestions();
    expect(flags).toHaveLength(1);
    expect(flags[0]?.question).toBe(greetAsk.question);
    expect(flags[0]?.needId).toMatch(/^kn_/u);
    expect(flags[0]?.subjectSymbol).toMatch(/^ts:[0-9a-f]{64}$/u);

    const state = await loadKnowledgeState(repoRoot);
    expect(state.needs).toHaveLength(1);
    expect(state.needs[0]?.subject).toMatchObject({ kind: 'symbol' });
    expect(state.needs[0]?.requestingPages).toHaveLength(1);

    // Second run: the writer asks again (and rewords), the kernel refuses to duplicate the need.
    await runWith({
      asks: [
        { subject: 'greet', question: 'What made a loud option on greet preferable to a separate shout function?' }
      ]
    });
    flags = await openQuestions();
    expect(flags).toHaveLength(1);
    expect((await loadKnowledgeState(repoRoot)).needs).toHaveLength(1);
  }, 60_000);

  it('TWO SUBJECTS asking near-identical questions both survive', async () => {
    await runWith({ asks: [greetAsk, farewellAsk] });
    const flags = await openQuestions();
    expect(flags.map((flag) => flag.question).toSorted()).toEqual([greetAsk.question, farewellAsk.question].toSorted());
    const state = await loadKnowledgeState(repoRoot);
    expect(state.needs).toHaveLength(2);
    expect(new Set(state.needs.map((need) => JSON.stringify(need.subject))).size).toBe(2);
  }, 60_000);

  it('commits an answer as a KnowledgeFact, injects it, and never re-asks it', async () => {
    await runWith();
    const [flag] = await openQuestions();
    await answerFlag(flag!, 'A separate shout() felt like API bloat; loud is a presentation concern.');

    const prompts: string[] = [];
    const third = await runWith({ onWritePrompt: (spec) => prompts.push(spec.systemPrompt) });

    const state = await loadKnowledgeState(repoRoot);
    expect(state.facts).toHaveLength(1);
    expect(state.facts[0]).toMatchObject({
      origin: 'user',
      author: 'cli:ada@example.com',
      status: 'active'
    });
    expect(state.facts[0]?.subjectFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(state.needs[0]?.status).toBe('answered');
    expect(await readdir(join(repoRoot, '.docstube', 'knowledge', 'facts'))).toEqual([
      `${state.facts[0]?.factId}.json`
    ]);

    expect(prompts[0]).toContain('API bloat');
    expect(await openQuestions()).toHaveLength(0);
    expect(third.outcome).toBe('passed');
  }, 60_000);

  it('a paraphrase of an ANSWERED question about a DIFFERENT subject still gets asked', async () => {
    await runWith();
    const [flag] = await openQuestions();
    await answerFlag(flag!, 'loud is a presentation concern.');

    // Same shape of question, other symbol: the shipped store suppressed this indefinitely.
    await runWith({ asks: [greetAsk, farewellAsk] });

    const flags = await openQuestions();
    expect(flags).toHaveLength(1);
    expect(flags[0]?.question).toBe(farewellAsk.question);
    const state = await loadKnowledgeState(repoRoot);
    expect(state.needs).toHaveLength(2);
    expect(state.facts).toHaveLength(1);
  }, 60_000);

  it('warns about pre-KnowledgeFact `.md` answers instead of crashing or silently loading them', async () => {
    await mkdir(join(repoRoot, '.docstube', 'knowledge'), { recursive: true });
    await writeFile(
      join(repoRoot, '.docstube', 'knowledge', '4005d31a5b7086bd.md'),
      '---\nquestion: Why?\n---\n\nBecause.\n',
      'utf8'
    );
    const summary = await runWith();
    expect(summary.pages[0]?.status).toBe('passed');
    expect(summary.warnings.some((warning) => warning.includes('4005d31a5b7086bd.md'))).toBe(true);
  }, 60_000);
});
