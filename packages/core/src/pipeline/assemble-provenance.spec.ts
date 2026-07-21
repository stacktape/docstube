import { describe, expect, it } from 'vitest';
import {
  claimEvidenceSchema,
  claimLedgerSchema,
  contentHash,
  docstubeConfigSchema,
  glossarySchema,
  hashValue,
  pageEntitySchema,
  transcriptSchema
} from '@docstube/contracts';
import type { AgentTaskSpec, ClaimEvidence, ClaimLedger, PageEntity } from '@docstube/contracts';
import { assembleProvenanceV2 } from './assemble-provenance.ts';

const COMMIT = 'a'.repeat(40);
const CLAIM_A = `cl_${'1'.repeat(20)}`;
const CLAIM_B = `cl_${'2'.repeat(20)}`;
const BLOCK = `bl_${'3'.repeat(20)}`;
const PAGE = `pg_${'4'.repeat(20)}`;
const HASH = '5'.repeat(64);

const subscription = { kind: 'file-content', file: 'src/retry.ts', contentHash: HASH };

const emptyProvenance = { sources: [], seedContext: [], observedReads: [], verifications: [], reviews: [] };

// The page the ledger anchors into: BLOCK is a real block of PAGE (the commit validator proves
// ledger↔page linkage).
const page: PageEntity = pageEntitySchema.parse({
  id: PAGE,
  kind: 'page',
  slug: 'retry',
  title: 'Retry',
  preamble: [
    {
      id: BLOCK,
      kind: 'block',
      blockType: 'paragraph',
      contentHash: HASH,
      guarantee: 'scored',
      provenance: emptyProvenance
    }
  ],
  sections: [],
  guarantee: 'scored',
  provenance: emptyProvenance
});

const ledger = claimLedgerSchema.parse({
  schemaVersion: 1,
  pageId: PAGE,
  sourceRevision: COMMIT,
  claims: [CLAIM_A, CLAIM_B].map((claimId) => ({
    claimId,
    class: 'code-structure',
    predicate: 'greet exists',
    anchor: { blockId: BLOCK, markerId: claimId.slice(-2) },
    quote: 'greet exists',
    scope: { entityId: BLOCK, revision: HASH },
    // Both claims share ONE dependency — assembly must dedupe it to a single invalidation edge.
    subscriptions: [subscription],
    evidence: [],
    correctness: 'unchecked',
    disposition: 'no-checker-available'
  }))
});

const claimEvidence = [CLAIM_A, CLAIM_B].map((claimId) =>
  claimEvidenceSchema.parse({
    schemaVersion: 1,
    claimId,
    class: 'code-structure',
    correctness: 'unchecked',
    disposition: 'no-checker-available',
    evidence: []
  })
);

const transcript = transcriptSchema.parse({
  schemaVersion: 1,
  taskId: `tk_${'6'.repeat(20)}`,
  cacheKey: 'test',
  transport: 'replay',
  model: 'scripted-writer',
  turns: [],
  observedReads: [{ file: 'src/retry.ts', contentHash: HASH }],
  usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
  stopReason: 'complete'
});

const writeTask = { systemPrompt: 'system prompt text', userPrompt: 'user prompt text' } as AgentTaskSpec;

const config = docstubeConfigSchema.parse({
  schemaVersion: 1,
  docType: 'external-library',
  personas: [{ id: 'app-developer', description: 'Builds apps' }],
  site: { title: 'Docs' }
});

const glossary = glossarySchema.parse({
  schemaVersion: 1,
  terms: [{ term: 'shard', definition: 'a per-page manifest file' }]
});

const reviews = [
  {
    persona: 'app-developer',
    criteria: [{ criterion: 'audience-fit', outcome: 'met' as const, reasoning: 'fits' }],
    findings: [],
    scoredBy: 'reviewer-model',
    taskId: `tk_${'7'.repeat(20)}`,
    completed: true
  },
  {
    persona: 'ops',
    criteria: [],
    findings: [],
    scoredBy: 'reviewer-model',
    taskId: `tk_${'8'.repeat(20)}`,
    completed: false
  }
];

