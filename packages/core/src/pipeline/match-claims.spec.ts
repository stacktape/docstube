import { describe, expect, it } from 'vitest';
import {
  codemapSchema,
  entityRevisionSchema,
  fingerprintSnapshotSchema,
  gitCommitSchema,
  writerClaimLedgerSchema
} from '@docstube/contracts';
import type { ClaimLedger, LedgerClaim, PageEntity } from '@docstube/contracts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { matchEntityIds } from '../entities/match-entities.ts';
import type { BlockMatchConfidence } from '../entities/match-entities.ts';
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

const anchorFor = (
  page: PageEntity,
  source: string = mdx,
  claims?: Array<{ markerId: string } & Record<string, unknown>>
) => {
  // Code-dependent claims must carry a resolvable dependency (fail-closed anchoring): a
  // cooperating writer proposes the source file; the kernel resolves the hash from observed reads.
  const writerLedger = writerClaimLedgerSchema.parse({
    schemaVersion: 1,
    claims: claims ?? [
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
  const result = anchorWriterLedger({
    mdx: source,
    writerLedger,
    page,
    fingerprints,
    codemap,
    observedReads,
    commit: COMMIT
  });
  if (!result.ok) {
    throw new Error(`fixture anchoring failed: ${result.errors.map((issue) => issue.message).join('; ')}`);
  }
  return result;
};

// A prior KERNEL ledger claim (the previous shard's committed state). Deliberately typed, not
// parsed: matching never reads prior trust, so the fixture keeps the neutral unchecked state.
const priorClaim = (input: {
  id: string;
  blockId: string;
  quote?: string;
  predicate?: string;
  claimClass?: string;
}): LedgerClaim => ({
  claimId: input.id,
  class: input.claimClass ?? 'code-structure',
  predicate: input.predicate ?? 'greet exists',
  anchor: { blockId: input.blockId, markerId: 'c1' },
  quote: input.quote ?? '`greet` exists.',
  scope: { entityId: input.blockId, revision: entityRevisionSchema.parse('e'.repeat(64)) },
  subscriptions: [],
  evidence: [],
  correctness: 'unchecked',
  disposition: 'no-checker-available'
});

const priorLedgerOf = (pageId: string, claims: LedgerClaim[]): ClaimLedger => ({
  schemaVersion: 1,
  pageId,
  sourceRevision: gitCommitSchema.parse(COMMIT),
  claims,
  coverageLint: { uncovered: [] }
});

const ID_A = `cl_${'7'.repeat(20)}`;
const ID_B = `cl_${'8'.repeat(20)}`;
const ID_C = `cl_${'9'.repeat(20)}`;

// Rethread the fresh extraction against the previous page, exactly like the page runner does.
const rethread = (previousPage: PageEntity, source: string = mdx) => {
  const matchedPage = matchEntityIds(extractPageEntity({ mdx: source, slug: 'p' }), previousPage);
  return { fresh: matchedPage.page, blockConfidence: matchedPage.blockConfidence };
};

const exactConfidence = (page: PageEntity): Map<string, BlockMatchConfidence> => {
  const blocks = [...page.preamble, ...page.sections.flatMap((section) => section.blocks)];
  return new Map(blocks.map((block) => [block.id, 'exact']));
};

describe('matchClaimIds', () => {
  it('reuses the previous claim id for the same assertion on the same block thread — nothing else carries', () => {
    const previousPage = extractPageEntity({ mdx, slug: 'p' });
    const { fresh, blockConfidence } = rethread(previousPage);
    const anchoredLedger = anchorFor(fresh);
    const previousLedger = priorLedgerOf(previousPage.id, [
      priorClaim({ id: ID_C, blockId: previousPage.preamble[0]!.id })
    ]);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousLedger,
      blockConfidence
    });

    // Identity carries: one claim id shared by the previous ledger and the new one.
    expect(matched.ledger.claims[0]?.claimId).toBe(ID_C);
    expect(matched.anchored[0]?.claim.claimId).toBe(ID_C);
    // Trust does NOT: the matched claim is in the fresh unchecked state, rebuilt from this run.
    expect(matched.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    // The unmatched claim keeps its freshly minted id.
    expect(matched.ledger.claims[1]?.claimId).toBe(anchoredLedger.ledger.claims[1]?.claimId);
    // Typed records: an exact match with no drift, persisted shape.
    expect(matched.matching.matches).toEqual([{ claimId: ID_C, confidence: 'exact', drift: [] }]);
    expect(matched.matching.orphans).toEqual([]);
  });

  it('matches on predicate when the prose was rephrased but the assertion is unchanged', () => {
    const previousPage = extractPageEntity({ mdx, slug: 'p' });
    const { fresh, blockConfidence } = rethread(previousPage);
    const anchoredLedger = anchorFor(fresh);
    const previousLedger = priorLedgerOf(previousPage.id, [
      priorClaim({ id: ID_C, blockId: previousPage.preamble[0]!.id, quote: 'The `greet` function is exported.' })
    ]);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousLedger,
      blockConfidence
    });
    expect(matched.ledger.claims[0]?.claimId).toBe(ID_C);
  });

  it('never matches across block threads or claim classes', () => {
    const previousPage = extractPageEntity({ mdx, slug: 'p' });
    const { fresh, blockConfidence } = rethread(previousPage);
    const anchoredLedger = anchorFor(fresh);
    const previousLedger = priorLedgerOf(previousPage.id, [
      // Same quote/predicate but on the OTHER block, and with a different class.
      priorClaim({ id: ID_C, blockId: previousPage.preamble[1]!.id, claimClass: 'behavior' })
    ]);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousLedger,
      blockConfidence
    });
    // No block-thread + class agreement anywhere: every id stays freshly minted.
    expect(matched.ledger.claims.map((claim) => claim.claimId)).toEqual(
      anchoredLedger.ledger.claims.map((claim) => claim.claimId)
    );
    expect(matched.matching.orphans).toEqual([{ claimId: ID_C }]);
  });

  it('marks EVERY match in a non-unique bipartite component ambiguous (impl-06 finding 4 probe)', () => {
    // Two identical fresh claims × two identical prior claims: one connected component with
    // alternative assignments. The old greedy count-after-assignment recorded the second pairing
    // 'exact'; component solving marks BOTH ambiguous.
    const twinMdx = `# Page

<Claim id="c1">\`greet\` exists.</Claim> and <Claim id="c2">\`greet\` exists.</Claim>
`;
    const twinClaims = [
      {
        markerId: 'c1',
        class: 'code-structure',
        predicate: 'greet exists',
        proposedSubscriptions: [{ kind: 'file-content', file: 'src/greet.ts' }]
      },
      {
        markerId: 'c2',
        class: 'code-structure',
        predicate: 'greet exists',
        proposedSubscriptions: [{ kind: 'file-content', file: 'src/greet.ts' }]
      }
    ];
    const previousPage = extractPageEntity({ mdx: twinMdx, slug: 'p' });
    const { fresh, blockConfidence } = rethread(previousPage, twinMdx);
    const anchoredLedger = anchorFor(fresh, twinMdx, twinClaims);
    const blockId = previousPage.preamble[0]!.id;
    const previousLedger = priorLedgerOf(previousPage.id, [
      priorClaim({ id: ID_A, blockId }),
      priorClaim({ id: ID_B, blockId })
    ]);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousLedger,
      blockConfidence
    });
    expect(matched.matches).toHaveLength(2);
    for (const match of matched.matches) {
      expect(match.confidence).toBe('ambiguous');
      expect(match.drift).toContain('equal-candidates');
    }
    // Both ids still carry deterministically; no orphans.
    expect(new Set(matched.ledger.claims.map((claim) => claim.claimId))).toEqual(new Set([ID_A, ID_B]));
    expect(matched.matching.orphans).toEqual([]);
  });

  it('a unique claim candidate on a POSITIONALLY threaded (content-changed) block is never exact', () => {
    // The previous page's paragraph read differently: block matching threads it positionally
    // (same slot, changed content). Even though the claim-level candidate is unique (predicate
    // equality), the thread rests on a guessed block identity — ambiguous, drift recorded.
    const previousMdx = `# Page

<Claim id="c1">The \`greet\` helper is available.</Claim>

<Claim id="c2">\`retries\` defaults to 3.</Claim>
`;
    const previousPage = extractPageEntity({ mdx: previousMdx, slug: 'p' });
    const { fresh, blockConfidence } = rethread(previousPage);
    const anchoredLedger = anchorFor(fresh);
    const previousLedger = priorLedgerOf(previousPage.id, [
      priorClaim({
        id: ID_C,
        blockId: previousPage.preamble[0]!.id,
        quote: 'The `greet` helper is available.',
        predicate: 'greet exists'
      })
    ]);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousLedger,
      blockConfidence
    });
    expect(matched.ledger.claims[0]?.claimId).toBe(ID_C);
    expect(matched.matches[0]).toMatchObject({ confidence: 'ambiguous' });
    expect(matched.matches[0]?.drift).toContain('block-thread-inexact');
  });

  it('surfaces prior claims that matched nothing as orphans', () => {
    const previousPage = extractPageEntity({ mdx, slug: 'p' });
    const { fresh, blockConfidence } = rethread(previousPage);
    const anchoredLedger = anchorFor(fresh);
    const previousLedger = priorLedgerOf(previousPage.id, [
      priorClaim({ id: ID_C, blockId: previousPage.preamble[0]!.id }),
      priorClaim({
        id: ID_A,
        blockId: previousPage.preamble[0]!.id,
        quote: '`gone` was removed.',
        predicate: 'gone was removed',
        claimClass: 'intent-history'
      })
    ]);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousLedger,
      blockConfidence
    });
    expect(matched.matches).toHaveLength(1);
    expect(matched.orphans).toEqual([ID_A]);
    expect(matched.matching.orphans).toEqual([{ claimId: ID_A }]);
  });

  it('is the identity when there is no previous ledger', () => {
    const fresh = extractPageEntity({ mdx, slug: 'p' });
    const anchoredLedger = anchorFor(fresh);
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousLedger: undefined,
      blockConfidence: exactConfidence(fresh)
    });
    expect(matched.ledger).toBe(anchoredLedger.ledger);
    expect(matched.matches).toEqual([]);
    expect(matched.orphans).toEqual([]);
  });
});
