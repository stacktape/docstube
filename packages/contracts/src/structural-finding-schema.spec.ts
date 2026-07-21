import { describe, expect, it } from 'vitest';
import { buildFixtureStructuralFinding } from './fixtures.ts';
import {
  structuralDetectorSchema,
  structuralFindingSchema,
  structuralFindingStatusSchema,
  structuralScopeSchema
} from './structural-finding-schema.ts';

const fingerprint = 'a'.repeat(64);

describe('structural findings', () => {
  it('round-trips the fixture group finding', () => {
    const finding = buildFixtureStructuralFinding();
    const result = structuralFindingSchema.safeParse(finding);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(finding);
  });

  it('requires a model on ai-assessed detectors and rejects unknown detector kinds', () => {
    expect(
      structuralDetectorSchema.safeParse({ kind: 'deterministic', id: 'outline-integrity', version: '1' }).success
    ).toBe(true);
    expect(
      structuralDetectorSchema.safeParse({ kind: 'ai-assessed', id: 'facet-asymmetry', version: '1' }).success
    ).toBe(false);
    expect(structuralDetectorSchema.safeParse({ kind: 'vibes', id: 'x', version: '1' }).success).toBe(false);
  });

  it('scopes to an entity or a nav group, never both shapes at once', () => {
    expect(structuralScopeSchema.safeParse({ kind: 'entity', pageId: 'pg_00000000000000000000' }).success).toBe(true);
    expect(structuralScopeSchema.safeParse({ kind: 'nav-group', groupId: 'compute', pageIds: [] }).success).toBe(false);
  });

  it('requires reason + scope fingerprint on suppression', () => {
    expect(structuralFindingStatusSchema.safeParse({ state: 'suppressed', reason: 'intentional layout' }).success).toBe(
      false
    );
    expect(
      structuralFindingStatusSchema.safeParse({
        state: 'suppressed',
        reason: 'intentional layout',
        scopeFingerprint: fingerprint
      }).success
    ).toBe(true);
    expect(structuralFindingStatusSchema.safeParse({ state: 'open' }).success).toBe(true);
  });

  it('rejects free-form finding codes', () => {
    const finding = { ...buildFixtureStructuralFinding(), code: 'Not A Code' };
    expect(structuralFindingSchema.safeParse(finding).success).toBe(false);
  });
});
