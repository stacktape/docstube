import { describe, expect, it } from 'vitest';
import { codemapSchema, fingerprintSnapshotSchema, writerClaimLedgerSchema } from '@docstube/contracts';
import type { ClaimEntity, PageEntity } from '@docstube/contracts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { matchEntityIds } from '../entities/match-entities.ts';
import { anchorWriterLedger } from './anchor-ledger.ts';
import { matchClaimIds } from './match-claims.ts';

const COMMIT = 'd'.repeat(40);
const fingerprints = fingerprintSnapshotSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [],
  unparsedFiles: []
});
const codemap = codemapSchema.parse({ schemaVersion: 1, commit: COMMIT, symbols: [] });
const observedReads = [{ file: 'src/greet.ts', contentHash: 'e'.repeat(64) }];

const mdx = `# Page

<Claim id="c1">\`greet\` exists.</Claim>

<Claim id="c2">\`retries\` defaults to 3.</Claim>
`;

const anchorFor = (page: PageEntity) => {
  // Code-dependent claims must carry a resolvable dependency (fail-closed anchoring): a
  // cooperating writer proposes the source file; the kernel resolves the hash from observed reads.
  const writerLedger = writerClaimLedgerSchema.parse({
    schemaVersion: 1,
    claims: [
      {
        markerId: 'c1',
        class: 'code-structure',
        predicate: 'greet exists',
        proposedSubscriptions: [{ kind: 'file-content', file: 'src/greet.ts' }]
      },
      {
        markerId: 'c2',
        class: 'value',
        predicate: 'retries defaults to 3',
        proposedSubscriptions: [{ kind: 'file-content', file: 'src/greet.ts' }]
      }
    ]
  });
  const result = anchorWriterLedger({ mdx, writerLedger, page, fingerprints, codemap, observedReads, commit: COMMIT });
  if (!result.ok) {
    throw new Error('fixture anchoring failed');
  }
  return result;
};

const previousClaim = (blockQuote: string, overrides: Partial<ClaimEntity> = {}): ClaimEntity => ({
  id: `cl_${'9'.repeat(20)}`,
  kind: 'claim',
  text: 'greet exists',
  anchor: { quote: blockQuote, prefix: '', suffix: '' },
  claimClass: 'code-structure',
  guarantee: 'proven',
  ...overrides
});

