import { describe, expect, it } from 'vitest';
import {
  claimClassTokenSchema,
  claimLedgerSchema,
  dependencySubscriptionSchema,
  evidenceRefSchema,
  isBuiltinClaimClass,
  isOwnerAttested,
  ledgerClaimSchema,
  writerClaimLedgerSchema
} from './claim-ledger-schema.ts';
import { buildFixtureClaimLedger, buildFixtureWriterClaimLedger } from './fixtures.ts';

const symbol = `ts:${'a'.repeat(64)}`;
const commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const hash = 'b'.repeat(64);
const evidenceId = 'ev_00000000000000000000';
const otherEvidenceId = 'ev_11111111111111111111';

const kernelClaim = (overrides: Record<string, unknown>) => ({
  claimId: 'cl_00000000000000000000',
  class: 'value',
  predicate: 'retry attempts default to 3',
  anchor: { blockId: 'bl_00000000000000000000', markerId: 'c1' },
  scope: { entityId: 'bl_00000000000000000000', revision: hash },
  subscriptions: [],
  evidence: [],
  correctness: 'unchecked',
  disposition: 'no-checker-available',
  ...overrides
});

describe('claim classes', () => {
  it('is an open token space with registered built-ins', () => {
    for (const cls of ['code-structure', 'value', 'behavior', 'intent-history']) {
      expect(claimClassTokenSchema.safeParse(cls).success).toBe(true);
      expect(isBuiltinClaimClass(cls)).toBe(true);
    }
    // Unknown classes are valid tokens — routed to unchecked/no-checker-available by the kernel.
    expect(claimClassTokenSchema.safeParse('api-compat').success).toBe(true);
    expect(isBuiltinClaimClass('api-compat')).toBe(false);
    expect(claimClassTokenSchema.safeParse('Not A Class').success).toBe(false);
  });

  it('does not register the dead names "shape" and "structural" as built-ins', () => {
    expect(isBuiltinClaimClass('shape')).toBe(false);
    expect(isBuiltinClaimClass('structural')).toBe(false);
  });
});

describe('evidence refs', () => {
  it('round-trips every evidence kind', () => {
    const refs = [
      { kind: 'codemap-grounding', symbol, file: 'src/retry.ts', span: [1, 4], commit },
      { kind: 'source-linked', symbol },
      { kind: 'value-predicate', symbol, valueName: 'retries.default', assertedValue: '3', extractedValue: '3' },
      { kind: 'execution', check: 'snippet-exec', environment: { os: 'linux' } },
      { kind: 'schema-check', check: 'openapi-response-shape' },
      { kind: 'owner-attestation', author: 'github:someuser', at: '2026-07-12T00:00:00.000Z' },
      { kind: 'external-citation', url: 'https://docs.example.com/limits', factId: 'kf_00000000000000000000' },
      { kind: 'project-defined', verifier: 'custom-links', plugin: 'docstube-plugin-links' }
    ];
    for (const ref of refs) {
      expect(evidenceRefSchema.safeParse(ref).success).toBe(true);
    }
  });

  it('requires the knowledge-fact linkage on external citations — origin must be revalidatable', () => {
    expect(evidenceRefSchema.safeParse({ kind: 'external-citation', url: 'https://docs.example.com' }).success).toBe(
      false
    );
    expect(
      evidenceRefSchema.safeParse({ kind: 'external-citation', url: 'https://docs.example.com', factId: 'not-an-id' })
        .success
    ).toBe(false);
  });

  it('defaults the execution sandbox to none', () => {
    const result = evidenceRefSchema.parse({ kind: 'execution', check: 'snippet-exec', environment: { os: 'linux' } });
    expect(result).toMatchObject({ environment: { sandbox: 'none' } });
  });

  it('rejects an unknown evidence kind and kind-mismatched payloads', () => {
    expect(evidenceRefSchema.safeParse({ kind: 'vibes' }).success).toBe(false);
    // owner-attestation requires authorship — an unattributed attestation is not evidence.
    expect(evidenceRefSchema.safeParse({ kind: 'owner-attestation' }).success).toBe(false);
    // value-predicate without the compared values is not a comparison.
    expect(evidenceRefSchema.safeParse({ kind: 'value-predicate', symbol }).success).toBe(false);
  });
});

