import type { Root, RootContent } from 'mdast';
import type { BlockEntity, CoverageLintSpan, PageEntity } from '@docstube/contracts';
import { parseMdx } from '../entities/extract-entities.ts';

// THE COVERAGE LINTER (harness-state-v2 decision 5; PRODUCT §1.2 "no hidden denominator"): the
// claim ledger only bounds what the writer CHOSE to mark. Without this pass, a page whose factual
// prose carries no <Claim> markers at all reports "0 of 0 claims checked" — or worse, "3 of 3" —
// and reads as complete. The linter deterministically flags assertion-shaped prose that no marker
// covers, so ledger omission can never manufacture a complete badge.
//
// DELIBERATE PRECISION/RECALL TRADEOFF FOR 0.1.0: this detector is HIGH PRECISION and LOW RECALL
// on purpose. A false positive permanently withholds the complete badge from a correct page and
// pushes the writer toward marker noise, so the rule fires only on the narrow shape where an
// unmarked factual assertion is nearly unambiguous: a sentence naming a CODE IDENTIFIER that also
// carries an ASSERTION SIGNAL. Plenty of real unmarked assertions slip through ("the client gives
// up after a while"); catching those needs semantics, which would be a model call, not a
// deterministic lint. Widening the rules is a later wave with eval evidence behind it.

// Rule names recorded on each span (the schema's `detector` field) — the reader-facing surfaces
// and the journal hint quote them, so they are part of the observable contract.
export const coverageLintRules = {
  numericLiteral: 'identifier-with-numeric-literal',
  assertionVerb: 'identifier-with-assertion-verb'
} as const;

// A page's worth of hints is a hint; a page's worth of noise is a wall. Nothing downstream needs
// more than a sample, and the badge only needs to know the count is non-zero.
const MAX_SPANS_PER_PAGE = 20;
const MAX_EXCERPT_LENGTH = 200;

// The documented assertion-verb/modal set. Word-boundary matched, case-insensitive; deliberately
// small — every entry states a fact about code that a verifier could in principle decide.
const ASSERTION_SIGNALS = [
  'defaults to',
  'is set to',
  'equals',
  'returns',
  'throws',
  'requires',
  'must',
  'always',
  'never',
  'is exported',
  'is defined',
  'is available'
] as const;

const assertionSignalPattern = new RegExp(`\\b(?:${ASSERTION_SIGNALS.join('|')})\\b`, 'iu');

// A bare numeric literal (a default, a limit, a port), decimals and dotted versions included. Not
// glued to identifier characters, so `v2` and `utf8` inside a word never count. A sentence-final
// period is not part of the number, so "defaults to 5." still matches.
const numericLiteralPattern = /(?<![\w.])\d+(?:\.\d+)*(?!\w)/u;

// A dotted identifier path in PLAIN prose (config.retryLimit, Client.send) — the writer named a
// code path without backticking it. Single bare words are deliberately NOT identifiers: ordinary
// English would light up on every sentence.
const dottedIdentifierPattern = /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/u;

