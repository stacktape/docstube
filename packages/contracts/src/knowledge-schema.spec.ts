import { describe, expect, it } from 'vitest';
import { buildFixtureKnowledgeFact, buildFixtureKnowledgeNeed } from './fixtures.ts';
import { factEvidenceRefSchema, knowledgeFactSchema, knowledgeNeedSchema } from './knowledge-schema.ts';

describe('knowledge needs', () => {
  it('round-trips the fixture need', () => {
    const need = buildFixtureKnowledgeNeed();
    const result = knowledgeNeedSchema.safeParse(need);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(need);
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

  it('allows a subject with no symbol binding for pure intent questions', () => {
    const need = buildFixtureKnowledgeNeed();
    const result = knowledgeNeedSchema.safeParse({ ...need, subject: { entityThreadId: need.subject.entityThreadId } });
    expect(result.success).toBe(true);
  });
});

describe('knowledge facts', () => {
  it('round-trips the fixture fact', () => {
    const fact = buildFixtureKnowledgeFact();
    const result = knowledgeFactSchema.safeParse(fact);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(fact);
  });

  it('requires evidence for origin:ai facts — an uncited answer is a failure', () => {
    const uncited = { ...buildFixtureKnowledgeFact(), origin: 'ai', author: 'model-x', evidence: [] };
    expect(knowledgeFactSchema.safeParse(uncited).success).toBe(false);
    const cited = { ...uncited, evidence: [{ kind: 'url', url: 'https://docs.example.com/limits' }] };
    expect(knowledgeFactSchema.safeParse(cited).success).toBe(true);
  });

  it('rejects evidence refs outside url/code kinds', () => {
    expect(factEvidenceRefSchema.safeParse({ kind: 'hearsay', detail: 'trust me' }).success).toBe(false);
    expect(factEvidenceRefSchema.safeParse({ kind: 'code', file: 'src/retry.ts', span: [3, 9] }).success).toBe(true);
  });

  it('rejects a project scope carrying an entity thread', () => {
    const fact = {
      ...buildFixtureKnowledgeFact(),
      scope: { kind: 'project', entityThreadId: 'bl_00000000000000000000' }
    };
    expect(knowledgeFactSchema.safeParse(fact).success).toBe(false);
  });
});
