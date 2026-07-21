import { describe, expect, it } from 'vitest';
import {
  claimEvidenceSchema,
  claimLedgerSchema,
  contentHash,
  docstubeConfigSchema,
  glossarySchema,
  transcriptSchema
} from '@docstube/contracts';
import type { AgentTaskSpec } from '@docstube/contracts';
import { assembleProvenanceV2 } from './assemble-provenance.ts';

const COMMIT = 'a'.repeat(40);
const CLAIM_A = `cl_${'1'.repeat(20)}`;
const CLAIM_B = `cl_${'2'.repeat(20)}`;
const BLOCK = `bl_${'3'.repeat(20)}`;
const PAGE = `pg_${'4'.repeat(20)}`;
const HASH = '5'.repeat(64);

const subscription = { kind: 'file-content', file: 'src/retry.ts', contentHash: HASH };

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

const assemble = (evidence = claimEvidence) =>
  assembleProvenanceV2({
    pageId: PAGE,
    ledger,
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
    expect(kinds).toEqual(['instruction', 'criteria', 'knowledge-fact', 'glossary', 'config']);
    const instruction = dependencies.consumed[0];
    expect(instruction?.hash).toBe(contentHash('Prefer active voice.'));
    expect(instruction?.id).toBe(`instruction-${contentHash('Prefer active voice.').slice(0, 12)}`);
    expect(dependencies.consumed.find((fragment) => fragment.kind === 'knowledge-fact')?.id).toBe('why-retries');
  });

  it('maps persona reviews onto assessments with gating role and honest completion', () => {
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
    // An invalid reviewer output is a RECORDED failed review, never a missing record.
    expect(assessments.reviews[1]).toMatchObject({ persona: 'ops', completion: 'failed', criteria: [] });
  });
});
