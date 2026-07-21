import { describe, expect, it } from 'vitest';
import {
  claimEvidenceSchema,
  consumedFragmentSchema,
  dependenciesSchema,
  evidenceRecordSchema,
  generationLineageSchema,
  personaReviewSchema,
  provenanceV2Schema,
  translationFidelitySchema
} from './provenance-v2-schema.ts';

const hash = 'a'.repeat(64);
const symbol = `ts:${hash}`;
const now = '2026-07-12T00:00:00.000Z';
const commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const evidenceId = 'ev_00000000000000000000';
const otherEvidenceId = 'ev_11111111111111111111';
const pageId = 'pg_00000000000000000000';
const factId = 'kf_00000000000000000000';

const evidenceRecord = (ref: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  evidenceId,
  ref,
  checkedAt: now,
  sourceRevision: commit,
  outcome: 'pass',
  ...overrides
});

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
          evidence: [evidenceRecord({ kind: 'codemap-grounding', symbol })],
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

describe('canonical evidence records', () => {
  it('requires the source revision — unreproducible evidence is not evidence', () => {
    const { sourceRevision: _sourceRevision, ...withoutRevision } = evidenceRecord({
      kind: 'codemap-grounding',
      symbol
    });
    expect(evidenceRecordSchema.safeParse(withoutRevision).success).toBe(false);
    expect(evidenceRecordSchema.safeParse(evidenceRecord({ kind: 'codemap-grounding', symbol })).success).toBe(true);
  });

  it('requires a structured pass/fail outcome', () => {
    const { outcome: _outcome, ...withoutOutcome } = evidenceRecord({ kind: 'schema-check', check: 'x' });
    expect(evidenceRecordSchema.safeParse(withoutOutcome).success).toBe(false);
    expect(
      evidenceRecordSchema.safeParse(evidenceRecord({ kind: 'schema-check', check: 'x' }, { outcome: 'mostly' }))
        .success
    ).toBe(false);
    expect(
      evidenceRecordSchema.safeParse(
        evidenceRecord(
          { kind: 'schema-check', check: 'x' },
          { outcome: 'fail', detail: 'docs assert 3, source says 5' }
        )
      ).success
    ).toBe(true);
  });

  it('keeps value-predicate outcomes consistent with the comparison', () => {
    const equal = { kind: 'value-predicate', symbol, valueName: 'attempts', assertedValue: '3', extractedValue: '3' };
    const differing = {
      kind: 'value-predicate',
      symbol,
      valueName: 'attempts',
      assertedValue: '3',
      extractedValue: '5'
    };
    expect(evidenceRecordSchema.safeParse(evidenceRecord(equal, { outcome: 'pass' })).success).toBe(true);
    // Matching values recorded as a failure — impossible comparison result.
    expect(evidenceRecordSchema.safeParse(evidenceRecord(equal, { outcome: 'fail' })).success).toBe(false);
    expect(evidenceRecordSchema.safeParse(evidenceRecord(differing, { outcome: 'fail' })).success).toBe(true);
    expect(evidenceRecordSchema.safeParse(evidenceRecord(differing, { outcome: 'pass' })).success).toBe(false);
  });
});

