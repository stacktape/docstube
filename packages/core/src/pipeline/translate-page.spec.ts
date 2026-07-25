import { describe, expect, it } from 'vitest';
import { headingInventory, translationHygieneErrors } from './translate-page.ts';

// Ordered marker equality + heading inventory (wave 2b close, impl-21): set equality alone lets a
// translator swap two marker ids between sentences — the canonical marks would then annotate the
// wrong prose. The hygiene check compares the marker id SEQUENCE and the heading skeleton.

const sourceMdx = `---
title: Getting started
---

# Getting started

<Claim id="c1">The library exposes a single \`greet\` function.</Claim>

## Usage

<Claim id="c2">The default retry count is 3.</Claim>
`;

const sourceMarkerIds = ['c1', 'c2'];
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

describe('headingInventory', () => {
  it('lists every heading depth in document order, ignoring code fences', () => {
    const mdx = '# Title\n\n```md\n# not a heading\n```\n\n## A\n\n### B\n\n## C\n';
    expect(headingInventory(mdx)).toEqual([1, 2, 3, 2]);
  });
});
