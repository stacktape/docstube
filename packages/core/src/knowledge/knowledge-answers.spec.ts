import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KnowledgeNeed, PageEntity, PageShard } from '@docstube/contracts';
import {
  buildFixturePage,
  buildFixturePageShard,
  idPrefixes,
  knowledgeNeedSchema,
  mintId,
  pageShardSchema,
  sha256Hex
} from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import type { ManifestStore } from '../state/manifest-store.ts';
import {
  answerKnowledgeNeed,
  applyFlagAnswers,
  knowledgeDirtyPages,
  reconcileKnowledgePropagation
} from './knowledge-answers.ts';
import { knowledgeContextFacts, knowledgeFactFragmentHash, loadKnowledgeState } from './knowledge-store.ts';
import type { KnowledgeState } from './knowledge-store.ts';

// ANSWERS ARE ADDITIVE and they PROPAGATE. The old store overwrote the previous answer with no
// author, timestamp, or history, and nothing connected an answer to the pages that had consumed it.

let repoRoot: string;
let store: ManifestStore;
let askingPage: PageEntity;
let bystanderPage: PageEntity;

const emptyState = (): KnowledgeState => ({ needs: [], facts: [], warnings: [] });

const makeNeed = (pageIds: string[]): KnowledgeNeed =>
  knowledgeNeedSchema.parse({
    schemaVersion: 1,
    needId: mintId(idPrefixes.knowledgeNeed),
    kind: 'intent-policy',
    subject: { kind: 'symbol', symbolHash: `ts:${sha256Hex('greet')}` },
    missingFact: { kind: 'rationale', field: 'loud-option' },
    requestingPages: pageIds,
    question: 'Why does greet take a loud option?',
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z'
  });

