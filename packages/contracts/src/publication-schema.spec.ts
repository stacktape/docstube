import { describe, expect, it } from 'vitest';
import { buildFixturePublicationDecision } from './fixtures.ts';
import { outputInventorySchema, publicationDecisionSchema, waiverSchema } from './publication-schema.ts';

const hash = 'a'.repeat(64);
const commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

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

  it('carries typed per-obligation coverage deltas from the documented status set', () => {
    const decision = buildFixturePublicationDecision();
    const regressed = {
      ...decision,
      coverageDelta: [
        { obligationId: 'ob-retry', scope: 'src/retry.ts', beforeStatus: 'documented', afterStatus: 'unassigned' }
      ]
    };
    expect(publicationDecisionSchema.safeParse(regressed).success).toBe(true);
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
