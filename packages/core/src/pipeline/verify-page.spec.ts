import { describe, expect, it } from 'vitest';
import { buildFixturePage, contentHash, idPrefixes, mintId } from '@docstube/contracts';
import type { BlockEntity, ClaimEntity, PageEntity } from '@docstube/contracts';
import { liftClaimGroundedBlocks, recomputeRollups } from './verify-page.ts';

const emptyProvenance = { sources: [], seedContext: [], observedReads: [], verifications: [] };

const proseBlock = (text: string, claims: ClaimEntity[] = []): BlockEntity => ({
  id: mintId(idPrefixes.block),
  kind: 'block',
  blockType: 'paragraph',
  contentHash: contentHash(text),
  variants: [],
  claims,
  guarantee: 'scored',
  provenance: emptyProvenance
});

const claim = (guarantee: ClaimEntity['guarantee']): ClaimEntity => ({
  id: mintId(idPrefixes.claim),
  kind: 'claim',
  text: 'retry stops after the configured attempts',
  anchor: { quote: 'stops after the configured attempts', prefix: '', suffix: '' },
  claimClass: 'behavioral',
  guarantee
});

const pageWith = (blocks: BlockEntity[]): PageEntity => {
  const fixture = buildFixturePage();
  return { ...fixture, preamble: [], sections: [{ ...fixture.sections[0]!, blocks }] };
};

describe('recomputeRollups (provable-only, founder decision 2026-07-17)', () => {
  it('claimless narrative never drags a proven code block down', () => {
    const code = { ...proseBlock('npm install'), blockType: 'code-example' as const, guarantee: 'proven' as const };
    const page = recomputeRollups(pageWith([proseBlock('Some intro text.'), code]));
    expect(page.sections[0]?.guarantee).toBe('proven');
    expect(page.guarantee).toBe('proven');
  });

  it('an unproven provable block still holds the page at scored', () => {
    const code = { ...proseBlock('npm install'), blockType: 'code-example' as const, guarantee: 'scored' as const };
    const page = recomputeRollups(pageWith([code]));
    expect(page.guarantee).toBe('scored');
  });

  it('a page with nothing provable is scored, and ODD blocks are excluded from the roll-up', () => {
    const odd = { ...proseBlock('why we deprecated X', [claim('out-of-domain')]), guarantee: 'out-of-domain' as const };
    const code = { ...proseBlock('npm install'), blockType: 'code-example' as const, guarantee: 'proven' as const };
    expect(recomputeRollups(pageWith([proseBlock('Only narrative.')])).guarantee).toBe('scored');
    expect(recomputeRollups(pageWith([odd, code])).guarantee).toBe('proven');
  });
});

describe('liftClaimGroundedBlocks', () => {
  it('a prose block whose every claim grounded becomes proven and the page follows', () => {
    const grounded = proseBlock('It stops after the configured attempts.', [claim('proven')]);
    const page = liftClaimGroundedBlocks(pageWith([grounded, proseBlock('Narrative.')]));
    expect(page.sections[0]?.blocks[0]?.guarantee).toBe('proven');
    expect(page.guarantee).toBe('proven');
  });

  it('one ungrounded claim keeps the block (and page) at scored', () => {
    const half = proseBlock('Half grounded.', [claim('proven'), claim('scored')]);
    const page = liftClaimGroundedBlocks(pageWith([half]));
    expect(page.sections[0]?.blocks[0]?.guarantee).toBe('scored');
    expect(page.guarantee).toBe('scored');
  });
});
