import { describe, expect, it } from 'vitest';
import type { PageShard, PersonaReview } from '@docstube/contracts';
import { buildFixtureInput, installMdx } from './emit-site-fixture.ts';
import { checkShardMdxBinding, projectShardProof, projectUnboundShardProof } from './proof-projection.ts';

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
      // The unchecked claim is individually addressable — the theme marks it inline (impl-09).
      uncheckedMarkers: ['c2'],
      reviewedFor: undefined
    });
    expect(Object.keys(projection)).not.toContain('guarantee');
  });

  it('surfaces contradictions loudly: count, per-claim marker ids, and per-section counts', () => {
    const projection = projectShardProof(installShard(true));
    expect(projection.contradictedClaims).toBe(1);
    expect(projection.contradictedMarkers).toEqual(['c3']);
    // The contradicted claim is NEVER in the unchecked list — the lists stay distinct.
    expect(projection.uncheckedMarkers).toEqual(['c2']);
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

  it('impl-12 (fail-closed grammar, reader side): a shard whose claims are all UNCHECKED can never render as fully checked', () => {
    // The kernel side of the impl-12 probe (core checkability-full-spine.spec) proves the spine
    // persists "`greet` is absent." as unchecked ClaimEvidence. This is the projection side: the
    // literal projection of an all-unchecked shard counts 0 checked and marks every claim
    // unchecked — there is no path to a "1/1 checked" rendering without a 'checked' record.
    const shard = installShard();
    if (shard.ledger === undefined || shard.provenance === undefined) {
      throw new Error('fixture shard is missing its trust spine');
    }
    const allUnchecked: PageShard = {
      ...shard,
      ledger: {
        ...shard.ledger,
        claims: shard.ledger.claims.map((claim) => {
          const { decidingEvidenceId: _dropped, ...rest } = claim;
          return { ...rest, correctness: 'unchecked' as const, disposition: 'no-checker-available' as const };
        })
      },
      provenance: {
        ...shard.provenance,
        claimEvidence: shard.provenance.claimEvidence.map((record) => {
          const { decidingEvidenceId: _dropped, ...rest } = record;
          return { ...rest, correctness: 'unchecked' as const, disposition: 'no-checker-available' as const };
        })
      }
    };
    const projection = projectShardProof(allUnchecked);
    expect(projection).toMatchObject({
      state: 'verified',
      checkedClaims: 0,
      totalClaims: 2,
      contradictedClaims: 0,
      uncheckedClaims: 2,
      uncheckedMarkers: ['c1', 'c2']
    });
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

describe('checkShardMdxBinding + projectUnboundShardProof (MDX↔shard binding, wave 2b close final)', () => {
  it('accepts the matched pair: the shard hash equals the persisted MDX content hash', () => {
    expect(checkShardMdxBinding(installShard(), installMdx)).toEqual({ ok: true });
  });

  it('refuses tampered MDX with a reason naming the mismatch', () => {
    const check = checkShardMdxBinding(installShard(), `${installMdx}\nEdited after persistence.\n`);
    expect(check).toMatchObject({
      ok: false,
      code: 'hash-mismatch',
      reason: expect.stringContaining('does not match')
    });
    expect(check).toMatchObject({ reason: expect.stringContaining('UNVERIFIED') });
  });

  it('refuses a shard with no recorded hash (pre-hash shard) — fail closed, never assumed bound', () => {
    const { mdxContentHash: _dropped, ...shard } = installShard();
    const check = checkShardMdxBinding(shard as PageShard, installMdx);
    expect(check).toMatchObject({ ok: false, code: 'missing-hash' });
  });

  it('projects an unbound shard EXACTLY like the no-trust-spine unverified state — no stale counts or marks', () => {
    const projection = projectUnboundShardProof(installShard(true));
    expect(projection).toMatchObject({
      state: 'unverified',
      checkedClaims: 0,
      totalClaims: 0,
      contradictedClaims: 0,
      uncheckedClaims: 0,
      contradictedMarkers: [],
      uncheckedMarkers: [],
      reviewedFor: undefined
    });
  });
});