const shardWithConsumedFacts = (page: PageEntity, consumed: Array<{ id: string; hash: string }>): PageShard => {
  const base = buildFixturePageShard(page);
  return pageShardSchema.parse({
    ...base,
    ledger: { schemaVersion: 1, pageId: page.id, sourceRevision: base.sourceCommit, claims: [] },
    provenance: {
      schemaVersion: 1,
      lineage: { models: [], prompts: [], transcripts: [], seedContext: [], observedReads: [] },
      dependencies: {
        subscriptions: [],
        consumed: consumed.map((entry) => ({ kind: 'knowledge-fact' as const, id: entry.id, hash: entry.hash }))
      },
      claimEvidence: [],
      assessments: { reviews: [], translationFidelity: [], structural: [] }
    }
  });
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-knowledge-answers-'));
  store = createManifestStore(repoRoot, 'latest');
  askingPage = buildFixturePage();
  bystanderPage = { ...buildFixturePage(), id: mintId(idPrefixes.page), slug: 'other' };
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('answerKnowledgeNeed', () => {
  it('SUPERSEDES rather than overwrites — both facts retained, ordered, each with its own author', async () => {
    const need = makeNeed([askingPage.id]);
    let state: KnowledgeState = { ...emptyState(), needs: [need] };

    const first = await answerKnowledgeNeed({
      repoRoot,
      state,
      needId: need.needId,
      statement: 'A separate shout() felt like API bloat.',
      origin: 'user',
      author: 'cli:ada@example.com',
      at: '2026-02-01T00:00:00.000Z'
    });
    state = first.state;
    const second = await answerKnowledgeNeed({
      repoRoot,
      state,
      needId: need.needId,
      statement: 'Superseded: loud is now a presentation concern owned by the renderer.',
      origin: 'user',
      author: 'cli:grace@example.com',
      at: '2026-05-01T00:00:00.000Z'
    });

    const stored = await loadKnowledgeState(repoRoot);
    expect(stored.facts).toHaveLength(2);
    const [older, newer] = stored.facts;
    expect(older?.factId).toBe(first.fact.factId);
    expect(older?.status).toBe('superseded');
    // The previous answer keeps its OWN author and timestamp — that is the history.
    expect(older?.author).toBe('cli:ada@example.com');
    expect(older?.answeredAt).toBe('2026-02-01T00:00:00.000Z');
    expect(newer?.factId).toBe(second.fact.factId);
    expect(newer?.supersedes).toBe(first.fact.factId);
    expect(newer?.author).toBe('cli:grace@example.com');
    expect(second.supersededFactId).toBe(first.fact.factId);
    // Only the standing answer is writer context.
    expect(knowledgeContextFacts(stored).map((entry) => entry.factId)).toEqual([second.fact.factId]);
    expect(stored.needs[0]?.status).toBe('answered');
  });

  it('starts a new fact at propagation "answered"', async () => {
    const need = makeNeed([askingPage.id]);
    const result = await answerKnowledgeNeed({
      repoRoot,
      state: { ...emptyState(), needs: [need] },
      needId: need.needId,
      statement: 'Because of a downstream consumer.',
      origin: 'user',
      author: 'cli:ada@example.com'
    });
    expect(result.fact.propagation).toBe('answered');
    expect(result.fact.status).toBe('active');
  });
});

describe('propagation', () => {
  it('marks EXACTLY the consuming pages dirty and moves the fact answered → pending → applied', async () => {
    const need = makeNeed([askingPage.id]);
    // A bystander page consumes no knowledge at all; it must never be dragged into a regeneration.
    await store.writePageShard(shardWithConsumedFacts(askingPage, []));
    await store.writePageShard(shardWithConsumedFacts(bystanderPage, []));
    const pageIds = [askingPage.id, bystanderPage.id];

    const answered = await answerKnowledgeNeed({
      repoRoot,
      state: { ...emptyState(), needs: [need] },
      needId: need.needId,
      statement: 'loud is a presentation concern.',
      origin: 'user',
      author: 'cli:ada@example.com'
    });

    const pending = await reconcileKnowledgePropagation({
      repoRoot,
      store,
      locales: ['en'],
      pageIds,
      state: answered.state
    });
    expect([...pending.dirty.pageIds]).toEqual([askingPage.id]);
    expect(pending.state.facts[0]?.propagation).toBe('propagation-pending');

    // The asking page regenerates and records the fact as a consumed dependency.
    const context = knowledgeContextFacts(pending.state);
    await store.writePageShard(
      shardWithConsumedFacts(
        askingPage,
        context.map((fact) => ({ id: fact.factId, hash: knowledgeFactFragmentHash(fact) }))
      )
    );
    const applied = await reconcileKnowledgePropagation({
      repoRoot,
      store,
      locales: ['en'],
      pageIds,
      state: pending.state
    });
    expect([...applied.dirty.pageIds]).toEqual([]);
    expect(applied.state.facts[0]?.propagation).toBe('applied');
  });

  it('a superseded answer makes exactly the pages citing it dirty', async () => {
    const need = makeNeed([]);
    let state: KnowledgeState = { ...emptyState(), needs: [need] };
    const first = await answerKnowledgeNeed({
      repoRoot,
      state,
      needId: need.needId,
      statement: 'The original answer.',
      origin: 'user',
      author: 'cli:ada@example.com'
    });
    state = first.state;
    const citing = knowledgeContextFacts(state);
    await store.writePageShard(
      shardWithConsumedFacts(
        askingPage,
        citing.map((fact) => ({ id: fact.factId, hash: knowledgeFactFragmentHash(fact) }))
      )
    );
    await store.writePageShard(shardWithConsumedFacts(bystanderPage, []));

    const second = await answerKnowledgeNeed({
      repoRoot,
      state,
      needId: need.needId,
      statement: 'The corrected answer.',
      origin: 'user',
      author: 'cli:grace@example.com'
    });
    const dirty = await knowledgeDirtyPages({
      store,
      locales: ['en'],
      pageIds: [askingPage.id, bystanderPage.id],
      state: second.state
    });
    expect([...dirty.pageIds]).toEqual([askingPage.id]);
    // Attributed to the answer that replaced it, so the CLI can say "N pages regenerating".
    expect(dirty.byFact.get(second.fact.factId)).toEqual([askingPage.id]);
  });
});

describe('applyFlagAnswers', () => {
  it('commits an answered flag as a KnowledgeFact and resolves every flag for that need', async () => {
    const need = makeNeed([askingPage.id, bystanderPage.id]);
    const state: KnowledgeState = { ...emptyState(), needs: [need] };
    const flagOn = (page: PageEntity, status: 'open' | 'answered') => ({
      id: mintId(idPrefixes.flag),
      kind: 'tribal-knowledge' as const,
      status,
      summary: 'writer question: why loud?',
      question: need.question,
      needId: need.needId,
      entity: { version: 'latest', locale: 'en', pageId: page.id },
      createdAt: '2026-01-01T00:00:00.000Z',
      ...(status === 'answered'
        ? {
            answer: {
              text: 'loud is a presentation concern.',
              answeredAt: '2026-02-01T00:00:00.000Z',
              author: 'cli:ada@example.com'
            }
          }
        : {})
    });
    await store.writePageShard({ ...shardWithConsumedFacts(askingPage, []), flags: [flagOn(askingPage, 'answered')] });
    await store.writePageShard({
      ...shardWithConsumedFacts(bystanderPage, []),
      flags: [flagOn(bystanderPage, 'open')]
    });

    const result = await applyFlagAnswers({
      repoRoot,
      store,
      locales: ['en'],
      pageIds: [askingPage.id, bystanderPage.id],
      state
    });
    expect(result.applied).toBe(1);
    expect(result.answers[0]?.pageIds.toSorted()).toEqual([askingPage.id, bystanderPage.id].toSorted());

    const stored = await loadKnowledgeState(repoRoot);
    expect(stored.facts).toHaveLength(1);
    expect(stored.facts[0]?.author).toBe('cli:ada@example.com');
    expect(stored.facts[0]?.answeredAt).toBe('2026-02-01T00:00:00.000Z');
    // One need, one answer: the flag on the OTHER page resolves too.
    for (const pageId of [askingPage.id, bystanderPage.id]) {
      const shard = await store.readPageShard({ locale: 'en', pageId });
      expect(shard?.flags[0]?.status).toBe('resolved');
    }
  });

  it('still answers a flag raised before needs existed — the queue never goes dead', async () => {
    await store.writePageShard({
      ...shardWithConsumedFacts(askingPage, []),
      flags: [
        {
          id: mintId(idPrefixes.flag),
          kind: 'tribal-knowledge',
          status: 'answered',
          summary: 'writer question: why loud?',
          question: 'Why does greet take a loud option?',
          entity: { version: 'latest', locale: 'en', pageId: askingPage.id },
          createdAt: '2026-01-01T00:00:00.000Z',
          answer: { text: 'API bloat.', answeredAt: '2026-02-01T00:00:00.000Z', author: 'cli:ada@example.com' }
        }
      ]
    });
    const result = await applyFlagAnswers({
      repoRoot,
      store,
      locales: ['en'],
      pageIds: [askingPage.id],
      state: emptyState()
    });
    expect(result.applied).toBe(1);
    const stored = await loadKnowledgeState(repoRoot);
    expect(stored.needs).toHaveLength(1);
    expect(stored.needs[0]?.status).toBe('answered');
    expect(stored.facts[0]?.statement).toBe('API bloat.');
    const shard = await store.readPageShard({ locale: 'en', pageId: askingPage.id });
    expect(shard?.flags[0]?.status).toBe('resolved');
    expect(shard?.flags[0]?.needId).toBe(stored.needs[0]?.needId);
  });
});
