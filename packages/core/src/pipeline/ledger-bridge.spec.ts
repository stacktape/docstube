import { describe, expect, it } from 'vitest';
import { fingerprintSnapshotSchema, writerClaimLedgerSchema } from '@docstube/contracts';
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

const mdx = `# Page

<Claim id="c1">\`greet\` exists.</Claim>

Second paragraph, no marker.
`;

const anchoredFixture = () => {
  const page = extractPageEntity({ mdx, slug: 'p' });
  const writerLedger = writerClaimLedgerSchema.parse({
    schemaVersion: 1,
    claims: [{ markerId: 'c1', class: 'code-structure', predicate: 'greet exists' }]
  });
  return { page, result: anchorWriterLedger({ mdx, writerLedger, page, fingerprints, commit: COMMIT }) };
};

describe('guaranteeForCorrectness', () => {
  it('maps checked to proven and everything else to scored', () => {
    expect(guaranteeForCorrectness('checked')).toBe('proven');
    expect(guaranteeForCorrectness('unchecked')).toBe('scored');
    // 2b-ii turns contradictions into gating findings; until then they never count as proven.
    expect(guaranteeForCorrectness('contradicted')).toBe('scored');
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

  it('keeps claims carried by the entity-matching pass instead of overwriting stable ids', () => {
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
    expect(bridged.preamble[0]?.claims).toEqual([carried]);
  });
});
