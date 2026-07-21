import { describe, expect, it } from 'vitest';
import {
  claimEvidenceSchema,
  consumedFragmentSchema,
  dependenciesSchema,
  generationLineageSchema,
  personaReviewSchema,
  provenanceV2Schema,
  translationFidelitySchema
} from './provenance-v2-schema.ts';

const hash = 'a'.repeat(64);
const symbol = `ts:${hash}`;
const now = '2026-07-12T00:00:00.000Z';
const evidenceId = 'ev_00000000000000000000';
const otherEvidenceId = 'ev_11111111111111111111';
const pageId = 'pg_00000000000000000000';

describe('provenance v2 split', () => {
  it('parses an empty versioned provenance into the four independent parts', () => {
    const parsed = provenanceV2Schema.parse({ schemaVersion: 1 });
    expect(parsed.lineage).toEqual({ models: [], prompts: [], transcripts: [], seedContext: [], observedReads: [] });
    expect(parsed.dependencies).toEqual({ subscriptions: [], consumed: [] });
    expect(parsed.claimEvidence).toEqual([]);
    expect(parsed.assessments).toEqual({ reviews: [], translationFidelity: [], structural: [] });
  });

  it('rejects an unversioned provenance record', () => {
    expect(provenanceV2Schema.safeParse({}).success).toBe(false);
  });

  it('round-trips a full record', () => {
    const result = provenanceV2Schema.safeParse({
      schemaVersion: 1,
      lineage: {
        models: [{ role: 'writer', model: 'model-x', transport: 'claude-cli' }],
        prompts: [{ id: 'write-page', revision: hash }],
        transcripts: ['tk_00000000000000000000'],
        seedContext: ['ctx_00000000000000000000'],
        observedReads: [{ file: 'src/retry.ts', contentHash: hash }]
      },
      dependencies: {
        subscriptions: [
          { kind: 'signature', symbolHash: symbol },
          { kind: 'file-content', file: 'package.json', contentHash: hash }
        ],
        consumed: [{ kind: 'knowledge-fact', id: 'kf_00000000000000000000', hash }]
      },
      claimEvidence: [
        {
          schemaVersion: 1,
          claimId: 'cl_00000000000000000000',
          class: 'code-structure',
          correctness: 'checked',
          disposition: null,
          evidence: [
            {
              evidenceId,
              ref: { kind: 'codemap-grounding', symbol },
              checkedAt: now,
              sourceRevision: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
            }
          ],
          decidingEvidenceId: evidenceId
        }
      ],
      assessments: {
        reviews: [
          {
            persona: 'app-developer',
            role: 'primary-gating',
            entityId: pageId,
            scoredBy: 'model-x',
            completion: 'completed',
            criteria: [{ id: 'audience-fit', version: '2', outcome: 'met' }]
          }
        ],
        riskCritic: { scoredBy: 'model-x', completion: 'completed', issues: [] },
        translationFidelity: [
          {
            state: 'passed',
            pageId,
            locale: 'de',
            sourceContentRevision: hash,
            scoredBy: 'model-x',
            at: now
          }
        ],
        structural: [{ findingKey: 'k', scoredBy: 'model-x', outcome: 'not-applicable' }]
      }
    });
    expect(result.success).toBe(true);
  });
});

describe('lineage vs dependencies', () => {
  it('records observed reads on lineage — consulting a file is not a dependency', () => {
    const lineage = generationLineageSchema.parse({
      observedReads: [{ file: 'README.md', contentHash: hash }]
    });
    expect(lineage.observedReads).toHaveLength(1);
    const dependencies = dependenciesSchema.safeParse({
      observedReads: [{ file: 'README.md', contentHash: hash }]
    });
    // Unknown keys are stripped, never subscriptions.
    expect(dependencies.success).toBe(true);
    expect(dependencies.data).toEqual({ subscriptions: [], consumed: [] });
  });

  it('rejects dependency subscriptions outside the canonical union', () => {
    const result = dependenciesSchema.safeParse({
      subscriptions: [{ kind: 'observed-read', file: 'README.md', contentHash: hash }]
    });
    expect(result.success).toBe(false);
  });
});

describe('consumed fragments', () => {
  it('rejects fragment kinds outside the causal-invalidation registry', () => {
    expect(consumedFragmentSchema.safeParse({ kind: 'vibe', id: 'x', hash }).success).toBe(false);
    expect(consumedFragmentSchema.safeParse({ kind: 'glossary', id: 'retry', hash }).success).toBe(true);
  });
});

const record = (overrides: Record<string, unknown>) => ({
  schemaVersion: 1,
  claimId: 'cl_00000000000000000000',
  class: 'value',
  correctness: 'unchecked',
  disposition: 'no-checker-available',
  evidence: [],
  ...overrides
});

