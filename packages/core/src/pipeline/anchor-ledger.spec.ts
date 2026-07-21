import { describe, expect, it } from 'vitest';
import { fingerprintSnapshotSchema, writerClaimLedgerSchema } from '@docstube/contracts';
import type { DraftClaim, FingerprintSnapshot } from '@docstube/contracts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { anchorWriterLedger } from './anchor-ledger.ts';

const COMMIT = 'a'.repeat(40);
const KNOWN_SYMBOL = `ts:${'1'.repeat(64)}`;
const UNKNOWN_SYMBOL = `ts:${'2'.repeat(64)}`;
const PRINT = '3'.repeat(64);
const FILE_HASH = '4'.repeat(64);

const fingerprints: FingerprintSnapshot = fingerprintSnapshotSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [
    {
      symbolHash: KNOWN_SYMBOL,
      signaturePrint: PRINT,
      valuePrints: { DEFAULT_RETRIES: PRINT },
      bodyPrint: PRINT
    }
  ],
  unparsedFiles: [{ file: 'package.json', contentHash: FILE_HASH }]
});

const mdx = `---
title: "Retry"
---

# Retry

<Claim id="c1">\`retries\` defaults to 3.</Claim>

## History

Some narrative. <Claim id="c2">Retries were added for flaky registries.</Claim>
`;

const ledger = (claims: unknown[]): ReturnType<typeof writerClaimLedgerSchema.parse> =>
  writerClaimLedgerSchema.parse({ schemaVersion: 1, claims });

const draft = (markerId: string, overrides: Partial<DraftClaim> = {}): unknown => ({
  markerId,
  class: 'value',
  predicate: 'retries defaults to 3',
  ...overrides
});

const anchorInput = (claims: unknown[]) => {
  const page = extractPageEntity({ mdx, slug: 'retry' });
  return { mdx, writerLedger: ledger(claims), page, fingerprints, commit: COMMIT };
};

describe('anchorWriterLedger', () => {
  it('maps each marker to its owning block, mints cl_ ids, and assigns the initial trust state', () => {
    const input = anchorInput([draft('c1'), draft('c2', { class: 'intent-history' })]);
    const result = anchorWriterLedger(input);

    expect(result.warnings).toEqual([]);
    expect(result.ledger.claims).toHaveLength(2);
    const [first, second] = result.ledger.claims;
    expect(first?.claimId).toMatch(/^cl_/);
    // c1 sits in the preamble block; c2 in the History section's paragraph.
    const preambleBlock = input.page.preamble[0]!;
    const historyBlock = input.page.sections[0]?.blocks[0]!;
    expect(first?.anchor).toEqual({ blockId: preambleBlock.id, markerId: 'c1' });
    expect(second?.anchor).toEqual({ blockId: historyBlock.id, markerId: 'c2' });
    // Scope is the content-derived block revision, never a git commit.
    expect(first?.scope).toEqual({ entityId: preambleBlock.id, revision: preambleBlock.contentHash });
    // Wave 2b-i: everything unchecked; disposition by class.
    expect(first).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    expect(second).toMatchObject({ correctness: 'unchecked', disposition: 'maintainer-input-needed' });
    expect(result.ledger.sourceRevision).toBe(COMMIT);
    expect(result.anchored[0]?.quote).toBe('`retries` defaults to 3.');
  });

  it('resolves subscriptions against the fingerprint snapshot and drops unknowns with warnings', () => {
    const input = anchorInput([
      draft('c1', {
        proposedSubscriptions: [
          { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'DEFAULT_RETRIES', citedValue: '3' },
          { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'NOT_A_VALUE', citedValue: '3' },
          { kind: 'signature', symbolHash: UNKNOWN_SYMBOL },
          { kind: 'file-content', file: 'package.json', contentHash: '0'.repeat(64) },
          { kind: 'file-content', file: 'missing.toml', contentHash: '0'.repeat(64) }
        ]
      } as Partial<DraftClaim>),
      draft('c2')
    ]);
    const result = anchorWriterLedger(input);

    const subscriptions = result.ledger.claims[0]?.subscriptions ?? [];
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[0]).toMatchObject({ kind: 'cited-value', valueName: 'DEFAULT_RETRIES' });
    // The snapshot's hash is authoritative for whole-file subscriptions — never the writer's.
    expect(subscriptions[1]).toMatchObject({ kind: 'file-content', file: 'package.json', contentHash: FILE_HASH });
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings[0]).toContain('no value named "NOT_A_VALUE"');
    expect(result.warnings[1]).toContain('is not in the fingerprint snapshot');
    expect(result.warnings[2]).toContain('missing.toml');
  });

  it('mints source-linked evidence for resolvable symbol proposals and drops unknown symbols', () => {
    const input = anchorInput([
      draft('c1', {
        proposedEvidence: [
          { kind: 'symbol', symbol: KNOWN_SYMBOL },
          { kind: 'symbol', symbol: UNKNOWN_SYMBOL },
          { kind: 'url', url: 'https://example.com/spec' }
        ]
      } as Partial<DraftClaim>),
      draft('c2')
    ]);
    const result = anchorWriterLedger(input);

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.evidenceId).toMatch(/^ev_/);
    expect(result.evidence[0]?.ref).toMatchObject({ kind: 'source-linked', symbol: KNOWN_SYMBOL });
    expect(result.evidence[0]?.outcome).toBe('pass');
    expect(result.ledger.claims[0]?.evidence).toEqual([result.evidence[0]?.evidenceId]);
    // Source-linked grounding never decides correctness — the claim stays unchecked.
    expect(result.ledger.claims[0]?.decidingEvidenceId).toBeUndefined();
    expect(result.warnings.some((warning) => warning.includes('symbol evidence dropped'))).toBe(true);
  });

  it('drops a claim whose marker sits outside every content block, with a warning', () => {
    const headingMdx = `# Title\n\n## <Claim id="h1">Heading claim</Claim>\n\nBody text.\n`;
    const page = extractPageEntity({ mdx: headingMdx, slug: 'h' });
    const result = anchorWriterLedger({
      mdx: headingMdx,
      writerLedger: ledger([draft('h1')]),
      page,
      fingerprints,
      commit: COMMIT
    });
    expect(result.ledger.claims).toHaveLength(0);
    expect(result.warnings[0]).toContain('does not sit inside any content block');
  });
});
