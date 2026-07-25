import { describe, expect, it } from 'vitest';
import { headingInventory, markerPlacements, translationHygieneErrors } from './translate-page.ts';

// Block-scoped ordered marker equality + heading inventory (wave 2b close): set equality alone
// lets a translator swap two marker ids between sentences, and global sequence equality still
// lets a marker slide into another same-typed block — both attach the canonical marks to prose the
// claim never described. The hygiene check compares the (owning block, marker id) pairs in
// document order plus the heading skeleton, and it NEVER throws: malformed model output becomes a
// nonblocking hygiene failure for that page-locale.

const sourceMdx = `---
title: Getting started
---

# Getting started

<Claim id="c1">The library exposes a single \`greet\` function.</Claim>

## Usage

<Claim id="c2">The default retry count is 3.</Claim>
`;

const sourceMarkerIds = markerPlacements(sourceMdx);
const sourceHeadings = headingInventory(sourceMdx);

describe('translationHygieneErrors — ordered marker equality', () => {
  it('passes a rendition with the identical marker sequence and heading inventory', () => {
    const translated = sourceMdx
      .replace('# Getting started', '# Erste Schritte')
      .replace(
        'The library exposes a single `greet` function.',
        'Die Bibliothek stellt eine einzige `greet`-Funktion bereit.'
      )
      .replace('## Usage', '## Verwendung')
      .replace('The default retry count is 3.', 'Die Standardanzahl der Wiederholungen ist 3.');
    expect(translationHygieneErrors(translated, sourceMarkerIds, sourceHeadings)).toEqual([]);
  });

  it('fails a rendition that SWAPS c1/c2 between sentences — set-equal but order-broken', () => {
    // Both ids exist exactly once (set equality holds); each marker now wraps the OTHER sentence.
    const swapped = sourceMdx
      .replace('<Claim id="c1">', '<Claim id="c2">')
      .replace(
        '<Claim id="c2">The default retry count is 3.</Claim>',
        '<Claim id="c1">Die Standardanzahl ist 3.</Claim>'
      );
    const errors = translationHygieneErrors(swapped, sourceMarkerIds, sourceHeadings);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('[marker-order]');
    expect(errors[0]).toContain('"c2", "c1"');
    expect(errors[0]).toContain('"c1", "c2"');
  });

  it('still fails renames/additions/removals with the set-level isomorphism error', () => {
    const renamed = sourceMdx.replace('<Claim id="c2">', '<Claim id="c9">');
    const errors = translationHygieneErrors(renamed, sourceMarkerIds, sourceHeadings);
    expect(errors.some((error) => error.includes('[marker-isomorphism]'))).toBe(true);
    expect(errors.some((error) => error.includes('[marker-order]'))).toBe(false);
  });
});

describe('translationHygieneErrors — heading inventory', () => {
  it('fails a rendition that changes a heading depth', () => {
    const deepened = sourceMdx.replace('## Usage', '### Usage');
    const errors = translationHygieneErrors(deepened, sourceMarkerIds, sourceHeadings);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('[heading-inventory]');
    expect(errors[0]).toContain('h1 h3');
    expect(errors[0]).toContain('h1 h2');
  });

  it('fails a rendition that drops or invents a heading', () => {
    const dropped = sourceMdx.replace('## Usage\n\n', '');
    expect(
      translationHygieneErrors(dropped, sourceMarkerIds, sourceHeadings).some((error) =>
        error.includes('[heading-inventory]')
      )
    ).toBe(true);
    const invented = `${sourceMdx}\n## Extra\n`;
    expect(
      translationHygieneErrors(invented, sourceMarkerIds, sourceHeadings).some((error) =>
        error.includes('[heading-inventory]')
      )
    ).toBe(true);
  });
});

describe('translationHygieneErrors — block-scoped placement', () => {
  // Two same-typed (paragraph) blocks under one heading: moving c2 from the second into the first
  // keeps the GLOBAL marker sequence "c1, c2" intact, so the order check alone passes — while c2's
  // canonical trust mark now annotates a completely different sentence.
  const twoParagraphSource = `---
title: Getting started
---

# Getting started

<Claim id="c1">The library exposes a single \`greet\` function.</Claim>

## Usage

Plain lead-in prose with <Claim id="c2">the default retry count is 3</Claim>.

A second paragraph that says something else entirely.
`;
  const placements = markerPlacements(twoParagraphSource);
  const headings = headingInventory(twoParagraphSource);

  it('records the owning block index of every marker in document order', () => {
    expect(placements).toEqual([
      { blockIndex: 0, markerId: 'c1' },
      { blockIndex: 1, markerId: 'c2' }
    ]);
  });

  it('fails a marker relocated into ANOTHER same-typed block, even with the global order preserved', () => {
    const relocated = twoParagraphSource
      .replace('Plain lead-in prose with <Claim id="c2">the default retry count is 3</Claim>.', 'Plain lead-in prose.')
      .replace(
        'A second paragraph that says something else entirely.',
        'A second paragraph with <Claim id="c2">the default retry count is 3</Claim>.'
      );
    const errors = translationHygieneErrors(relocated, placements, headings);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('[marker-block]');
    expect(errors[0]).toContain('"c2"@block2');
    expect(errors[0]).toContain('"c2"@block1');
    // The marker id sequence itself never changed — only the block it sits in.
    expect(errors[0]).not.toContain('[marker-order]');
  });

  it('passes a rendition that keeps every marker inside the translation of its own block', () => {
    const translated = twoParagraphSource
      .replace('Plain lead-in prose with', 'Einleitender Text mit')
      .replace('the default retry count is 3', 'die Standardanzahl der Wiederholungen ist 3')
      .replace('A second paragraph that says something else entirely.', 'Ein zweiter Absatz mit ganz anderem Inhalt.');
    expect(translationHygieneErrors(translated, placements, headings)).toEqual([]);
  });
});

describe('translationHygieneErrors — malformed translations are nonblocking, never thrown', () => {
  it('converts unparsable translated MDX into a hygiene failure instead of throwing', () => {
    // A translator that emits a stray unclosed JSX tag: remark throws while parsing. Translation
    // failures are nonblocking (i18n-lifecycle-v2 decision 5) — the source page is untouched.
    const malformed = sourceMdx.replace('## Usage', '## Usage\n\n<Broken attr="');
    let errors: string[] = [];
    expect(() => {
      errors = translationHygieneErrors(malformed, sourceMarkerIds, sourceHeadings);
    }).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(/\[malformed-mdx\]|\[mdx-parse-error\]/u);
  });
});

describe('headingInventory', () => {
  it('lists every heading depth in document order, ignoring code fences', () => {
    const mdx = '# Title\n\n```md\n# not a heading\n```\n\n## A\n\n### B\n\n## C\n';
    expect(headingInventory(mdx)).toEqual([1, 2, 3, 2]);
  });
});