// Inline code that reads as an identifier or an identifier path, as opposed to a command line or
// a snippet. `retryLimit`, `config.retries`, `Client#send` all qualify; `npm i -g docstube` does
// not.
const codeIdentifierPattern = /^[A-Za-z_$][\w$]*(?:[.#][A-Za-z_$][\w$]*)*(?:\(\))?$/u;

// At least one ordinary prose word outside the code spans. A "sentence" that is nothing but an
// inline-code token (a bare `retryLimit` in a table cell, an API index entry) asserts nothing.
const proseWordPattern = /[A-Za-z]{2,}/u;

// 'boundary' is a structural sentence break (the end of a paragraph, list item, or table cell) —
// never appended text, so a sentence that already ends in a period does not grow a second one.
type Segment = { kind: 'text' | 'code' | 'boundary'; value: string };

type ScanNode = {
  type?: string;
  name?: string | null;
  value?: unknown;
  alt?: unknown;
  children?: unknown[];
};

// The VISIBLE prose of a block, OUTSIDE every <Claim> marker. Claim subtrees contribute nothing —
// their prose is, by definition, covered. Code fences and frontmatter never reach here; inline
// code is kept but tagged, because it is the identifier signal the detector needs.
const collectSegments = (node: ScanNode, into: Segment[]): void => {
  if (node.type === 'code' || node.type === 'yaml' || node.type === 'mdxjsEsm') {
    return;
  }
  // Headings delimit sections and are never blocks; a nested heading cannot occur, but a defensive
  // skip keeps the rule "headings are never flagged" true by construction.
  if (node.type === 'heading') {
    return;
  }
  if (
    (node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement') &&
    typeof node.name === 'string' &&
    node.name === 'Claim'
  ) {
    return;
  }
  if (node.type === 'inlineCode') {
    into.push({ kind: 'code', value: typeof node.value === 'string' ? node.value : '' });
    return;
  }
  if (node.type === 'text') {
    into.push({ kind: 'text', value: typeof node.value === 'string' ? node.value : '' });
    return;
  }
  // Expressions and raw HTML render text the kernel cannot see; they contribute nothing rather
  // than fabricating prose.
  if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression' || node.type === 'html') {
    return;
  }
  if (node.type === 'break') {
    into.push({ kind: 'text', value: ' ' });
    return;
  }
  // Table cells, list items, and paragraphs sit in separate subtrees; a sentence never runs across
  // two of them, so each container ends the sentence in progress.
  const isContainer = node.type === 'tableCell' || node.type === 'listItem' || node.type === 'paragraph';
  for (const child of (node.children ?? []) as ScanNode[]) {
    collectSegments(child, into);
  }
  if (isContainer) {
    into.push({ kind: 'boundary', value: '' });
  }
};

type Sentence = { text: string; hasCodeIdentifier: boolean };

// Sentence splitting over the segment stream: inline code is re-rendered with backticks so the
// excerpt reads like the source prose, and a per-sentence flag records whether any inline-code
// segment in it looked like an identifier.
const splitSentences = (segments: readonly Segment[]): Sentence[] => {
  const sentences: Sentence[] = [];
  let text = '';
  let hasCodeIdentifier = false;
  const flush = (): void => {
    const trimmed = text.trim();
    if (trimmed !== '') {
      sentences.push({ text: trimmed, hasCodeIdentifier });
    }
    text = '';
    hasCodeIdentifier = false;
  };
  for (const segment of segments) {
    if (segment.kind === 'boundary') {
      flush();
      continue;
    }
    if (segment.kind === 'code') {
      text += `\`${segment.value}\``;
      hasCodeIdentifier = hasCodeIdentifier || codeIdentifierPattern.test(segment.value.trim());
      continue;
    }
    // Split on sentence-final punctuation followed by whitespace.
    const parts = segment.value.split(/(?<=[.!?])(?=\s)/u);
    for (const [index, part] of parts.entries()) {
      text += part;
      if (index < parts.length - 1) {
        flush();
      }
    }
  }
  flush();
  return sentences;
};

const truncate = (value: string): string =>
  value.length <= MAX_EXCERPT_LENGTH ? value : `${value.slice(0, MAX_EXCERPT_LENGTH - 1).trimEnd()}…`;

const detectorFor = (sentence: Sentence): string | undefined => {
  // Identifier signal: a backticked identifier, or a dotted identifier path written in plain prose.
  const identifier = sentence.hasCodeIdentifier || dottedIdentifierPattern.test(sentence.text);
  if (!identifier) {
    return undefined;
  }
  // The sentence must still be PROSE — an index entry that is only an identifier asserts nothing.
  const proseOnly = sentence.text.replaceAll(/`[^`]*`/gu, ' ');
  if (!proseWordPattern.test(proseOnly)) {
    return undefined;
  }
  if (numericLiteralPattern.test(proseOnly)) {
    return coverageLintRules.numericLiteral;
  }
  if (assertionSignalPattern.test(proseOnly)) {
    return coverageLintRules.assertionVerb;
  }
  return undefined;
};

const flattenBlocks = (page: PageEntity): BlockEntity[] => [
  ...page.preamble,
  ...page.sections.flatMap((section) => section.blocks)
];

// Block nodes in EXTRACTION order — the same set blockSourceRanges walks, so index i is the i-th
// block of the flattened page entity and the reported blockId is exact.
const blockNodes = (tree: Root): RootContent[] =>
  tree.children.filter((node) => node.type !== 'yaml' && node.type !== 'mdxjsEsm' && node.type !== 'heading');

export type CoverageLintInput = { mdx: string; page: PageEntity };

export const lintUncoveredAssertions = ({ mdx, page }: CoverageLintInput): CoverageLintSpan[] => {
  let tree: Root;
  try {
    tree = parseMdx(mdx);
  } catch {
    // The MDX already failed the marker scan upstream; a lint over unparsable prose reports
    // nothing rather than fabricating spans.
    return [];
  }
  const blocks = flattenBlocks(page);
  const nodes = blockNodes(tree);
  const spans: CoverageLintSpan[] = [];
  for (const [index, node] of nodes.entries()) {
    const block = blocks[index];
    if (block === undefined) {
      continue;
    }
    // A code-example block is literal source, never asserted prose.
    if (node.type === 'code') {
      continue;
    }
    const segments: Segment[] = [];
    collectSegments(node as ScanNode, segments);
    for (const sentence of splitSentences(segments)) {
      const detector = detectorFor(sentence);
      if (detector === undefined) {
        continue;
      }
      spans.push({ blockId: block.id, excerpt: truncate(sentence.text), detector });
      if (spans.length >= MAX_SPANS_PER_PAGE) {
        return spans;
      }
    }
  }
  return spans;
};

// The NON-BLOCKING journal hint (minimal-review tenet): unmarked assertions never fail a page or
// trigger a repair error — they are reported so the bounded retry loop can opportunistically
// improve coverage, and so the badge can never read complete while they exist.
export const coverageLintHint = (spans: readonly CoverageLintSpan[]): string[] => {
  if (spans.length === 0) {
    return [];
  }
  return [
    `${spans.length} assertion-shaped sentence${spans.length === 1 ? '' : 's'} on this page ${
      spans.length === 1 ? 'is' : 'are'
    } not covered by any <Claim> marker, so the page reports unmarked assertions and can never show a complete ` +
      `badge: ${spans.map((span) => `"${span.excerpt}" (${span.detector})`).join('; ')}. Non-blocking: wrap each ` +
      'fact in a marker with a matching ledger entry, or leave it as prose if it is not a checkable fact'
  ];
};
