import { describe, expect, it } from 'vitest';
import { buildFixturePublicationDecision } from './fixtures.ts';
import { outputInventorySchema, publicationDecisionSchema, waiverSchema } from './publication-schema.ts';

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

  it('rejects unknown execution states and malformed reason codes', () => {
    const decision = buildFixturePublicationDecision();
    expect(publicationDecisionSchema.safeParse({ ...decision, execution: 'partial' }).success).toBe(false);
    expect(publicationDecisionSchema.safeParse({ ...decision, reasonCodes: ['Not A Code'] }).success).toBe(false);
  });

  it('rejects unknown regression kinds', () => {
    const decision = {
      ...buildFixturePublicationDecision(),
      regressions: [{ kind: 'vibes-worse', pageId: 'pg_00000000000000000000' }]
    };
    expect(publicationDecisionSchema.safeParse(decision).success).toBe(false);
  });
});

describe('output inventory', () => {
  it('requires repo-relative paths with content hashes', () => {
    const ok = outputInventorySchema.safeParse({
      schemaVersion: 1,
      entries: [{ path: 'docs-site/src/content/en/setup.mdx', contentHash: 'a'.repeat(64) }]
    });
    expect(ok.success).toBe(true);
    const absolute = outputInventorySchema.safeParse({
      schemaVersion: 1,
      entries: [{ path: '/etc/passwd', contentHash: 'a'.repeat(64) }]
    });
    expect(absolute.success).toBe(false);
  });
});

describe('waivers', () => {
  it('scopes to a claim or a page and records actor, reason, and policy source', () => {
    const claimWaiver = waiverSchema.safeParse({
      actor: 'github:someuser',
      timestamp: '2026-07-12T00:00:00.000Z',
      reason: 'known upstream doc bug, tracked in #42',
      scope: { kind: 'claim', pageId: 'pg_00000000000000000000', claimId: 'cl_00000000000000000000' },
      policySource: 'dashboard',
      expiry: '2026-09-01T00:00:00.000Z'
    });
    expect(claimWaiver.success).toBe(true);
    // A claim-scoped waiver without the claim id is not a valid scope.
    const missingClaim = waiverSchema.safeParse({
      actor: 'github:someuser',
      timestamp: '2026-07-12T00:00:00.000Z',
      reason: 'known upstream doc bug',
      scope: { kind: 'claim', pageId: 'pg_00000000000000000000' },
      policySource: 'dashboard'
    });
    expect(missingClaim.success).toBe(false);
  });
});