const node = {
  kind: 'page' as const,
  slug: 'retry',
  title: 'Retry',
  brief: 'How retries work.',
  primaryPersona: 'app-developer',
  depth: 'standard' as const
};

const assemble = (
  evidence: ClaimEvidence[] = claimEvidence,
  overrides: { ledger?: ClaimLedger; page?: PageEntity } = {}
) =>
  assembleProvenanceV2({
    pageId: PAGE,
    page: overrides.page ?? page,
    node,
    ledger: overrides.ledger ?? ledger,
    claimEvidence: evidence,
    transcript,
    writeTask,
    reviews,
    instructions: ['Prefer active voice.'],
    criteria: ['audience-fit: the page addresses the persona.'],
    glossary,
    config,
    knowledge: [{ key: 'why-retries', question: 'Why retries?', answer: 'Flaky registries.' }]
  });

describe('assembleProvenanceV2', () => {
  it('assembles a schema-valid four-way provenance record', () => {
    // .parse inside the assembler is the contract: uniqueness invariants and the authority table
    // are enforced by the schema, so an invalid assembly can never leave the function.
    const provenance = assemble();
    expect(provenance.schemaVersion).toBe(1);
    expect(provenance.claimEvidence).toHaveLength(2);
    expect(provenance.claimEvidence[0]?.claimId).toBe(CLAIM_A);
  });

  it('REFUSES a ledger↔ClaimEvidence pair that is not a bijection (impl-06 finding 5)', () => {
    // Two ledger claims, one evidence record: assembly must throw, never parse into state.
    expect(() => assemble(claimEvidence.slice(0, 1))).toThrow(/no ClaimEvidence record/);
    // A stray evidence record with no ledger claim is equally corrupt.
    const stray = claimEvidenceSchema.parse({
      schemaVersion: 1,
      claimId: `cl_${'9'.repeat(20)}`,
      class: 'code-structure',
      correctness: 'unchecked',
      disposition: 'no-checker-available',
      evidence: []
    });
    expect(() => assemble([...claimEvidence, stray])).toThrow(/no ledger claim/);
    // Field disagreement (here: class) is corrupt even when the id sets match.
    const disagreeing = claimEvidence.map((record, index) =>
      index === 0 ? claimEvidenceSchema.parse({ ...record, class: 'value' }) : record
    );
    expect(() => assemble(disagreeing)).toThrow(/disagrees/);
  });

  it('REFUSES extra canonical evidence the ledger never references (Sol impl-07 probe)', () => {
    // The ledger claim carries no evidence handles, but the ClaimEvidence record smuggles a
    // canonical record in: unaccounted trust surface — exact set equality, not subset.
    const padded = claimEvidence.map((record, index) =>
      index === 0
        ? claimEvidenceSchema.parse({
            ...record,
            evidence: [
              {
                evidenceId: `ev_${'a'.repeat(20)}`,
                ref: { kind: 'source-linked', symbol: `ts:${'b'.repeat(64)}` },
                checkedAt: '2026-07-12T00:00:00.000Z',
                sourceRevision: COMMIT,
                outcome: 'pass'
              }
            ]
          })
        : record
    );
    expect(() => assemble(padded)).toThrow(/unreferenced canonical evidence/);
  });

  it('REFUSES a ledger whose pageId is not the target page (Sol impl-07 probe)', () => {
    const foreign = claimLedgerSchema.parse({ ...ledger, pageId: `pg_${'f'.repeat(20)}` });
    expect(() => assemble(claimEvidence, { ledger: foreign })).toThrow(/disagree with the target page/);
  });

  it('REFUSES a claim anchored to a block that does not exist on the page (Sol impl-07 probe)', () => {
    const detachedPage = pageEntitySchema.parse({ ...page, preamble: [], sections: [] });
    expect(() => assemble(claimEvidence, { page: detachedPage })).toThrow(/does not exist on page/);
  });

  it("REFUSES a scope revision that is not the anchored block's content hash (Sol impl-08 probe)", () => {
    const drifted = claimLedgerSchema.parse({
      ...ledger,
      claims: ledger.claims.map((claim, index) =>
        index === 0 ? { ...claim, scope: { ...claim.scope, revision: 'e'.repeat(64) } } : claim
      )
    });
    expect(() => assemble(claimEvidence, { ledger: drifted })).toThrow(/scope revision/);
  });

  it('REFUSES evidence checked at a revision other than the ledger sourceRevision', () => {
    const evidenceId = `ev_${'c'.repeat(20)}`;
    const staleLedger = claimLedgerSchema.parse({
      ...ledger,
      claims: ledger.claims.map((claim, index) => (index === 0 ? { ...claim, evidence: [evidenceId] } : claim))
    });
    const staleEvidence = claimEvidence.map((record, index) =>
      index === 0
        ? claimEvidenceSchema.parse({
            ...record,
            evidence: [
              {
                evidenceId,
                ref: { kind: 'source-linked', symbol: `ts:${'b'.repeat(64)}` },
                checkedAt: '2026-07-12T00:00:00.000Z',
                sourceRevision: 'b'.repeat(40),
                outcome: 'pass'
              }
            ]
          })
        : record
    );
    expect(() => assemble(staleEvidence, { ledger: staleLedger })).toThrow(/checked at revision/);
  });

  it('lineage carries models, prompt revisions, transcript pointers, and observed reads', () => {
    const { lineage } = assemble();
    expect(lineage.models).toEqual([
      { role: 'writer', model: 'scripted-writer', transport: 'replay' },
      { role: 'reviewer:app-developer', model: 'reviewer-model' },
      { role: 'reviewer:ops', model: 'reviewer-model' }
    ]);
    expect(lineage.prompts).toEqual([
      { id: 'write-page:system', revision: contentHash('system prompt text') },
      { id: 'write-page:user', revision: contentHash('user prompt text') }
    ]);
    expect(lineage.transcripts).toEqual([transcript.taskId, reviews[0]?.taskId, reviews[1]?.taskId]);
    expect(lineage.observedReads).toEqual([{ file: 'src/retry.ts', contentHash: HASH }]);
  });

  it('dependencies hold ONLY deduped subscriptions plus consumed fragment ids+hashes', () => {
    const { dependencies } = assemble();
    // Two claims, one shared dependency → one subscription.
    expect(dependencies.subscriptions).toEqual([subscription]);
    const kinds = dependencies.consumed.map((fragment) => fragment.kind);
    expect(kinds).toEqual(['instruction', 'criteria', 'knowledge-fact', 'glossary', 'config', 'ia']);
    const instruction = dependencies.consumed[0];
    expect(instruction?.hash).toBe(contentHash('Prefer active voice.'));
    expect(instruction?.id).toBe(`instruction-${contentHash('Prefer active voice.').slice(0, 12)}`);
    expect(dependencies.consumed.find((fragment) => fragment.kind === 'knowledge-fact')?.id).toBe('why-retries');
  });

  it('records the page-specific IA fragment as a consumed dependency (title/brief/depth/persona)', () => {
    const { dependencies } = assemble();
    const ia = dependencies.consumed.find((fragment) => fragment.kind === 'ia');
    expect(ia?.id).toBe('ia:retry');
    expect(ia?.hash).toBe(
      hashValue({ title: 'Retry', brief: 'How retries work.', depth: 'standard', primaryPersona: 'app-developer' })
    );
  });

  it('maps ONLY the primary persona to primary-gating; other recorded reviews are advisory', () => {
    const { assessments } = assemble();
    expect(assessments.reviews).toHaveLength(2);
    expect(assessments.reviews[0]).toMatchObject({
      persona: 'app-developer',
      role: 'primary-gating',
      entityId: PAGE,
      scoredBy: 'reviewer-model',
      completion: 'completed',
      criteria: [{ id: 'audience-fit', outcome: 'met' }]
    });
    // An invalid reviewer output is a RECORDED failed review, never a missing record — and a
    // non-primary persona can never masquerade as gating.
    expect(assessments.reviews[1]).toMatchObject({
      persona: 'ops',
      role: 'secondary-advisory',
      completion: 'failed',
      criteria: []
    });
  });
});