describe('canonical claim evidence', () => {
  it('enforces the same authority table as the kernel ledger — checked-via-source-linked rejected', () => {
    const sourceLinked = record({
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, ref: { kind: 'source-linked', symbol }, checkedAt: now }],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(sourceLinked).success).toBe(false);
    const predicate = record({
      correctness: 'checked',
      disposition: null,
      evidence: [
        {
          evidenceId,
          ref: { kind: 'value-predicate', symbol, valueName: 'attempts', assertedValue: '3', extractedValue: '3' },
          checkedAt: now
        }
      ],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(predicate).success).toBe(true);
  });

  it('never lets unpromoted project-defined evidence mint checked', () => {
    const unpromoted = record({
      correctness: 'checked',
      disposition: null,
      evidence: [
        { evidenceId, ref: { kind: 'project-defined', verifier: 'x', plugin: 'p', promoted: false }, checkedAt: now }
      ],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(unpromoted).success).toBe(false);
  });

  it('rejects a deciding id that resolves to no evidence record', () => {
    const dangling = record({
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, ref: { kind: 'source-linked', symbol }, checkedAt: now }],
      decidingEvidenceId: otherEvidenceId
    });
    expect(claimEvidenceSchema.safeParse(dangling).success).toBe(false);
  });
});

describe('assessments', () => {
  it('represents pending reviews explicitly — publish with label withheld', () => {
    const pending = personaReviewSchema.parse({
      persona: 'app-developer',
      role: 'primary-gating',
      entityId: pageId,
      scoredBy: 'model-x',
      completion: 'pending'
    });
    expect(pending.criteria).toEqual([]);
    expect(
      personaReviewSchema.safeParse({
        persona: 'p',
        role: 'primary-gating',
        entityId: pageId,
        scoredBy: 'm',
        completion: 'done'
      }).success
    ).toBe(false);
  });

  it('requires the entity target and a known review role', () => {
    const missingEntity = personaReviewSchema.safeParse({
      persona: 'app-developer',
      role: 'primary-gating',
      scoredBy: 'model-x',
      completion: 'completed'
    });
    expect(missingEntity.success).toBe(false);
    const unknownRole = personaReviewSchema.safeParse({
      persona: 'app-developer',
      role: 'gating',
      entityId: pageId,
      scoredBy: 'model-x',
      completion: 'completed'
    });
    expect(unknownRole.success).toBe(false);
  });

  it('rejects criterion outcomes outside met/not-met/not-applicable', () => {
    const result = personaReviewSchema.safeParse({
      persona: 'app-developer',
      role: 'secondary-advisory',
      entityId: pageId,
      scoredBy: 'model-x',
      completion: 'completed',
      criteria: [{ id: 'audience-fit', outcome: 'partially-met' }]
    });
    expect(result.success).toBe(false);
  });
});

describe('translation fidelity lifecycle', () => {
  const key = { pageId, locale: 'de', sourceContentRevision: hash };

  it('keys every state by page, locale, and exact source content revision', () => {
    expect(translationFidelitySchema.safeParse({ state: 'pending', ...key }).success).toBe(true);
    expect(translationFidelitySchema.safeParse({ state: 'pending', pageId, locale: 'de' }).success).toBe(false);
  });

  it('rejects inconsistent completion/outcome combinations', () => {
    // A pending review has no scorer or findings — strict arms reject the smuggle.
    expect(translationFidelitySchema.safeParse({ state: 'pending', ...key, scoredBy: 'model-x' }).success).toBe(false);
    // A failure without findings is not representable.
    expect(
      translationFidelitySchema.safeParse({ state: 'failed', ...key, scoredBy: 'model-x', findings: [] }).success
    ).toBe(false);
    expect(translationFidelitySchema.safeParse({ state: 'translated', ...key }).success).toBe(false);
  });

  it('represents at most one correction cycle', () => {
    const corrected = translationFidelitySchema.safeParse({
      state: 'passed',
      ...key,
      scoredBy: 'model-x',
      correction: { scoredBy: 'model-x', at: now, outcome: 'passed', findings: [] }
    });
    expect(corrected.success).toBe(true);
    const twoCorrections = translationFidelitySchema.safeParse({
      state: 'failed',
      ...key,
      scoredBy: 'model-x',
      findings: ['meaning drift in step 2'],
      corrections: [
        { scoredBy: 'model-x', at: now, outcome: 'failed', findings: [] },
        { scoredBy: 'model-x', at: now, outcome: 'failed', findings: [] }
      ]
    });
    expect(twoCorrections.success).toBe(false);
  });
});
