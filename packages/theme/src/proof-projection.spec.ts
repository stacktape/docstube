import { describe, expect, it } from 'vitest';
import type { PageShard, PersonaReview, RiskCriticFinding, RiskCriticResult } from '@docstube/contracts';
import { riskCriticResultSchema } from '@docstube/contracts';
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

// NO HIDDEN DENOMINATOR (harness-state-v2 decision 5, PRODUCT §1.2): a complete badge means the
// ledger is fully checked AND the coverage linter found nothing assertion-shaped left unmarked.
const allChecked = (shard: PageShard): PageShard => {
  if (shard.ledger === undefined || shard.provenance === undefined) {
    throw new Error('fixture shard is missing its trust spine');
  }
  return {
    ...shard,
    provenance: {
      ...shard.provenance,
      claimEvidence: shard.provenance.claimEvidence.map((record) => ({ ...record, correctness: 'checked' as const }))
    }
  };
};

const withUncovered = (shard: PageShard, count: number): PageShard => {
  const ledger = shard.ledger;
  if (ledger === undefined) {
    throw new Error('fixture shard is missing its ledger');
  }
  return {
    ...shard,
    ledger: {
      ...ledger,
      coverageLint: {
        uncovered: Array.from({ length: count }, (_, index) => ({
          blockId: ledger.claims[0]!.anchor.blockId,
          excerpt: `The \`option${index}\` defaults to 5.`,
          detector: 'identifier-with-numeric-literal'
        }))
      }
    }
  };
};

describe('projectShardProof — coverage lint gates the complete state', () => {
  it('is complete only when every claim is checked and nothing is left unmarked', () => {
    const projection = projectShardProof(allChecked(installShard()));
    expect(projection).toMatchObject({ checkedClaims: 2, totalClaims: 2, uncoveredAssertions: 0, complete: true });
  });

  it('is NEVER complete while an unmarked assertion exists — the ledger alone cannot mint the badge', () => {
    const projection = projectShardProof(withUncovered(allChecked(installShard()), 2));
    // Identical ledger state as above; the only difference is the linter's report.
    expect(projection.checkedClaims).toBe(2);
    expect(projection.totalClaims).toBe(2);
    expect(projection.uncoveredAssertions).toBe(2);
    expect(projection.complete).toBe(false);
  });

  it('a partially checked page is not complete either, uncovered or not', () => {
    expect(projectShardProof(installShard()).complete).toBe(false);
  });

  it('an unverified shard reports zero uncovered assertions and is never complete', () => {
    const projection = projectUnboundShardProof(withUncovered(allChecked(installShard()), 3));
    expect(projection).toMatchObject({ state: 'unverified', uncoveredAssertions: 0, complete: false });
  });
});

// THE CRITIC IS REPORTED WITH THE LINTER AND GATES NOTHING (harness-state-v2 decision 4,
// PRODUCT §1.2). The deterministic floor decides the badge; the critic's semantic layer is
// advisory and sits next to it so a reader gets one honest coverage picture.
const withRiskCritic = (shard: PageShard, critic: RiskCriticResult): PageShard => {
  if (shard.provenance === undefined) {
    throw new Error('fixture shard is missing its trust spine');
  }
  return {
    ...shard,
    provenance: { ...shard.provenance, assessments: { ...shard.provenance.assessments, riskCritic: critic } }
  };
};

const criticWith = (kinds: RiskCriticFinding['kind'][], shard: PageShard): RiskCriticResult =>
  riskCriticResultSchema.parse({
    scoredBy: 'model',
    completion: 'completed',
    promptVersion: '1',
    findings: kinds.map((kind) => ({
      kind,
      anchor: { kind: 'block', blockId: shard.ledger!.claims[0]!.anchor.blockId },
      severity: 'error',
      message: `a ${kind} problem`,
      rationale: 'grounded in the evidence summary'
    }))
  });