describe('writer claim ledger', () => {
  it('round-trips the fixture writer ledger', () => {
    const ledger = buildFixtureWriterClaimLedger();
    const result = writerClaimLedgerSchema.safeParse(ledger);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(ledger);
  });

  it('carries nothing kernel-minted — a draft claim smuggling kernel fields is rejected', () => {
    const [claim] = buildFixtureWriterClaimLedger().claims;
    const withClaimId = {
      schemaVersion: 1,
      claims: [{ ...claim, claimId: 'cl_00000000000000000000' }]
    };
    expect(writerClaimLedgerSchema.safeParse(withClaimId).success).toBe(false);
    const withDisposition = {
      schemaVersion: 1,
      claims: [{ ...claim, correctness: 'checked', disposition: null }]
    };
    expect(writerClaimLedgerSchema.safeParse(withDisposition).success).toBe(false);
    // Proposed evidence handles only — verified evidence shapes are not writer vocabulary.
    const verified = {
      schemaVersion: 1,
      claims: [{ ...claim, proposedEvidence: [{ kind: 'codemap-grounding', symbol }] }]
    };
    expect(writerClaimLedgerSchema.safeParse(verified).success).toBe(false);
  });

  it('rejects duplicate marker ids — one inline marker anchors exactly one claim', () => {
    const ledger = buildFixtureWriterClaimLedger();
    const duplicated = { ...ledger, claims: [ledger.claims[0], ledger.claims[0]] };
    expect(writerClaimLedgerSchema.safeParse(duplicated).success).toBe(false);
  });

  it('rejects proposed evidence outside the handle union', () => {
    expect(
      writerClaimLedgerSchema.safeParse({
        schemaVersion: 1,
        claims: [
          {
            markerId: 'c1',
            class: 'value',
            predicate: 'x',
            proposedEvidence: [{ kind: 'hearsay', detail: 'trust me' }]
          }
        ]
      }).success
    ).toBe(false);
  });
});

