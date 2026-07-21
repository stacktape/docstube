import { describe, expect, it } from 'vitest';
import { buildFixtureKnowledgeFact, buildFixtureKnowledgeNeed } from './fixtures.ts';
import {
  factEvidenceRefSchema,
  knowledgeFactSchema,
  knowledgeNeedSchema,
  knowledgeSubjectSchema
} from './knowledge-schema.ts';

const symbol = `ts:${'a'.repeat(64)}`;
const hash = 'b'.repeat(64);
const now = '2026-07-12T00:00:00.000Z';

describe('knowledge subjects', () => {
  it('represents entity-thread, symbol-only, and topic subjects', () => {
    expect(
      knowledgeSubjectSchema.safeParse({ kind: 'entity-thread', entityThreadId: 'et_00000000000000000000' }).success
    ).toBe(true);
    expect(knowledgeSubjectSchema.safeParse({ kind: 'symbol', symbolHash: symbol }).success).toBe(true);
    expect(knowledgeSubjectSchema.safeParse({ kind: 'topic', topic: 'release cadence' }).success).toBe(true);
  });

  it('rejects unknown subject kinds and cross-kind smuggles', () => {
    expect(knowledgeSubjectSchema.safeParse({ kind: 'page', pageId: 'pg_00000000000000000000' }).success).toBe(false);
    // A topic subject must not silently carry a code binding — strict arms.
    expect(knowledgeSubjectSchema.safeParse({ kind: 'topic', topic: 'x', symbolHash: symbol }).success).toBe(false);
  });
});

describe('knowledge needs', () => {
  it('round-trips the fixture need', () => {
    const need = buildFixtureKnowledgeNeed();
    const result = knowledgeNeedSchema.safeParse(need);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(need);
  });

  it('is a versioned committed record', () => {
    const { schemaVersion: _schemaVersion, ...unversioned } = buildFixtureKnowledgeNeed();
    expect(knowledgeNeedSchema.safeParse(unversioned).success).toBe(false);
  });

  it('requires mergedInto when the status is merged', () => {
    const need = { ...buildFixtureKnowledgeNeed(), status: 'merged' };
    expect(knowledgeNeedSchema.safeParse(need).success).toBe(false);
    const merged = { ...need, mergedInto: 'kn_00000000000000000000' };
    expect(knowledgeNeedSchema.safeParse(merged).success).toBe(true);
  });

  it('rejects an unknown need kind', () => {
    const need = { ...buildFixtureKnowledgeNeed(), kind: 'gossip' };
    expect(knowledgeNeedSchema.safeParse(need).success).toBe(false);
  });

  it('never auto-answers an intent-policy need — project intent is human-only', () => {
    // The fixture need IS intent-policy: an auto-answered status on it must not parse.
    const autoAnswered = { ...buildFixtureKnowledgeNeed(), status: 'auto-answered' };
    expect(knowledgeNeedSchema.safeParse(autoAnswered).success).toBe(false);
    const derivable = { ...buildFixtureKnowledgeNeed(), kind: 'derivable', status: 'auto-answered' };
    expect(knowledgeNeedSchema.safeParse(derivable).success).toBe(true);
  });

  it('carries the canonical auto-answer research trail with stable attempt ids', () => {
    const attempt = {
      attemptId: 'ra_00000000000000000000',
      attemptedBy: 'model-x',
      at: now,
      sourcesConsulted: [{ kind: 'url', url: 'https://docs.example.com/limits' }],
      summary: 'Upstream docs do not state the intent; needs a maintainer.'
    };
    const need = { ...buildFixtureKnowledgeNeed(), status: 'escalated', researchTrail: [attempt] };
    expect(knowledgeNeedSchema.safeParse(need).success).toBe(true);
    // Attempts are individually addressable — an unidentified or duplicated attempt is invalid.
    const { attemptId: _attemptId, ...anonymous } = attempt;
    expect(
      knowledgeNeedSchema.safeParse({ ...buildFixtureKnowledgeNeed(), status: 'escalated', researchTrail: [anonymous] })
        .success
    ).toBe(false);
    expect(
      knowledgeNeedSchema.safeParse({
        ...buildFixtureKnowledgeNeed(),
        status: 'escalated',
        researchTrail: [attempt, attempt]
      }).success
    ).toBe(false);
  });
});

