import { describe, expect, it } from 'vitest';
import {
  consumedFragmentSchema,
  personaReviewSchema,
  provenanceV2Schema,
  translationFidelitySchema
} from './provenance-v2-schema.ts';

const hash = 'a'.repeat(64);

describe('provenance v2 split', () => {
  it('parses an empty provenance into the four independent parts', () => {
    const parsed = provenanceV2Schema.parse({});
    expect(parsed.lineage).toEqual({ models: [], prompts: [], transcripts: [] });
    expect(parsed.dependencies).toEqual({ observedReads: [], consumed: [] });
    expect(parsed.claimEvidence).toEqual([]);
    expect(parsed.assessments).toEqual({ reviews: [], translationFidelity: [], structural: [] });
  });

  it('round-trips a full record', () => {
    const result = provenanceV2Schema.safeParse({
      lineage: {
        models: [{ role: 'writer', model: 'model-x', transport: 'claude-cli' }],
        prompts: [{ id: 'write-page', revision: hash }],
        transcripts: ['tk_00000000000000000000']
      },
      dependencies: {
        observedReads: [{ file: 'src/retry.ts', contentHash: hash }],
        consumed: [{ kind: 'knowledge-fact', id: 'kf_00000000000000000000', hash }]
      },
      claimEvidence: [
        { claimId: 'cl_00000000000000000000', evidence: [{ kind: 'source-linked', symbol: `ts:${hash}` }] }
      ],
      assessments: {
        reviews: [
          {
            persona: 'app-developer',
            scoredBy: 'model-x',
            completion: 'completed',
            criteria: [{ id: 'audience-fit', version: '2', outcome: 'met' }]
          }
        ],
        riskCritic: { scoredBy: 'model-x', completion: 'completed', issues: [] },
        translationFidelity: [{ locale: 'de', scoredBy: 'model-x', completion: 'completed', outcome: 'passed' }],
        structural: [{ findingKey: 'k', scoredBy: 'model-x', outcome: 'not-applicable' }]
      }
    });
    expect(result.success).toBe(true);
  });
});

describe('consumed fragments', () => {
  it('rejects fragment kinds outside the causal-invalidation registry', () => {
    expect(consumedFragmentSchema.safeParse({ kind: 'vibe', id: 'x', hash }).success).toBe(false);
    expect(consumedFragmentSchema.safeParse({ kind: 'glossary', id: 'retry', hash }).success).toBe(true);
  });
});

describe('assessments', () => {
  it('represents pending reviews explicitly — publish with label withheld', () => {
    const pending = personaReviewSchema.parse({ persona: 'app-developer', scoredBy: 'model-x', completion: 'pending' });
    expect(pending.criteria).toEqual([]);
    expect(personaReviewSchema.safeParse({ persona: 'p', scoredBy: 'm', completion: 'done' }).success).toBe(false);
  });

  it('rejects criterion outcomes outside met/not-met/not-applicable', () => {
    const result = personaReviewSchema.safeParse({
      persona: 'app-developer',
      scoredBy: 'model-x',
      completion: 'completed',
      criteria: [{ id: 'audience-fit', outcome: 'partially-met' }]
    });
    expect(result.success).toBe(false);
  });

  it('allows a pending translation fidelity record with no outcome', () => {
    const result = translationFidelitySchema.safeParse({ locale: 'de', scoredBy: 'model-x', completion: 'pending' });
    expect(result.success).toBe(true);
  });
});
