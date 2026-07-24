import { describe, expect, it } from 'vitest';
import { extractPageEntity } from './extract-entities.ts';
import { matchEntityIds } from './match-entities.ts';

const v1 = `# Guide

Intro paragraph.

## Setup

Step one text.

\`\`\`ts
const a = 1;
\`\`\`

## Usage

Usage text.
`;

describe('matchEntityIds', () => {
  it('keeps ids for unchanged content across regeneration', () => {
    const previous = extractPageEntity({ mdx: v1, slug: 'guide' });
    const fresh = extractPageEntity({ mdx: v1, slug: 'guide' });
    const { page, tombstonedIds } = matchEntityIds(fresh, previous);
    expect(page.id).toBe(previous.id);
    expect(page.sections.map((section) => section.id)).toEqual(previous.sections.map((section) => section.id));
    expect(page.sections[0]?.blocks.map((block) => block.id)).toEqual(
      previous.sections[0]?.blocks.map((block) => block.id)
    );
    expect(tombstonedIds).toEqual([]);
  });

  it('keeps section id when its content is edited, keeps moved blocks by content', () => {
    const previous = extractPageEntity({ mdx: v1, slug: 'guide' });
    const edited = `# Guide

Intro paragraph.

## Setup

Step one text, now with more detail.

## Usage

Usage text.

\`\`\`ts
const a = 1;
\`\`\`
`;
    const fresh = extractPageEntity({ mdx: edited, slug: 'guide' });
    const { page } = matchEntityIds(fresh, previous);
    // Section ids survive by title.
    expect(page.sections.map((section) => section.id)).toEqual(previous.sections.map((section) => section.id));
    // The code block moved from Setup to Usage but content is identical → id survives.
    const previousCodeId = previous.sections[0]?.blocks[1]?.id;
    const movedCodeId = page.sections[1]?.blocks[1]?.id;
    expect(movedCodeId).toBe(previousCodeId);
    // The edited paragraph keeps its id positionally (same section, same type, same ordinal).
    expect(page.sections[0]?.blocks[0]?.id).toBe(previous.sections[0]?.blocks[0]?.id);
  });

  it('never carries claim trust state — identity carries, trust lives on the ledger (no entity claim field exists)', () => {
    const previous = extractPageEntity({ mdx: v1, slug: 'guide' });
    const fresh = extractPageEntity({ mdx: v1, slug: 'guide' });
    const { page, tombstonedIds } = matchEntityIds(fresh, previous);
    // The block id carries; blocks carry NO claim/guarantee state at all anymore — the ledger +
    // ClaimEvidence own trust (wave 2b demolition of the legacy ClaimEntity model).
    expect(page.preamble[0]?.id).toBe(previous.preamble[0]?.id);
    expect(Object.keys(page.preamble[0] ?? {})).not.toContain('claims');
    expect(Object.keys(page.preamble[0] ?? {})).not.toContain('guarantee');
    expect(tombstonedIds).toEqual([]);
  });

  it('tombstones ids of removed content and never reuses them', () => {
    const previous = extractPageEntity({ mdx: v1, slug: 'guide' });
    const shrunk = `# Guide

Intro paragraph.

## Setup

Step one text.
`;
    const fresh = extractPageEntity({ mdx: shrunk, slug: 'guide' });
    const { page, tombstonedIds } = matchEntityIds(fresh, previous);
    const usageSection = previous.sections[1];
    expect(tombstonedIds).toContain(usageSection?.id);
    expect(tombstonedIds).toContain(usageSection?.blocks[0]?.id);
    // The removed code block's id is gone too.
    expect(tombstonedIds).toContain(previous.sections[0]?.blocks[1]?.id);
    const survivingIds = new Set([page.id, ...page.sections.map((section) => section.id)]);
    for (const tombstoned of tombstonedIds) {
      expect(survivingIds.has(tombstoned)).toBe(false);
    }
  });
});
