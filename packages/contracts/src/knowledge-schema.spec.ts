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

  it('carries the auto-answer research trail so escalation preserves the research', () => {
    const need = {
      ...buildFixtureKnowledgeNeed(),
      status: 'escalated',
      researchTrail: [
        {
          attemptedBy: 'model-x',
          at: now,
          sourcesConsulted: [{ kind: 'url', url: 'https://docs.example.com/limits' }],
          summary: 'Upstream docs do not state the intent; needs a maintainer.'
        }
      ]
    };
    expect(knowledgeNeedSchema.safeParse(need).success).toBe(true);
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
    const uncited = { ...buildFixtureKnowledgeFact(), origin: 'ai', author: 'model-x', evidence: [] };
    expect(knowledgeFactSchema.safeParse(uncited).success).toBe(false);
    const cited = {
      ...uncited,
      evidence: [{ kind: 'url', url: 'https://docs.example.com/limits' }],
      researchTrail: [
        {
          attemptedBy: 'model-x',
          at: now,
          sourcesConsulted: [{ kind: 'url', url: 'https://docs.example.com/limits' }]
        }
      ]
    };
    expect(knowledgeFactSchema.safeParse(cited).success).toBe(true);
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
