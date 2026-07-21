import { describe, expect, it } from 'vitest';
import { buildFixturePublicationDecision } from './fixtures.ts';
import { outputInventorySchema, publicationDecisionSchema, waiverSchema } from './publication-schema.ts';

const hash = 'a'.repeat(64);
const commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const coverageDowngrade = (beforeStatus: string, afterStatus: string) => [
  { obligationId: 'ob-retry', scope: 'src/retry.ts', beforeStatus, afterStatus }
];

describe('publication decision', () => {
  it('round-trips the fixture decision', () => {
    const decision = buildFixturePublicationDecision();
    const result = publicationDecisionSchema.safeParse(decision);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(decision);
  });

  it('represents a frozen run: paused-budget with deferred work and publishable false', () => {
    const result = publicationDecisionSchema.safeParse({
      ...buildFixturePublicationDecision(),
      execution: 'paused-budget',
      plan: { planned: 8, completed: 5, deferred: 3 },
      publishable: false,
      autoMergeEligible: false,
      reasonCodes: ['budget.frozen']
    });
    expect(result.success).toBe(true);
  });

  it('is fail-closed as a data contract — contradictory artifacts never parse', () => {
    const decision = buildFixturePublicationDecision();
    // A frozen run claiming publishable.
    expect(
      publicationDecisionSchema.safeParse({ ...decision, execution: 'paused-budget', reasonCodes: ['budget.frozen'] })
        .success
    ).toBe(false);
    // A failed run claiming publishable.
    expect(
      publicationDecisionSchema.safeParse({ ...decision, execution: 'failed', reasonCodes: ['execution.failed'] })
        .success
    ).toBe(false);
    // Deferred work claiming auto-merge eligibility.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        plan: { planned: 3, completed: 2, deferred: 1 },
        publishable: false,
        autoMergeEligible: true,
        reasonCodes: ['plan.deferred']
      }).success
    ).toBe(false);
    // Deferred work claiming publishable — an incomplete plan never publishes.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        plan: { planned: 3, completed: 2, deferred: 1 },
        publishable: true,
        autoMergeEligible: false,
        reasonCodes: ['plan.deferred']
      }).success
    ).toBe(false);
    // Deferred work is representable on a paused run with its budget reason stated.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        execution: 'paused-budget',
        plan: { planned: 3, completed: 2, deferred: 1 },
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['budget.frozen', 'plan.deferred']
      }).success
    ).toBe(true);
    // A completed run with deferred work is a contradiction — deferrals belong to paused/failed runs.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        execution: 'completed',
        plan: { planned: 3, completed: 2, deferred: 1 },
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['plan.deferred']
      }).success
    ).toBe(false);
    // A blocked gate with no stated reason.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        deterministicGate: 'blocked',
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: []
      }).success
    ).toBe(false);
    // Publishable with a blocked gate.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        deterministicGate: 'blocked',
        reasonCodes: ['gate.blocked']
      }).success
    ).toBe(false);
    // Auto-merge without publishable.
    expect(
      publicationDecisionSchema.safeParse({ ...decision, publishable: false, autoMergeEligible: true }).success
    ).toBe(false);
  });

  it('requires plan counts to reconcile — planned = completed + deferred', () => {
    const decision = buildFixturePublicationDecision();
    // The review probe: planned 3, completed 2, deferred 0 claiming publishable.
    expect(
      publicationDecisionSchema.safeParse({ ...decision, plan: { planned: 3, completed: 2, deferred: 0 } }).success
    ).toBe(false);
    // The arithmetic is unconditional — hidden work never parses even unpublished.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        plan: { planned: 3, completed: 2, deferred: 0 },
        publishable: false,
        autoMergeEligible: false
      }).success
    ).toBe(false);
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        execution: 'paused-budget',
        plan: { planned: 3, completed: 1, deferred: 1 },
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['budget.frozen']
      }).success
    ).toBe(false);
    expect(
      publicationDecisionSchema.safeParse({ ...decision, plan: { planned: 3, completed: 3, deferred: 0 } }).success
    ).toBe(true);
  });

  it('requires each blocking condition to state a reason code from its own family', () => {
    const decision = buildFixturePublicationDecision();
    const regression = { kind: 'badge-loss', pageId: 'pg_00000000000000000000' };
    // A ledger regression is NOT satisfiable by 'budget.frozen' alone.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        regressions: [regression],
        autoMergeEligible: false,
        reasonCodes: ['budget.frozen']
      }).success
    ).toBe(false);
    // A blocked gate needs the gate family code, not just any nonempty list.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        deterministicGate: 'blocked',
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['ledger.regression']
      }).success
    ).toBe(false);
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        deterministicGate: 'blocked',
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['gate.blocked']
      }).success
    ).toBe(true);
    // A budget-paused run must cite the budget family.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        execution: 'paused-budget',
        plan: { planned: 8, completed: 5, deferred: 3 },
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['plan.deferred']
      }).success
    ).toBe(false);
    // A failed run must cite the execution family.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        execution: 'failed',
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['gate.blocked']
      }).success
    ).toBe(false);
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        execution: 'failed',
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['execution.failed']
      }).success
    ).toBe(true);
    // A blocking disposition needs its own family code too.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        newBlockingDispositions: [
          { pageId: 'pg_00000000000000000000', claimId: 'cl_00000000000000000000', status: 'contradicted' }
        ],
        autoMergeEligible: false,
        reasonCodes: ['ledger.regression']
      }).success
    ).toBe(false);
  });

  it('rejects unknown execution states and reason codes outside the closed registry', () => {
    const decision = buildFixturePublicationDecision();
    expect(publicationDecisionSchema.safeParse({ ...decision, execution: 'partial' }).success).toBe(false);
    // Well-formed but unregistered codes fail closed — grammar-only validation is not enough.
    expect(publicationDecisionSchema.safeParse({ ...decision, reasonCodes: ['vibes.bad'] }).success).toBe(false);
    expect(publicationDecisionSchema.safeParse({ ...decision, reasonCodes: ['Not A Code'] }).success).toBe(false);
  });

  it('rejects unknown regression kinds', () => {
    const decision = {
      ...buildFixturePublicationDecision(),
      regressions: [{ kind: 'vibes-worse', pageId: 'pg_00000000000000000000' }]
    };
    expect(publicationDecisionSchema.safeParse(decision).success).toBe(false);
  });

  it('fails closed on ledger regressions and new blocking dispositions — never auto-merge eligible', () => {
    const decision = buildFixturePublicationDecision();
    const regression = { kind: 'badge-loss', pageId: 'pg_00000000000000000000' };
    // A regression claiming auto-merge eligibility never parses.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        regressions: [regression],
        reasonCodes: ['ledger.regression']
      }).success
    ).toBe(false);
    // With auto-merge off and a stated reason it is representable (publishable for human review).
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        regressions: [regression],
        autoMergeEligible: false,
        reasonCodes: ['ledger.regression']
      }).success
    ).toBe(true);
    // A regression without reason codes hides its cause — rejected.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        regressions: [regression],
        autoMergeEligible: false,
        reasonCodes: []
      }).success
    ).toBe(false);
    const blocking = {
      pageId: 'pg_00000000000000000000',
      claimId: 'cl_00000000000000000000',
      status: 'contradicted'
    };
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        newBlockingDispositions: [blocking],
        reasonCodes: ['ledger.blocking-disposition']
      }).success
    ).toBe(false);
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        newBlockingDispositions: [blocking],
        autoMergeEligible: false,
        reasonCodes: ['ledger.blocking-disposition']
      }).success
    ).toBe(true);
  });

  it('carries typed per-obligation coverage deltas from the documented status set', () => {
    const decision = buildFixturePublicationDecision();
    const regressedDelta = [
      { obligationId: 'ob-retry', scope: 'src/retry.ts', beforeStatus: 'documented', afterStatus: 'unassigned' }
    ];
    // A documented → unassigned regression is new coverage debt: it fails closed and must never
    // remain auto-merge eligible or hide its reason.
    expect(publicationDecisionSchema.safeParse({ ...decision, coverageDelta: regressedDelta }).success).toBe(false);
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        coverageDelta: regressedDelta,
        autoMergeEligible: false,
        reasonCodes: []
      }).success
    ).toBe(false);
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        coverageDelta: regressedDelta,
        autoMergeEligible: false,
        reasonCodes: ['coverage.regression']
      }).success
    ).toBe(true);
    const unknownStatus = {
      ...decision,
      coverageDelta: [
        { obligationId: 'ob-retry', scope: 'src/retry.ts', beforeStatus: 'covered', afterStatus: 'documented' }
      ]
    };
    expect(publicationDecisionSchema.safeParse(unknownStatus).success).toBe(false);
    // The old count-only shape is dead.
    expect(publicationDecisionSchema.safeParse({ ...decision, coverageDelta: { before: 10, after: 12 } }).success).toBe(
      false
    );
  });

  it('treats any coverage-rank decrease as a regression — documented → generated-reference-only fails closed', () => {
    const decision = buildFixturePublicationDecision();
    // The review probe: a status downgrade that never reaches 'unassigned' is still new debt.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        coverageDelta: coverageDowngrade('documented', 'generated-reference-only')
      }).success
    ).toBe(false);
    // With auto-merge off it still must state the coverage family code.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        coverageDelta: coverageDowngrade('documented', 'generated-reference-only'),
        autoMergeEligible: false,
        reasonCodes: ['ledger.regression']
      }).success
    ).toBe(false);
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        coverageDelta: coverageDowngrade('documented', 'generated-reference-only'),
        autoMergeEligible: false,
        reasonCodes: ['coverage.regression']
      }).success
    ).toBe(true);
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        coverageDelta: coverageDowngrade('generated-reference-only', 'unassigned')
      }).success
    ).toBe(false);
    // Rank increases are never regressions.
    expect(
      publicationDecisionSchema.safeParse({
        ...decision,
        coverageDelta: coverageDowngrade('generated-reference-only', 'documented')
      }).success
    ).toBe(true);
  });

  it('exempts transitions into user-declared statuses — a policy declaration is not coverage debt', () => {
    const decision = buildFixturePublicationDecision();
    for (const declared of ['intentionally-omitted', 'not-public-for-docs']) {
      const result = publicationDecisionSchema.safeParse({
        ...decision,
        coverageDelta: [
          { obligationId: 'ob-retry', scope: 'src/retry.ts', beforeStatus: 'documented', afterStatus: declared }
        ]
      });
      // Auto-merge stays eligible with no coverage reason code required.
      expect(result.success).toBe(true);
    }
  });
});

