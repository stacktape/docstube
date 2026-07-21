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
      { kind: 'external-citation', url: 'https://docs.example.com/limits' },
      { kind: 'project-defined', verifier: 'custom-links', plugin: 'docstube-plugin-links' }
    ];
    for (const ref of refs) {
      expect(evidenceRefSchema.safeParse(ref).success).toBe(true);
    }
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

describe('class/evidence authority table', () => {
  it('rejects checked-via-source-linked on a value claim', () => {
    const claim = kernelClaim({
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'source-linked' }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(claim).success).toBe(false);
  });

  it('rejects checked-via-codemap-grounding on value and behavior claims', () => {
    for (const cls of ['value', 'behavior']) {
      const claim = kernelClaim({
        class: cls,
        correctness: 'checked',
        disposition: null,
        evidence: [{ evidenceId, kind: 'codemap-grounding' }],
        decidingEvidenceId: evidenceId
      });
      expect(ledgerClaimSchema.safeParse(claim).success).toBe(false);
    }
  });

  it('accepts codemap-grounding as the deciding check for a code-structure claim', () => {
    const claim = kernelClaim({
      class: 'code-structure',
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'codemap-grounding' }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(claim).success).toBe(true);
  });

  it('accepts value-predicate for value claims but not for behavior claims', () => {
    const valueClaim = kernelClaim({
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'value-predicate' }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(valueClaim).success).toBe(true);
    const behaviorClaim = kernelClaim({
      class: 'behavior',
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'value-predicate' }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(behaviorClaim).success).toBe(false);
  });

  it('lets unpromoted project-defined evidence exist but never mint checked', () => {
    const unpromoted = kernelClaim({
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'project-defined', promoted: false }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(unpromoted).success).toBe(false);
    const promoted = kernelClaim({
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'project-defined', promoted: true }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(promoted).success).toBe(true);
    // Non-deciding unpromoted evidence may sit on an unchecked claim.
    const collected = kernelClaim({ evidence: [{ evidenceId, kind: 'project-defined', promoted: false }] });
    expect(ledgerClaimSchema.safeParse(collected).success).toBe(true);
  });

  it('restricts intent-history to owner attestation or external citation', () => {
    const attested = kernelClaim({
      class: 'intent-history',
      correctness: 'checked',
      disposition: 'owner-attested',
      evidence: [{ evidenceId, kind: 'owner-attestation' }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(attested).success).toBe(true);
    const grounded = kernelClaim({
      class: 'intent-history',
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'codemap-grounding' }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(grounded).success).toBe(false);
  });

  it('routes unknown classes to unchecked unless a promoted project-defined verifier decided', () => {
    const unknownChecked = kernelClaim({
      class: 'api-compat',
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'execution' }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(unknownChecked).success).toBe(false);
    const unknownUnchecked = kernelClaim({ class: 'api-compat' });
    expect(ledgerClaimSchema.safeParse(unknownUnchecked).success).toBe(true);
    const unknownPromoted = kernelClaim({
      class: 'api-compat',
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'project-defined', promoted: true }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(unknownPromoted).success).toBe(true);
  });
});

describe('correctness × disposition', () => {
  it('requires an unresolved disposition on unchecked claims and forbids deciding evidence', () => {
    expect(ledgerClaimSchema.safeParse(kernelClaim({ disposition: null })).success).toBe(false);
    expect(ledgerClaimSchema.safeParse(kernelClaim({ disposition: 'owner-attested' })).success).toBe(false);
    for (const disposition of ['not-applicable', 'no-checker-available', 'maintainer-input-needed']) {
      expect(ledgerClaimSchema.safeParse(kernelClaim({ disposition })).success).toBe(true);
    }
    const decidedUnchecked = kernelClaim({
      evidence: [{ evidenceId, kind: 'value-predicate' }],
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
      evidence: [{ evidenceId, kind: 'value-predicate' }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(contradicted).success).toBe(true);
  });

  it('rejects a decidingEvidenceId that resolves to no evidence handle', () => {
    const dangling = kernelClaim({
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'value-predicate' }],
      decidingEvidenceId: otherEvidenceId
    });
    expect(ledgerClaimSchema.safeParse(dangling).success).toBe(false);
  });

  it('binds the owner-attested disposition to attestation-decided checked claims, both ways', () => {
    const attested = ledgerClaimSchema.parse(
      kernelClaim({
        class: 'intent-history',
        correctness: 'checked',
        disposition: 'owner-attested',
        evidence: [{ evidenceId, kind: 'owner-attestation' }],
        decidingEvidenceId: evidenceId
      })
    );
    expect(isOwnerAttested(attested)).toBe(true);
    // Attestation-decided without the disposition — inconsistent.
    const missingDisposition = kernelClaim({
      class: 'intent-history',
      correctness: 'checked',
      disposition: null,
      evidence: [{ evidenceId, kind: 'owner-attestation' }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(missingDisposition).success).toBe(false);
    // Mechanical check claiming the attested disposition — inconsistent.
    const fakeAttested = kernelClaim({
      correctness: 'checked',
      disposition: 'owner-attested',
      evidence: [{ evidenceId, kind: 'value-predicate' }],
      decidingEvidenceId: evidenceId
    });
    expect(ledgerClaimSchema.safeParse(fakeAttested).success).toBe(false);
    const mechanical = ledgerClaimSchema.parse(
      kernelClaim({
        correctness: 'checked',
        disposition: null,
        evidence: [{ evidenceId, kind: 'value-predicate' }],
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
