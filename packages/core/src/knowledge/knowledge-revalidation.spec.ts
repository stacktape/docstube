import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FingerprintSnapshot, KnowledgeNeed, PageEntity, PageShard } from '@docstube/contracts';
import {
  buildFixturePage,
  buildFixturePageShard,
  fingerprintSnapshotSchema,
  idPrefixes,
  knowledgeNeedSchema,
  mintId,
  pageShardSchema,
  sha256Hex
} from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import type { ManifestStore } from '../state/manifest-store.ts';
import { answerKnowledgeNeed } from './knowledge-answers.ts';
import { openKnowledgeForRun } from './knowledge-lifecycle.ts';
import { currentSubjectFingerprint, revalidateKnowledge } from './knowledge-revalidation.ts';
import { knowledgeContextFacts, knowledgeFactFragmentHash, loadKnowledgeState } from './knowledge-store.ts';
import type { KnowledgeState } from './knowledge-store.ts';

// STALENESS. A fact binds to its subject through the MATERIAL facets of the typed fingerprint
// ladder: a cosmetic refactor re-keys the symbol but leaves them intact (rebind, no re-ask), while
// a signature or cited-value change is a material change (needs-revalidation + a targeted re-ask).

let repoRoot: string;
let store: ManifestStore;
let page: PageEntity;

const SYMBOL_V1 = `ts:${sha256Hex('greet@v1')}`;
const SYMBOL_V2 = `ts:${sha256Hex('greet@v2')}`;
const printOf = (seed: string): string => sha256Hex(`print:${seed}`);

const snapshot = (symbols: Array<{ hash: string; signature: string; body: string }>): FingerprintSnapshot =>
  fingerprintSnapshotSchema.parse({
    schemaVersion: 1,
    commit: 'a'.repeat(40),
    symbols: symbols.map((symbol) => ({
      symbolHash: symbol.hash,
      signaturePrint: printOf(symbol.signature),
      valuePrints: {},
      bodyPrint: printOf(symbol.body)
    }))
  });

const atAnswerTime = snapshot([{ hash: SYMBOL_V1, signature: 'greet(name: string): string', body: 'v1' }]);
// A body-only refactor: the declaration re-hashes (new symbol identity), the signature does not.
const afterCosmeticRefactor = snapshot([{ hash: SYMBOL_V2, signature: 'greet(name: string): string', body: 'v2' }]);
// A material change: the signature itself moved.
const afterMaterialChange = snapshot([
  { hash: SYMBOL_V2, signature: 'greet(name: string, loud: boolean)', body: 'v2' }
]);

const need = (): KnowledgeNeed =>
  knowledgeNeedSchema.parse({
    schemaVersion: 1,
    needId: mintId(idPrefixes.knowledgeNeed),
    kind: 'intent-policy',
    subject: { kind: 'symbol', symbolHash: SYMBOL_V1 },
    missingFact: { kind: 'rationale', field: 'loud-option' },
    requestingPages: [],
    question: 'Why does greet take a loud option?',
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z'
  });

const answeredState = async (): Promise<KnowledgeState> => {
  const created = need();
  const result = await answerKnowledgeNeed({
    repoRoot,
    state: { needs: [created], facts: [], warnings: [] },
    needId: created.needId,
    statement: 'loud is a presentation concern.',
    origin: 'user',
    author: 'cli:ada@example.com',
    fingerprints: atAnswerTime,
    at: '2026-02-01T00:00:00.000Z'
  });
  return result.state;
};