describe('output inventory', () => {
  it('requires repo-relative paths with content hashes', () => {
    const ok = outputInventorySchema.safeParse({
      schemaVersion: 1,
      entries: [{ path: 'docs-site/src/content/en/setup.mdx', contentHash: hash }]
    });
    expect(ok.success).toBe(true);
    const absolute = outputInventorySchema.safeParse({
      schemaVersion: 1,
      entries: [{ path: '/etc/passwd', contentHash: hash }]
    });
    expect(absolute.success).toBe(false);
  });

  it('rejects duplicate paths — the allowlist maps each path to exactly one hash', () => {
    const path = 'docs-site/src/content/en/setup.mdx';
    // A duplicate path with a conflicting hash is an ambiguous allowlist.
    expect(
      outputInventorySchema.safeParse({
        schemaVersion: 1,
        entries: [
          { path, contentHash: hash },
          { path, contentHash: 'b'.repeat(64) }
        ]
      }).success
    ).toBe(false);
    // An exact duplicate is rejected too — the inventory is a map, not a bag.
    expect(
      outputInventorySchema.safeParse({
        schemaVersion: 1,
        entries: [
          { path, contentHash: hash },
          { path, contentHash: hash }
        ]
      }).success
    ).toBe(false);
    expect(
      outputInventorySchema.safeParse({
        schemaVersion: 1,
        entries: [
          { path, contentHash: hash },
          { path: 'docs-site/src/content/en/intro.mdx', contentHash: hash }
        ]
      }).success
    ).toBe(true);
  });
});

