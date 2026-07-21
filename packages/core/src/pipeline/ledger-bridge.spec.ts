import { describe, expect, it } from 'vitest';
import { codemapSchema, fingerprintSnapshotSchema, writerClaimLedgerSchema } from '@docstube/contracts';
import { CoreError } from '../errors.ts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { anchorWriterLedger } from './anchor-ledger.ts';
import { attachLedgerClaims, guaranteeForCorrectness } from './ledger-bridge.ts';

const COMMIT = 'b'.repeat(40);
const fingerprints = fingerprintSnapshotSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [],
  unparsedFiles: []
});
const codemap = codemapSchema.parse({ schemaVersion: 1, commit: COMMIT, symbols: [] });
const observedReads = [{ file: 'src/greet.ts', contentHash: 'c'.repeat(64) }];

const mdx = `# Page

<Claim id="c1">\`greet\` exists.</Claim>

Second paragraph, no marker.
`;

const anchoredFixture = () => {
  const page = extractPageEntity({ mdx, slug: 'p' });
  // Fail-closed anchoring: code-dependent claims need a resolvable dependency proposal.
  const writerLedger = writerClaimLedgerSchema.parse({
    schemaVersion: 1,
    claims: [
      {
        markerId: 'c1',
        class: 'code-structure',
        predicate: 'greet exists',
        proposedSubscriptions: [{ kind: 'file-content', file: 'src/greet.ts' }]
      }
    ]
  });
  const result = anchorWriterLedger({ mdx, writerLedger, page, fingerprints, codemap, observedReads, commit: COMMIT });
  if (!result.ok) {
    throw new Error('fixture anchoring failed');
  }
  return { page, result };
};

describe('guaranteeForCorrectness', () => {
  it('maps checked to proven and unchecked to scored', () => {
    expect(guaranteeForCorrectness('checked')).toBe('proven');
    expect(guaranteeForCorrectness('unchecked')).toBe('scored');
  });

  it('THROWS on contradicted — a caught lie must never project as neutral scored content', () => {
    // Since 2b-ii, contradictions gate UPSTREAM: verifyClaims emits blocking claim-verification
    // findings, so the bridge only runs on the clean path. A contradicted claim reaching this
    // projection means someone bridged an ungated ledger — a kernel sequencing bug that must
    // hard-fail, because no legacy guarantee level can express "caught lie".
    expect(() => guaranteeForCorrectness('contradicted')).toThrowError(CoreError);
    expect(() => guaranteeForCorrectness('contradicted')).toThrowError(/contradicted/);
  });
});

describe('attachLedgerClaims', () => {
  it('derives legacy claim entities from the kernel ledger, reusing the minted claim id', () => {
    const { page, result } = anchoredFixture();
    const bridged = attachLedgerClaims(page, result.anchored);

    const markerBlock = bridged.preamble[0]!;
    expect(markerBlock.claims).toHaveLength(1);
    expect(markerBlock.claims[0]).toMatchObject({
      id: result.ledger.claims[0]?.claimId,
      kind: 'claim',
      text: 'greet exists',
      anchor: { quote: '`greet` exists.', prefix: '', suffix: '' },
      claimClass: 'code-structure',
      guarantee: 'scored'
    });
    // The claimless paragraph is untouched.
    expect(bridged.preamble[1]?.claims).toEqual([]);
  });

  it('REPLACES carried legacy claims — old trust state never survives the bridge', () => {
    const { page, result } = anchoredFixture();
    const carried = {
      id: `cl_${'0'.repeat(20)}`,
      kind: 'claim' as const,
      text: 'carried',
      anchor: { quote: 'carried', prefix: '', suffix: '' },
      claimClass: 'code-structure',
      guarantee: 'proven' as const
    };
    const withCarried = { ...page, preamble: [{ ...page.preamble[0]!, claims: [carried] }, page.preamble[1]!] };
    const bridged = attachLedgerClaims(withCarried, result.anchored);
    // The ledger is the only source: the stale 'proven' claim is gone, the ledger claim is there.
    expect(bridged.preamble[0]?.claims).toHaveLength(1);
    expect(bridged.preamble[0]?.claims[0]).toMatchObject({
      id: result.ledger.claims[0]?.claimId,
      guarantee: 'scored'
    });
    // A block the ledger anchors nothing to is cleared too — no orphaned legacy trust.
    const withStrayCarried = { ...page, preamble: [page.preamble[0]!, { ...page.preamble[1]!, claims: [carried] }] };
    const bridgedStray = attachLedgerClaims(withStrayCarried, result.anchored);
    expect(bridgedStray.preamble[1]?.claims).toEqual([]);
  });
});