const shardCiting = (state: KnowledgeState): PageShard => {
  const base = buildFixturePageShard(page);
  return pageShardSchema.parse({
    ...base,
    ledger: { schemaVersion: 1, pageId: page.id, sourceRevision: base.sourceCommit, claims: [] },
    provenance: {
      schemaVersion: 1,
      lineage: { models: [], prompts: [], transcripts: [], seedContext: [], observedReads: [] },
      dependencies: {
        subscriptions: [],
        consumed: knowledgeContextFacts(state).map((fact) => ({
          kind: 'knowledge-fact' as const,
          id: fact.factId,
          hash: knowledgeFactFragmentHash(fact)
        }))
      },
      claimEvidence: [],
      assessments: { reviews: [], translationFidelity: [], structural: [] }
    }
  });
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-knowledge-stale-'));
  store = createManifestStore(repoRoot, 'latest');
  page = buildFixturePage();
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('revalidateKnowledge', () => {
  it('rebinds QUIETLY across a cosmetic refactor — no staleness, no re-ask', async () => {
    const state = await answeredState();
    const result = revalidateKnowledge({ state, fingerprints: afterCosmeticRefactor });
    expect(result.stale).toEqual([]);
    expect(result.rebound).toEqual([
      { needId: state.needs[0]?.needId, fromSymbolHash: SYMBOL_V1, toSymbolHash: SYMBOL_V2 }
    ]);
    const subject = result.state.needs[0]?.subject;
    expect(subject?.kind === 'symbol' ? subject.symbolHash : undefined).toBe(SYMBOL_V2);
    expect(result.state.facts[0]?.status).toBe('active');
    expect(result.state.needs[0]?.status).toBe('answered');
    // The rebound subject now fingerprints to exactly what the fact recorded.
    expect(currentSubjectFingerprint(result.state.needs[0]!.subject, afterCosmeticRefactor)).toBe(
      result.state.facts[0]?.subjectFingerprint
    );
  });

  it('flips to needs-revalidation on a MATERIAL change and reopens the need for one re-ask', async () => {
    const state = await answeredState();
    const result = revalidateKnowledge({ state, fingerprints: afterMaterialChange });
    expect(result.rebound).toEqual([]);
    expect(result.stale).toHaveLength(1);
    expect(result.stale[0]?.reason).toContain('changed materially');
    expect(result.state.facts[0]?.status).toBe('needs-revalidation');
    expect(result.state.needs[0]?.status).toBe('open');
  });

  it('un-stales a fact whose subject came back into agreement', async () => {
    const state = await answeredState();
    const stale = revalidateKnowledge({ state, fingerprints: afterMaterialChange });
    const reverted = revalidateKnowledge({ state: stale.state, fingerprints: atAnswerTime });
    expect(reverted.revalidated).toEqual([stale.state.facts[0]?.factId]);
    expect(reverted.state.facts[0]?.status).toBe('active');
  });
});

describe('openKnowledgeForRun', () => {
  it('flags the pages CITING a fact that went stale, and nothing else', async () => {
    const state = await answeredState();
    await store.writePageShard(shardCiting(state));

    const run = await openKnowledgeForRun({
      repoRoot,
      store,
      locales: ['en'],
      pageIds: [page.id],
      fingerprints: afterMaterialChange,
      runId: mintId(idPrefixes.run)
    });
    const shard = await store.readPageShard({ locale: 'en', pageId: page.id });
    const raised = shard?.flags.filter((flag) => flag.kind === 'tribal-knowledge' && flag.status === 'open') ?? [];
    expect(raised).toHaveLength(1);
    expect(raised[0]?.needId).toBe(state.needs[0]?.needId);
    expect(raised[0]?.summary).toContain('re-check answer');
    expect(run.warnings.some((warning) => warning.includes('needs revalidation'))).toBe(true);
    // The stale fact is still offered to the writer, labelled — not silently withheld.
    expect(run.session.contextFacts()[0]?.stale).toBe(true);
    // Its dependency hash moved, so the citing page regenerates.
    expect(run.dirtyPageIds.has(page.id)).toBe(true);

    const stored = await loadKnowledgeState(repoRoot);
    expect(stored.facts[0]?.status).toBe('needs-revalidation');
  });

  it('raises nothing for a cosmetic refactor', async () => {
    const state = await answeredState();
    await store.writePageShard(shardCiting(state));

    const run = await openKnowledgeForRun({
      repoRoot,
      store,
      locales: ['en'],
      pageIds: [page.id],
      fingerprints: afterCosmeticRefactor,
      runId: mintId(idPrefixes.run)
    });
    const shard = await store.readPageShard({ locale: 'en', pageId: page.id });
    expect(shard?.flags.filter((flag) => flag.status === 'open')).toHaveLength(0);
    expect(run.dirtyPageIds.has(page.id)).toBe(false);
    expect(run.session.contextFacts()[0]?.stale).toBe(false);
  });
});