describe('knowledge facts', () => {
  it('round-trips the fixture fact', () => {
    const fact = buildFixtureKnowledgeFact();
    const result = knowledgeFactSchema.safeParse(fact);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(fact);
  });

  it('links every fact to the need it answers', () => {
    const { needId: _needId, ...unlinked } = buildFixtureKnowledgeFact();
    expect(knowledgeFactSchema.safeParse(unlinked).success).toBe(false);
  });

  it('accepts the three attributed origins and rejects the dead human/ai pair', () => {
    const fact = buildFixtureKnowledgeFact();
    for (const origin of ['user', 'github-answer']) {
      expect(knowledgeFactSchema.safeParse({ ...fact, origin }).success).toBe(true);
    }
    expect(knowledgeFactSchema.safeParse({ ...fact, origin: 'human' }).success).toBe(false);
  });

  it('requires evidence for origin:ai facts — an uncited answer is a failure', () => {
    const uncited = {
      ...buildFixtureKnowledgeFact(),
      origin: 'ai',
      author: 'model-x',
      evidence: [],
      successfulAttemptId: 'ra_00000000000000000000'
    };
    expect(knowledgeFactSchema.safeParse(uncited).success).toBe(false);
    const cited = { ...uncited, evidence: [{ kind: 'url', url: 'https://docs.example.com/limits' }] };
    expect(knowledgeFactSchema.safeParse(cited).success).toBe(true);
  });

  it('references the successful research attempt instead of duplicating the trail', () => {
    const base = {
      ...buildFixtureKnowledgeFact(),
      origin: 'ai',
      author: 'model-x',
      evidence: [{ kind: 'url', url: 'https://docs.example.com/limits' }]
    };
    // An AI fact without its producing attempt is untraceable.
    expect(knowledgeFactSchema.safeParse(base).success).toBe(false);
    expect(knowledgeFactSchema.safeParse({ ...base, successfulAttemptId: 'ra_00000000000000000000' }).success).toBe(
      true
    );
    // Human answers do not come from research attempts.
    expect(
      knowledgeFactSchema.safeParse({ ...buildFixtureKnowledgeFact(), successfulAttemptId: 'ra_00000000000000000000' })
        .success
    ).toBe(false);
    // The trail itself is canonical on the need — a fact carrying a copy has it stripped, and the
    // fact schema no longer owns a researchTrail field.
    const withTrail = knowledgeFactSchema.parse({
      ...buildFixtureKnowledgeFact(),
      researchTrail: [{ attemptId: 'ra_00000000000000000000', attemptedBy: 'model-x', at: now, sourcesConsulted: [] }]
    });
    expect('researchTrail' in withTrail).toBe(false);
  });

  it('tracks propagation separately from lifecycle status', () => {
    const fact = buildFixtureKnowledgeFact();
    for (const propagation of ['answered', 'propagation-pending', 'applied']) {
      expect(knowledgeFactSchema.safeParse({ ...fact, propagation }).success).toBe(true);
    }
    expect(knowledgeFactSchema.safeParse({ ...fact, propagation: 'active' }).success).toBe(false);
  });

  it('fingerprints the subject with a content hash, never a git commit', () => {
    const fact = buildFixtureKnowledgeFact();
    const gitSha = { ...fact, subjectFingerprint: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' };
    expect(knowledgeFactSchema.safeParse(gitSha).success).toBe(false);
    expect(knowledgeFactSchema.safeParse({ ...fact, subjectFingerprint: hash }).success).toBe(true);
  });

  it('rejects evidence refs outside url/code kinds', () => {
    expect(factEvidenceRefSchema.safeParse({ kind: 'hearsay', detail: 'trust me' }).success).toBe(false);
    expect(factEvidenceRefSchema.safeParse({ kind: 'code', file: 'src/retry.ts', span: [3, 9] }).success).toBe(true);
  });

  it('rejects a project scope carrying an entity thread', () => {
    const fact = {
      ...buildFixtureKnowledgeFact(),
      scope: { kind: 'project', entityThreadId: 'et_00000000000000000000' }
    };
    expect(knowledgeFactSchema.safeParse(fact).success).toBe(false);
  });
});