describe('matchClaimIds', () => {
  it('reuses the previous claim id for the same assertion on the same block thread — nothing else carries', () => {
    // Previous run: same MDX, so block matching threads identical block ids.
    const previousPage = extractPageEntity({ mdx, slug: 'p' });
    const previousWithClaims: PageEntity = {
      ...previousPage,
      preamble: [
        { ...previousPage.preamble[0]!, claims: [previousClaim('`greet` exists.')] },
        previousPage.preamble[1]!
      ]
    };
    // Fresh regeneration of unchanged MDX, block ids matched against the previous shard.
    const fresh = matchEntityIds(extractPageEntity({ mdx, slug: 'p' }), previousWithClaims).page;
    const anchoredLedger = anchorFor(fresh);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousPage: previousWithClaims
    });

    // Identity carries: one claim id shared by the previous shard and the new ledger.
    expect(matched.ledger.claims[0]?.claimId).toBe(`cl_${'9'.repeat(20)}`);
    expect(matched.anchored[0]?.claim.claimId).toBe(`cl_${'9'.repeat(20)}`);
    // Trust does NOT: the matched claim is in the fresh unchecked state despite the previous
    // claim's 'proven' guarantee.
    expect(matched.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    // The unmatched claim keeps its freshly minted id.
    expect(matched.ledger.claims[1]?.claimId).toBe(anchoredLedger.ledger.claims[1]?.claimId);
  });

  it('matches on predicate when the prose was rephrased but the assertion is unchanged', () => {
    const previousPage = extractPageEntity({ mdx, slug: 'p' });
    const previousWithClaims: PageEntity = {
      ...previousPage,
      preamble: [
        {
          ...previousPage.preamble[0]!,
          claims: [previousClaim('The `greet` function is exported.', { text: 'greet exists' })]
        },
        previousPage.preamble[1]!
      ]
    };
    const fresh = matchEntityIds(extractPageEntity({ mdx, slug: 'p' }), previousWithClaims).page;
    const anchoredLedger = anchorFor(fresh);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousPage: previousWithClaims
    });
    expect(matched.ledger.claims[0]?.claimId).toBe(`cl_${'9'.repeat(20)}`);
  });

  it('never matches across block threads or claim classes', () => {
    const previousPage = extractPageEntity({ mdx, slug: 'p' });
    const previousWithClaims: PageEntity = {
      ...previousPage,
      preamble: [
        previousPage.preamble[0]!,
        // Same quote/predicate but on the OTHER block, and with a different class.
        {
          ...previousPage.preamble[1]!,
          claims: [previousClaim('`greet` exists.', { claimClass: 'behavior' })]
        }
      ]
    };
    const fresh = matchEntityIds(extractPageEntity({ mdx, slug: 'p' }), previousWithClaims).page;
    const anchoredLedger = anchorFor(fresh);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousPage: previousWithClaims
    });
    // No block-thread + class agreement anywhere: every id stays freshly minted.
    expect(matched.ledger.claims.map((claim) => claim.claimId)).toEqual(
      anchoredLedger.ledger.claims.map((claim) => claim.claimId)
    );
  });

  it('reports a confident match as typed metadata: freshId → priorId with confidence exact', () => {
    const previousPage = extractPageEntity({ mdx, slug: 'p' });
    const previousWithClaims: PageEntity = {
      ...previousPage,
      preamble: [
        { ...previousPage.preamble[0]!, claims: [previousClaim('`greet` exists.')] },
        previousPage.preamble[1]!
      ]
    };
    const fresh = matchEntityIds(extractPageEntity({ mdx, slug: 'p' }), previousWithClaims).page;
    const anchoredLedger = anchorFor(fresh);
    const freshId = anchoredLedger.ledger.claims[0]?.claimId;
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousPage: previousWithClaims
    });
    expect(matched.matches).toEqual([{ freshId, priorId: `cl_${'9'.repeat(20)}`, confidence: 'exact' }]);
    expect(matched.orphans).toEqual([]);
  });

  it('threads through MULTIPLE equal candidates but records the drift marker (confidence ambiguous)', () => {
    // Two prior claims on the same block are byte-identical (same class, same quote, same text):
    // the fresh claim cannot distinguish them. The id must still carry — human threads need an
    // identity — but the match is recorded 'ambiguous' and the unused twin surfaces as an orphan.
    const twinA = previousClaim('`greet` exists.', { id: `cl_${'7'.repeat(20)}` });
    const twinB = previousClaim('`greet` exists.', { id: `cl_${'8'.repeat(20)}` });
    const previousPage = extractPageEntity({ mdx, slug: 'p' });
    const previousWithClaims: PageEntity = {
      ...previousPage,
      preamble: [{ ...previousPage.preamble[0]!, claims: [twinA, twinB] }, previousPage.preamble[1]!]
    };
    const fresh = matchEntityIds(extractPageEntity({ mdx, slug: 'p' }), previousWithClaims).page;
    const anchoredLedger = anchorFor(fresh);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousPage: previousWithClaims
    });
    // Deterministic pick (document order) with the drift marker recorded on the match result.
    expect(matched.ledger.claims[0]?.claimId).toBe(twinA.id);
    expect(matched.matches).toHaveLength(1);
    expect(matched.matches[0]).toMatchObject({ priorId: twinA.id, confidence: 'ambiguous' });
    // The unmatched twin is an explicit orphan, never a silent disappearance.
    expect(matched.orphans).toEqual([twinB.id]);
  });

  it('surfaces prior claims that matched nothing as orphans', () => {
    const orphaned = previousClaim('`gone` was removed.', {
      id: `cl_${'6'.repeat(20)}`,
      text: 'gone was removed',
      claimClass: 'intent-history'
    });
    const previousPage = extractPageEntity({ mdx, slug: 'p' });
    const previousWithClaims: PageEntity = {
      ...previousPage,
      preamble: [
        { ...previousPage.preamble[0]!, claims: [previousClaim('`greet` exists.'), orphaned] },
        previousPage.preamble[1]!
      ]
    };
    const fresh = matchEntityIds(extractPageEntity({ mdx, slug: 'p' }), previousWithClaims).page;
    const anchoredLedger = anchorFor(fresh);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousPage: previousWithClaims
    });
    expect(matched.matches).toHaveLength(1);
    expect(matched.orphans).toEqual([orphaned.id]);
  });

  it('is the identity when there is no previous page', () => {
    const fresh = extractPageEntity({ mdx, slug: 'p' });
    const anchoredLedger = anchorFor(fresh);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousPage: undefined
    });
    expect(matched.ledger).toBe(anchoredLedger.ledger);
    expect(matched.matches).toEqual([]);
    expect(matched.orphans).toEqual([]);
  });
});