describe('projectShardProof — the risk critic never moves the complete badge', () => {
  it('does not WITHHOLD the badge: a clean page stays complete under severe critic findings', () => {
    const clean = allChecked(installShard());
    expect(projectShardProof(clean).complete).toBe(true);
    const critiqued = withRiskCritic(clean, criticWith(['misleading-framing', 'unmarked-assertion'], clean));
    const projection = projectShardProof(critiqued);
    // A model's editorial opinion must not be able to fail a page whose claims all check out.
    expect(projection.complete).toBe(true);
    expect(projection.riskCriticFindings).toBe(2);
    expect(projection.semanticAssertionRisks).toBe(1);
    // …and the deterministic count is still reported, unchanged, right beside it.
    expect(projection.uncoveredAssertions).toBe(0);
  });

  it('does not GRANT the badge: an uncovered span still forbids completeness however clean the critic was', () => {
    const linted = withUncovered(allChecked(installShard()), 2);
    const projection = projectShardProof(
      withRiskCritic(
        linted,
        riskCriticResultSchema.parse({ scoredBy: 'model', completion: 'completed', promptVersion: '1', findings: [] })
      )
    );
    expect(projection.riskCritic).toBe('completed');
    expect(projection.riskCriticFindings).toBe(0);
    expect(projection.uncoveredAssertions).toBe(2);
    expect(projection.complete).toBe(false);
  });

  it('says pending rather than clean when no verdict exists, and still lets the page be complete', () => {
    const clean = allChecked(installShard());
    // A page nobody assessed reports that fact — never silence, never an implied pass. And, exactly
    // like an unrun persona review, it does not block publication.
    expect(projectShardProof(clean).riskCritic).toBe('not-run');
    const pending = withRiskCritic(
      clean,
      riskCriticResultSchema.parse({ scoredBy: 'model', completion: 'pending', promptVersion: '1', findings: [] })
    );
    const projection = projectShardProof(pending);
    expect(projection.riskCritic).toBe('pending');
    expect(projection.riskCriticFindings).toBe(0);
    expect(projection.complete).toBe(true);
  });

  it('drops a stale critic verdict along with the rest of the trust spine on an unbound shard', () => {
    const clean = allChecked(installShard());
    const critiqued = withRiskCritic(clean, criticWith(['dangerous-omission'], clean));
    expect(projectUnboundShardProof(critiqued)).toMatchObject({
      state: 'unverified',
      riskCritic: 'not-run',
      riskCriticFindings: 0
    });
  });
});

// A DIRTY WORKING TREE CANNOT MINT THE COMPLETE STATE (wave 2b close, spine finding): the checks
// are content-hash bound and genuinely happened, so the COUNTS stay honest — what degrades is the
// CLAIM, because the badge asserts something about committed source.
const withDirtyTree = (shard: PageShard, dirty: boolean): PageShard => {
  if (shard.provenance === undefined) {
    throw new Error('fixture shard is missing its trust spine');
  }
  return {
    ...shard,
    provenance: {
      ...shard.provenance,
      lineage: dirty
        ? { ...shard.provenance.lineage, dirtyWorkingTree: true }
        : { ...shard.provenance.lineage, dirtyWorkingTree: false }
    }
  };
};

describe('projectShardProof — a dirty working tree withholds the complete state', () => {
  it('keeps the true counts at N/N with zero uncovered, but is never complete', () => {
    const projection = projectShardProof(withDirtyTree(allChecked(installShard()), true));
    expect(projection).toMatchObject({
      state: 'verified',
      checkedClaims: 2,
      totalClaims: 2,
      contradictedClaims: 0,
      uncoveredAssertions: 0,
      dirtyWorkingTree: true,
      complete: false
    });
  });

  it('is complete for the SAME shard once the tree is clean — the flag is the only difference', () => {
    const projection = projectShardProof(withDirtyTree(allChecked(installShard()), false));
    expect(projection).toMatchObject({ checkedClaims: 2, totalClaims: 2, dirtyWorkingTree: false, complete: true });
  });

  it('carries the marker through the UNBOUND projection too — it can never be laundered away', () => {
    expect(projectUnboundShardProof(withDirtyTree(allChecked(installShard()), true))).toMatchObject({
      state: 'unverified',
      dirtyWorkingTree: true,
      complete: false
    });
  });
});

// UNRENDERABLE ANCHORS ARE CHIPLESS (impl-23 finding 3): a punctuation-only heading renders as
// id="" in Astro, so no chip could ever resolve there — shipping one would let it land on whatever
// element answered the lookup instead.
describe('projectShardProof — section chips skip unrenderable anchors', () => {
  it('omits the chip for a section whose heading slugged to nothing', () => {
    const shard = installShard();
    const withPunctuationHeading: PageShard = {
      ...shard,
      page: {
        ...shard.page,
        sections: [...shard.page.sections, { ...shard.page.sections[0]!, anchor: '#unrenderable-1', blocks: [] }]
      }
    };
    const anchors = projectShardProof(withPunctuationHeading).sections.map((section) => section.anchor);
    expect(anchors).toEqual(['requirements']);
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
