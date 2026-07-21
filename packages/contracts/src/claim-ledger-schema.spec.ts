import { describe, expect, it } from 'vitest';
import {
  claimClassV2Schema,
  claimDispositionSchema,
  claimLedgerSchema,
  evidenceRefSchema,
  fingerprintSubscriptionSchema,
  isOwnerAttested,
  ledgerClaimSchema
} from './claim-ledger-schema.ts';
import { buildFixtureClaimLedger } from './fixtures.ts';

const symbol = `ts:${'a'.repeat(64)}`;
const commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

describe('claim classes v2', () => {
  it('accepts code-structure and rejects the reserved legacy name "structural"', () => {
    expect(claimClassV2Schema.safeParse('code-structure').success).toBe(true);
    expect(claimClassV2Schema.safeParse('structural').success).toBe(false);
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
      const result = evidenceRefSchema.safeParse(ref);
      expect(result.success).toBe(true);
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

  it('carries a contradicted value-predicate mismatch as deciding evidence', () => {
    const result = claimDispositionSchema.safeParse({
      status: 'contradicted',
      evidence: { kind: 'value-predicate', symbol, valueName: 'retries.default', assertedValue: '3', extractedValue: '5' },
      detail: 'docs assert 3, source says 5'
    });
    expect(result.success).toBe(true);
  });
});

describe('claim disposition', () => {
  it('requires deciding evidence on checked and contradicted, a reason on unchecked', () => {
    expect(
      claimDispositionSchema.safeParse({ status: 'checked', evidence: { kind: 'source-linked', symbol } }).success
    ).toBe(true);
    expect(claimDispositionSchema.safeParse({ status: 'checked' }).success).toBe(false);
    expect(claimDispositionSchema.safeParse({ status: 'unchecked', reason: 'needs-owner-input' }).success).toBe(true);
    expect(claimDispositionSchema.safeParse({ status: 'unchecked', reason: 'out-of-domain' }).success).toBe(false);
    expect(claimDispositionSchema.safeParse({ status: 'contradicted' }).success).toBe(false);
  });

  it('recognizes owner attestation as checked-with-attestation-evidence', () => {
    const attested = claimDispositionSchema.parse({
      status: 'checked',
      evidence: { kind: 'owner-attestation', author: 'github:someuser', at: '2026-07-12T00:00:00.000Z' }
    });
    const mechanical = claimDispositionSchema.parse({
      status: 'checked',
      evidence: { kind: 'codemap-grounding', symbol }
    });
    expect(isOwnerAttested(attested)).toBe(true);
    expect(isOwnerAttested(mechanical)).toBe(false);
  });
});

describe('fingerprint subscriptions', () => {
  it('requires the cited value only on value subscriptions', () => {
    expect(fingerprintSubscriptionSchema.safeParse({ kind: 'signature', symbolHash: symbol }).success).toBe(true);
    expect(
      fingerprintSubscriptionSchema.safeParse({
        kind: 'value',
        symbolHash: symbol,
        valueName: 'attempts',
        citedValue: '3'
      }).success
    ).toBe(true);
    expect(fingerprintSubscriptionSchema.safeParse({ kind: 'value', symbolHash: symbol }).success).toBe(false);
  });
});

describe('claim ledger', () => {
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