describe('waivers', () => {
  const base = {
    schemaVersion: 1,
    waiverId: 'wv_00000000000000000000',
    actor: 'github:someuser',
    timestamp: '2026-07-12T00:00:00.000Z',
    reason: 'known upstream doc bug, tracked in #42',
    grantedAgainst: { fingerprint: hash, commit }
  };

  it('scopes to claim, page, project, or system with a stable id and grant fingerprint', () => {
    const claimWaiver = waiverSchema.safeParse({
      ...base,
      scope: { kind: 'claim', pageId: 'pg_00000000000000000000', claimId: 'cl_00000000000000000000' },
      policySource: 'dashboard',
      expiry: '2026-09-01T00:00:00.000Z'
    });
    expect(claimWaiver.success).toBe(true);
    // policySource is optional; project/system scopes carry no entity binding.
    expect(waiverSchema.safeParse({ ...base, scope: { kind: 'project' } }).success).toBe(true);
    expect(waiverSchema.safeParse({ ...base, scope: { kind: 'system' } }).success).toBe(true);
  });

  it('rejects a claim scope without its claim id and a project scope smuggling one', () => {
    const missingClaim = waiverSchema.safeParse({
      ...base,
      scope: { kind: 'claim', pageId: 'pg_00000000000000000000' }
    });
    expect(missingClaim.success).toBe(false);
    const smuggled = waiverSchema.safeParse({
      ...base,
      scope: { kind: 'project', claimId: 'cl_00000000000000000000' }
    });
    expect(smuggled.success).toBe(false);
  });

  it('requires the granted-against fingerprint — waivers invalidate on material change', () => {
    const { grantedAgainst: _grantedAgainst, ...withoutGrant } = base;
    const result = waiverSchema.safeParse({
      ...withoutGrant,
      scope: { kind: 'page', pageId: 'pg_00000000000000000000' }
    });
    expect(result.success).toBe(false);
  });
});