// The full class/evidence authority table is enforced on the canonical ClaimEvidence records
// (provenance-v2-schema.spec.ts) — the ledger claim holds bare evidence ids and enforces only its
// LOCAL invariants below; handle ids ⊆ evidence records is a kernel commit invariant.
describe('correctness × disposition (local ledger invariants)', () => {
  it('requires an unresolved disposition on unchecked claims and forbids deciding evidence', () => {
    expect(ledgerClaimSchema.safeParse(kernelClaim({ disposition: null })).success).toBe(false);
    expect(ledgerClaimSchema.safeParse(kernelClaim({ disposition: 'owner-attested' })).success).toBe(false);
    for (const disposition of ['not-applicable', 'no-checker-available', 'maintainer-input-needed']) {
      expect(ledgerClaimSchema.safeParse(kernelClaim({ disposition })).success).toBe(true);
    }
    const decidedUnchecked = kernelClaim({
      evidence: [evidenceId],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(decidedUnchecked).success).toBe(false);
  });

  it('requires deciding evidence on checked and contradicted claims', () => {
    expect(ledgerClaimSchema.safeParse(kernelClaim({ correctness: 'checked', disposition: null })).success).toBe(false);
    expect(ledgerClaimSchema.safeParse(kernelClaim({ correctness: 'contradicted', disposition: null })).success).toBe(
      false
    );
    const contradicted = kernelClaim({
      correctness: 'contradicted',
      disposition: null,
      evidence: [evidenceId],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(contradicted).success).toBe(true);
  });

  it('forbids any disposition on contradicted claims', () => {
    const contradictedAttested = kernelClaim({
      correctness: 'contradicted',
      disposition: 'owner-attested',
      evidence: [evidenceId],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(contradictedAttested).success).toBe(false);
  });

  it('rejects a decidingEvidenceId that is not among the claim evidence ids', () => {
    const dangling = kernelClaim({
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceId],
      decidingEvidenceId: otherEvidenceId
    });
    expect(ledgerClaimSchema.safeParse(dangling).success).toBe(false);
  });

  it('rejects duplicate evidence ids within a claim — each canonical record is referenced at most once', () => {
    const duplicated = kernelClaim({
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceId, evidenceId],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(duplicated).success).toBe(false);
    const distinct = kernelClaim({
      correctness: 'checked',
      disposition: null,
      evidence: [evidenceId, otherEvidenceId],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(distinct).success).toBe(true);
  });

  it('rejects typed evidence handles — the ledger stores bare canonical evidence ids only', () => {
    const typedHandle = kernelClaim({
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'value-predicate' }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(typedHandle).success).toBe(false);
  });

  it('permits the owner-attested disposition only on checked intent-history claims', () => {
    const attested = ledgerClaimSchema.parse(
      kernelClaim({
        class: 'intent-history',
        correctness: 'checked',
        disposition: 'owner-attested',
        evidence: [evidenceId],
        decidingEvidenceId: evidenceId
      })
    );
    expect(isOwnerAttested(attested)).toBe(true);
    // A maintainer attestation cannot mint checked for value/behavior/code-structure claims.
    for (const cls of ['value', 'behavior', 'code-structure']) {
      const fakeAttested = kernelClaim({
        class: cls,
        correctness: 'checked',
        disposition: 'owner-attested',
        evidence: [evidenceId],
        decidingEvidenceId: evidenceId
      });
      expect(ledgerClaimSchema.safeParse(fakeAttested).success).toBe(false);
    }
    // Checked claims carry no other disposition.
    const unresolvedChecked = kernelClaim({
      correctness: 'checked',
      disposition: 'maintainer-input-needed',
      evidence: [evidenceId],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(unresolvedChecked).success).toBe(false);
    const mechanical = ledgerClaimSchema.parse(
      kernelClaim({
        correctness: 'checked',
        disposition: null,
        evidence: [evidenceId],
        decidingEvidenceId: evidenceId
      })
    );
    expect(isOwnerAttested(mechanical)).toBe(false);
  });
});

describe('dependency subscriptions', () => {
  it('requires the cited value only on cited-value subscriptions', () => {
    expect(dependencySubscriptionSchema.safeParse({ kind: 'signature', symbolHash: symbol }).success).toBe(true);
    expect(
      dependencySubscriptionSchema.safeParse({
        kind: 'cited-value',
        symbolHash: symbol,
        valueName: 'attempts',
        citedValue: '3'
      }).success
    ).toBe(true);
    expect(dependencySubscriptionSchema.safeParse({ kind: 'cited-value', symbolHash: symbol }).success).toBe(false);
    // The old public token 'value' is dead — 'cited-value' matches the fingerprint ladder.
    expect(
      dependencySubscriptionSchema.safeParse({
        kind: 'value',
        symbolHash: symbol,
        valueName: 'attempts',
        citedValue: '3'
      }).success
    ).toBe(false);
  });

  it('supports whole-file content subscriptions for unparsable files', () => {
    expect(
      dependencySubscriptionSchema.safeParse({ kind: 'file-content', file: 'package.json', contentHash: hash }).success
    ).toBe(true);
    expect(
      dependencySubscriptionSchema.safeParse({ kind: 'file-content', file: '/etc/passwd', contentHash: hash }).success
    ).toBe(false);
  });
});

describe('kernel claim ledger', () => {
  it('round-trips the fixture ledger', () => {
    const ledger = buildFixtureClaimLedger();
    const result = claimLedgerSchema.safeParse(ledger);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(ledger);
  });

  it('rejects a claim anchored without an inline marker id', () => {
    const ledger = buildFixtureClaimLedger();
    const [claim] = ledger.claims;
    const result = ledgerClaimSchema.safeParse({ ...claim, anchor: { blockId: claim?.anchor.blockId } });
    expect(result.success).toBe(false);
  });

  it('rejects a git commit as the claim scope revision — entity revisions are content-derived', () => {
    const ledger = buildFixtureClaimLedger();
    const [claim] = ledger.claims;
    const result = ledgerClaimSchema.safeParse({
      ...claim,
      scope: { entityId: claim?.scope.entityId, revision: commit }
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate claim ids — a committed claim identity appears exactly once', () => {
    const ledger = buildFixtureClaimLedger();
    const [claim] = ledger.claims;
    // An exact duplicate is rejected — the ledger is keyed by claim id.
    expect(claimLedgerSchema.safeParse({ ...ledger, claims: [claim, claim] }).success).toBe(false);
    // A duplicate id with DIVERGENT state is the dangerous forgery: two correctness values for
    // one canonical identity.
    const divergent = {
      ...claim,
      correctness: 'unchecked',
      disposition: 'no-checker-available',
      evidence: [],
      decidingEvidenceId: undefined
    };
    expect(claimLedgerSchema.safeParse({ ...ledger, claims: [claim, divergent] }).success).toBe(false);
    expect(claimLedgerSchema.safeParse(ledger).success).toBe(true);
  });

  it('defaults coverage lint and claim arrays', () => {
    const parsed = claimLedgerSchema.parse({
      schemaVersion: 1,
      pageId: 'pg_00000000000000000000',
      sourceRevision: commit
    });
    expect(parsed.claims).toEqual([]);
    expect(parsed.coverageLint).toEqual({ uncovered: [] });
  });
});
