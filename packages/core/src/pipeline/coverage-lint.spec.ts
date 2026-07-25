import { describe, expect, it } from 'vitest';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { coverageLintRules, lintUncoveredAssertions } from './coverage-lint.ts';

// THE COVERAGE LINTER (harness-state-v2 decision 5; PRODUCT §1.2 "no hidden denominator"): the
// ledger bounds only what the writer MARKED, so without this pass a writer who simply omits
// markers around factual prose ships a page whose badge reads complete. These tests pin both
// directions: the narrow shape that must be caught, and the much larger space that must not be —
// a false positive permanently withholds the complete badge from a correct page.

const lint = (body: string) => {
  const mdx = `# Page\n\n${body}\n`;
  return lintUncoveredAssertions({ mdx, page: extractPageEntity({ mdx, slug: 'page' }) });
};

describe('lintUncoveredAssertions', () => {
  it('flags an unmarked identifier + numeric assertion', () => {
    const spans = lint('The `retryLimit` defaults to 5.');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.excerpt).toBe('The `retryLimit` defaults to 5.');
    expect(spans[0]?.detector).toBe(coverageLintRules.numericLiteral);
    expect(spans[0]?.blockId).toMatch(/^bl_/u);
  });

  it('flags an unmarked identifier + assertion verb with no number', () => {
    const spans = lint('The `greet` helper is exported from the package root.');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.detector).toBe(coverageLintRules.assertionVerb);
  });

  it('flags a DOTTED identifier path written as plain prose, not just backticked code', () => {
    const spans = lint('The client requires config.retries before it can start.');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.detector).toBe(coverageLintRules.assertionVerb);
  });

  it('does NOT flag the same sentence once a <Claim> marker covers it', () => {
    expect(lint('<Claim id="c1">`retryLimit` defaults to 5.</Claim>')).toEqual([]);
    // Marker plus surrounding context: the covered clause contributes nothing, and the residue
    // ("The default is documented below.") asserts nothing on its own.
    expect(lint('<Claim id="c1">`retryLimit` defaults to 5.</Claim> The default is documented below.')).toEqual([]);
  });

  it('still flags the UNCOVERED half of a sentence that marks only one of two facts', () => {
    const spans = lint('The `timeout` is set to 30 and <Claim id="c1">`greet` exists.</Claim>');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.excerpt).toContain('`timeout` is set to 30');
  });

  it('flags an assertion sentence whose identifier is named EARLIER IN THE BLOCK (impl-24)', () => {
    // The identifier signal is BLOCK-scoped, not sentence-scoped: "It always returns 2." asserts a
    // fact about `retry` even though the sentence names nothing. Sentence scope let every such
    // continuation escape the denominator.
    const spans = lint('The `retry` helper wraps the call. It always returns 2.');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.excerpt).toBe('It always returns 2.');
    expect(spans[0]?.detector).toBe(coverageLintRules.numericLiteral);
  });

  it('does not flag narrative prose with no identifier and no assertion signal', () => {
    expect(lint('This guide walks through the setup, step by step, at your own pace.')).toEqual([]);
    // An assertion verb with no identifier ANYWHERE IN THE BLOCK is ordinary English, not a code
    // fact — the block-scoped signal must not turn narration into spans.
    expect(lint('You must read the introduction first.')).toEqual([]);
    expect(
      lint('You must read the introduction first. It always helps. The tour never takes more than 10 minutes.')
    ).toEqual([]);
    // An identifier with no assertion signal is a mention, not a claim.
    expect(lint('See the `greet` helper for a worked example.')).toEqual([]);
  });

  it('never flags code fences', () => {
    expect(lint(['```ts', 'export const retryLimit = 5; // retryLimit defaults to 5', '```'].join('\n'))).toEqual([]);
  });

  it('flags an assertion-shaped HEADING, attributed to the first block of its section (impl-24)', () => {
    // A heading is prose the reader reads; an assertion parked in one used to be invisible to the
    // denominator. It is not a block, so the span is attributed to the block it introduces.
    const mdx = '# Page\n\n## `retryLimit` defaults to 5\n\nSee below.\n';
    const page = extractPageEntity({ mdx, slug: 'page' });
    const spans = lintUncoveredAssertions({ mdx, page });
    expect(spans).toHaveLength(1);
    expect(spans[0]?.excerpt).toBe('`retryLimit` defaults to 5');
    expect(spans[0]?.blockId).toBe(page.sections[0]?.blocks[0]?.id);
  });

  it('does not flag an ordinary heading', () => {
    const mdx = '# Page\n\n## Configuration\n\nSee below.\n';
    expect(lintUncoveredAssertions({ mdx, page: extractPageEntity({ mdx, slug: 'page' }) })).toEqual([]);
  });

  it('never flags a bare inline-code span that is the whole cell — an index entry asserts nothing', () => {
    expect(lint(['| name | default |', '| --- | --- |', '| `retryLimit` | `5` |'].join('\n'))).toEqual([]);
    // A bare DOTTED PATH cell is equally an index entry: stripping inline code alone left
    // "config.retries" satisfying the real-prose gate by itself (impl-24).
    expect(lint(['| name | default |', '| --- | --- |', '| config.retries | 5 |'].join('\n'))).toEqual([]);
  });

  it('never flags prose inside a JSX/HTML element — page-authored markup is outside attribution', () => {
    // MDX parses raw HTML as JSX, so the "raw HTML is excluded" intent leaked (impl-24). Every
    // element subtree is skipped uniformly: the kernel cannot anchor a ledger claim inside an
    // arbitrary component's children, and an unfixable span is worse than an unreported one.
    expect(lint('<div>The `retryLimit` defaults to 5.</div>')).toEqual([]);
    expect(lint('<Callout tone="info">The `retryLimit` defaults to 5.</Callout>')).toEqual([]);
  });

  it('caps the reported spans per page', () => {
    const sentence = 'The `retryLimit` defaults to 5.';
    const spans = lint(Array.from({ length: 40 }, () => sentence).join(' '));
    expect(spans).toHaveLength(20);
  });

  it('reports the OWNING block id for each span', () => {
    const mdx = '# Page\n\nIntro prose.\n\n## Config\n\nThe `retryLimit` defaults to 5.\n';
    const page = extractPageEntity({ mdx, slug: 'page' });
    const spans = lintUncoveredAssertions({ mdx, page });
    expect(spans).toHaveLength(1);
    expect(spans[0]?.blockId).toBe(page.sections[0]?.blocks[0]?.id);
  });
});
