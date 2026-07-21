import { describe, expect, it } from 'vitest';
import { buildFixtureStructuralFinding } from './fixtures.ts';
import {
  structuralAuthoritySchema,
  structuralDetectorSchema,
  structuralFindingSchema,
  structuralFindingStatusSchema,
  structuralScopeSchema,
  structuralSnapshotSchema
} from './structural-finding-schema.ts';

const fingerprint = 'a'.repeat(64);
const pageId = 'pg_00000000000000000000';

describe('structural findings', () => {
  it('round-trips the fixture group finding', () => {
    const finding = buildFixtureStructuralFinding();
    const result = structuralFindingSchema.safeParse(finding);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(finding);
  });

  it('is a versioned committed record', () => {
    const { schemaVersion: _schemaVersion, ...unversioned } = buildFixtureStructuralFinding();
    expect(structuralFindingSchema.safeParse(unversioned).success).toBe(false);
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
    expect(structuralScopeSchema.safeParse({ kind: 'entity', pageId }).success).toBe(true);
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

describe('structural evidence authority', () => {
  it('distinguishes the four rungs of the evidence ladder', () => {
    expect(structuralAuthoritySchema.safeParse({ kind: 'explicit-ia-rule', ruleCode: 'required-facets' }).success).toBe(
      true
    );
    expect(structuralAuthoritySchema.safeParse({ kind: 'accepted-profile', profileId: 'resource-page' }).success).toBe(
      true
    );
    expect(structuralAuthoritySchema.safeParse({ kind: 'ai-plan-conformance', model: 'model-x' }).success).toBe(true);
    expect(
      structuralAuthoritySchema.safeParse({ kind: 'inferred-convention', cohortSize: 8, prevalence: 0.62 }).success
    ).toBe(true);
  });

  it('rejects unlabeled or under-specified authority', () => {
    expect(structuralAuthoritySchema.safeParse({ kind: 'convention' }).success).toBe(false);
    // An inferred convention without cohort evidence is not an authority.
    expect(structuralAuthoritySchema.safeParse({ kind: 'inferred-convention' }).success).toBe(false);
    // AI-derived conformance must be labeled with the model that derived it.
    expect(structuralAuthoritySchema.safeParse({ kind: 'ai-plan-conformance' }).success).toBe(false);
  });
});

describe('structural snapshot', () => {
  it('round-trips a snapshot with cohorts, page summaries, scopes, and prior findings', () => {
    const result = structuralSnapshotSchema.safeParse({
      schemaVersion: 1,
      generatedAt: '2026-07-12T00:00:00.000Z',
      groups: [{ groupId: 'compute-resources', title: 'Compute resources', pageIds: [pageId] }],
      pages: [
        {
          pageId,
          groupId: 'compute-resources',
          brief: 'How the container resource works.',
          primaryPersona: 'operator',
          structureProfile: 'resource-page',
          outline: [
            { title: 'Overview', level: 2 },
            { title: 'Pricing', level: 2 }
          ],
          blockSummary: [{ blockType: 'paragraph', count: 6 }],
          claimSubjects: [`ts:${'2'.repeat(64)}`],
          plan: 'overview, config reference, pricing'
        }
      ],
      changedScopes: [{ kind: 'entity', pageId }],
      pendingScopes: [],
      priorFindingKeys: ['sibling-facet-asymmetry:compute-resources:pricing']
    });
    expect(result.success).toBe(true);
  });

  it('is versioned and rejects unversioned snapshots', () => {
    expect(structuralSnapshotSchema.safeParse({ generatedAt: '2026-07-12T00:00:00.000Z' }).success).toBe(false);
  });
});