describe('canonical claim evidence — the full authority table', () => {
  it('rejects checked-via-source-linked and accepts a matching value predicate on value claims', () => {
    const sourceLinked = record({
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceRecord({ kind: 'source-linked', symbol })],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(sourceLinked).success).toBe(false);
    const predicate = record({
      correctness: 'checked',
      disposition: null,
      evidence: [
        evidenceRecord({
          kind: 'value-predicate',
          symbol,
          valueName: 'attempts',
          assertedValue: '3',
          extractedValue: '3'
        })
      ],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(predicate).success).toBe(true);
  });

  it('rejects checked-via-codemap-grounding on value and behavior claims but accepts it for code-structure', () => {
    for (const cls of ['value', 'behavior']) {
      const grounded = record({
        class: cls,
        correctness: 'checked',
        disposition: null,
        evidence: [evidenceRecord({ kind: 'codemap-grounding', symbol })],
        decidingEvidenceId: evidenceId
      });
      expect(claimEvidenceSchema.safeParse(grounded).success).toBe(false);
    }
    const codeStructure = record({
      class: 'code-structure',
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceRecord({ kind: 'codemap-grounding', symbol })],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(codeStructure).success).toBe(true);
  });

  it('lets owner attestation decide ONLY intent-history claims', () => {
    const attestationRef = { kind: 'owner-attestation', author: 'github:someuser', at: now };
    const intentHistory = record({
      class: 'intent-history',
      correctness: 'checked',
      disposition: 'owner-attested',
      evidence: [evidenceRecord(attestationRef)],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(intentHistory).success).toBe(true);
    // A maintainer attestation cannot mint checked for mechanical claim classes.
    for (const cls of ['code-structure', 'value', 'behavior']) {
      const attested = record({
        class: cls,
        correctness: 'checked',
        disposition: 'owner-attested',
        evidence: [evidenceRecord(attestationRef)],
        decidingEvidenceId: evidenceId
      });
      expect(claimEvidenceSchema.safeParse(attested).success).toBe(false);
    }
    // Attestation-decided without the disposition — inconsistent.
    const missingDisposition = record({
      class: 'intent-history',
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceRecord(attestationRef)],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(missingDisposition).success).toBe(false);
  });

  it('lets external citations decide value and behavior claims, never intent-history', () => {
    const citationRef = { kind: 'external-citation', url: 'https://docs.example.com/limits', factId };
    for (const cls of ['value', 'behavior']) {
      const cited = record({
        class: cls,
        correctness: 'checked',
        disposition: null,
        evidence: [evidenceRecord(citationRef)],
        decidingEvidenceId: evidenceId
      });
      expect(claimEvidenceSchema.safeParse(cited).success).toBe(true);
    }
    // Project intent is human-only — a URL cannot mint checked intent-history.
    const intentCited = record({
      class: 'intent-history',
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceRecord(citationRef)],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(intentCited).success).toBe(false);
  });

  it('never lets unpromoted project-defined evidence mint checked', () => {
    const projectRef = { kind: 'project-defined', verifier: 'x', plugin: 'p', promoted: false };
    const unpromoted = record({
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceRecord(projectRef)],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(unpromoted).success).toBe(false);
    const promoted = record({
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceRecord({ ...projectRef, promoted: true })],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(promoted).success).toBe(true);
  });

  it('routes unknown classes to unchecked unless a promoted project-defined verifier decided', () => {
    const unknownChecked = record({
      class: 'api-compat',
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceRecord({ kind: 'execution', check: 'snippet-exec', environment: { os: 'linux' } })],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(unknownChecked).success).toBe(false);
    const unknownPromoted = record({
      class: 'api-compat',
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceRecord({ kind: 'project-defined', verifier: 'x', plugin: 'p', promoted: true })],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(unknownPromoted).success).toBe(true);
  });

  it('requires outcome pass for checked and outcome fail for contradicted', () => {
    const execRef = { kind: 'execution', check: 'snippet-exec', environment: { os: 'linux' } };
    const checkedOnFailure = record({
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceRecord(execRef, { outcome: 'fail' })],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(checkedOnFailure).success).toBe(false);
    const contradicted = record({
      correctness: 'contradicted',
      disposition: null,
      evidence: [evidenceRecord(execRef, { outcome: 'fail' })],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(contradicted).success).toBe(true);
    // A contradiction backed by a passing check is not a contradiction.
    const contradictedOnPass = record({
      correctness: 'contradicted',
      disposition: null,
      evidence: [evidenceRecord(execRef, { outcome: 'pass' })],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(contradictedOnPass).success).toBe(false);
  });

  it('never lets an equal-values value predicate decide a contradiction', () => {
    const equalValues = {
      kind: 'value-predicate',
      symbol,
      valueName: 'attempts',
      assertedValue: '3',
      extractedValue: '3'
    };
    // outcome:fail is rejected by the record itself; outcome:pass fails the contradiction rule.
    for (const outcome of ['pass', 'fail']) {
      const contradiction = record({
        correctness: 'contradicted',
        disposition: null,
        evidence: [evidenceRecord(equalValues, { outcome })],
        decidingEvidenceId: evidenceId
      });
      expect(claimEvidenceSchema.safeParse(contradiction).success).toBe(false);
    }
  });

  it('rejects a deciding id that resolves to no evidence record', () => {
    const dangling = record({
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceRecord({ kind: 'source-linked', symbol })],
      decidingEvidenceId: otherEvidenceId
    });
    expect(claimEvidenceSchema.safeParse(dangling).success).toBe(false);
  });

  it('rejects duplicate evidence ids within one claim — divergent state under one identity', () => {
    const passRecord = evidenceRecord({ kind: 'execution', check: 'snippet-exec', environment: { os: 'linux' } });
    const failRecord = evidenceRecord(
      { kind: 'execution', check: 'snippet-exec', environment: { os: 'linux' } },
      { outcome: 'fail' }
    );
    // Same evidenceId carrying pass AND fail — the canonical identity is ambiguous.
    const duplicated = record({
      correctness: 'checked',
      disposition: null,
      evidence: [passRecord, failRecord],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(duplicated).success).toBe(false);
    const distinct = record({
      correctness: 'checked',
      disposition: null,
      evidence: [passRecord, { ...failRecord, evidenceId: otherEvidenceId }],
      decidingEvidenceId: evidenceId
    });
    expect(claimEvidenceSchema.safeParse(distinct).success).toBe(true);
  });
});

describe('provenance collection identity', () => {
  const claimEvidenceEntry = (claimId: string, entryEvidenceId: string) => ({
    schemaVersion: 1,
    claimId,
    class: 'code-structure',
    correctness: 'checked',
    disposition: null,
    evidence: [evidenceRecord({ kind: 'codemap-grounding', symbol }, { evidenceId: entryEvidenceId })],
    decidingEvidenceId: entryEvidenceId
  });

  it('holds at most one ClaimEvidence record per claim id', () => {
    const result = provenanceV2Schema.safeParse({
      schemaVersion: 1,
      claimEvidence: [
        claimEvidenceEntry('cl_00000000000000000000', evidenceId),
        claimEvidenceEntry('cl_00000000000000000000', otherEvidenceId)
      ]
    });
    expect(result.success).toBe(false);
  });

  it('keeps evidence record ids unique across the whole collection', () => {
    // The same evidenceId under two different claims could carry divergent payloads — shared
    // physical evidence gets distinct minted ids instead.
    const shared = provenanceV2Schema.safeParse({
      schemaVersion: 1,
      claimEvidence: [
        claimEvidenceEntry('cl_00000000000000000000', evidenceId),
        claimEvidenceEntry('cl_11111111111111111111', evidenceId)
      ]
    });
    expect(shared.success).toBe(false);
    const distinct = provenanceV2Schema.safeParse({
      schemaVersion: 1,
      claimEvidence: [
        claimEvidenceEntry('cl_00000000000000000000', evidenceId),
        claimEvidenceEntry('cl_11111111111111111111', otherEvidenceId)
      ]
    });
    expect(distinct.success).toBe(true);
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

  it('requires the correction outcome to agree with the terminal state', () => {
    // A pass produced by a failed correction, or a failure despite a passed correction, is
    // an impossible lifecycle.
    const passedViaFailedCorrection = translationFidelitySchema.safeParse({
      state: 'passed',
      ...key,
      scoredBy: 'model-x',
      correction: { scoredBy: 'model-x', at: now, outcome: 'failed', findings: ['terminology drift'] }
    });
    expect(passedViaFailedCorrection.success).toBe(false);
    const failedViaPassedCorrection = translationFidelitySchema.safeParse({
      state: 'failed',
      ...key,
      scoredBy: 'model-x',
      findings: ['meaning drift in step 2'],
      correction: { scoredBy: 'model-x', at: now, outcome: 'passed', findings: [] }
    });
    expect(failedViaPassedCorrection.success).toBe(false);
    const failedConsistently = translationFidelitySchema.safeParse({
      state: 'failed',
      ...key,
      scoredBy: 'model-x',
      findings: ['meaning drift in step 2'],
      correction: { scoredBy: 'model-x', at: now, outcome: 'failed', findings: ['still drifting'] }
    });
    expect(failedConsistently.success).toBe(true);
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
