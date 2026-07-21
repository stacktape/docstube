import { describe, expect, it } from 'vitest';
import type { PageShard, PersonaReview } from '@docstube/contracts';
import { buildFixtureInput } from './emit-site-fixture.ts';
import { projectShardProof } from './proof-projection.ts';

// The interim reader projection is LITERAL (impl-07 finding 4): counts, contradiction facts, and
// per-claim contradicted markers from ClaimEvidence; "reviewed for" ONLY from a genuinely
// completed primary review. No guarantee ladder, no fallback-to-reviewed.

const installShard = (withContradiction = false): PageShard =>
  buildFixtureInput('unused-root', { withContradiction }).pages[0]!.shard;

const withReviews = (shard: PageShard, reviews: PersonaReview[]): PageShard => {
  if (shard.provenance === undefined) {
    throw new Error('fixture shard is missing its trust spine');
  }
  return {
    ...shard,
    provenance: { ...shard.provenance, assessments: { ...shard.provenance.assessments, reviews } }
  };
};

const review = (overrides: Partial<PersonaReview>): PersonaReview => ({
  persona: 'app-developer',
  role: 'primary-gating',
  entityId: installShard().page.id,
  scoredBy: 'model',
  completion: 'completed',
  criteria: [{ id: 'audience-fit', outcome: 'met' }],
  ...overrides
});

describe('projectShardProof', () => {
  it('projects literal claim counts with no guarantee field at all', () => {
    const projection = projectShardProof(installShard());
    expect(projection).toMatchObject({
      state: 'verified',
      checkedClaims: 1,
      totalClaims: 2,
      contradictedClaims: 0,
      uncheckedClaims: 1,
      contradictedMarkers: [],
      reviewedFor: undefined
    });
    expect(Object.keys(projection)).not.toContain('guarantee');
  });

  it('surfaces contradictions loudly: count, per-claim marker ids, and per-section counts', () => {
    const projection = projectShardProof(installShard(true));
    expect(projection.contradictedClaims).toBe(1);
    expect(projection.contradictedMarkers).toEqual(['c3']);
    expect(projection.totalClaims).toBe(3);
    // The Requirements section holds the checked claim AND the contradicted one.
    const requirements = projection.sections.find((section) => section.anchor === 'requirements');
    expect(requirements).toMatchObject({ checked: 1, total: 2, contradicted: 1 });
  });

  it("labels 'reviewed for' ONLY from a genuinely completed primary review — no fallback", () => {
    const shard = installShard();
    // No review at all: no label (never fallback-to-reviewed).
    expect(projectShardProof(shard).reviewedFor).toBeUndefined();
    // A FAILED primary review: recorded fact, but the label is withheld.
    expect(projectShardProof(withReviews(shard, [review({ completion: 'failed' })])).reviewedFor).toBeUndefined();
    // A completed SECONDARY review never masquerades as the primary label.
    expect(projectShardProof(withReviews(shard, [review({ role: 'secondary-advisory' })])).reviewedFor).toBeUndefined();
    // A "completed" review with NO evaluated criteria proves nothing was evaluated — label
    // withheld (impl-08 new defect; the schema also rejects such records at parse time).
    expect(projectShardProof(withReviews(shard, [review({ criteria: [] })])).reviewedFor).toBeUndefined();
    // Only the genuinely completed primary review (with criteria outcomes) earns the label.
    expect(projectShardProof(withReviews(shard, [review({})])).reviewedFor).toBe('app-developer');
  });

  it("projects the EXPLICIT 'unverified' state for a shard without a trust spine — never a silent 0/0 (impl-08)", () => {
    const bare = buildFixtureInput('unused-root').pages[1]!.shard;
    expect(projectShardProof(bare)).toMatchObject({
      state: 'unverified',
      checkedClaims: 0,
      totalClaims: 0,
      contradictedClaims: 0,
      contradictedMarkers: []
    });
  });
});
