import type { Root, RootContent } from 'mdast';
import type { BlockEntity, CoverageLintSpan, PageEntity } from '@docstube/contracts';
import { parseMdx } from '../entities/extract-entities.ts';

// THE COVERAGE LINTER (harness-state-v2 decision 5; PRODUCT §1.2 "no hidden denominator"): the
// claim ledger only bounds what the writer CHOSE to mark. Without this pass, a page whose factual
// prose carries no <Claim> markers at all reports "0 of 0 claims checked" — or worse, "3 of 3" —
// and reads as complete. The linter deterministically flags assertion-shaped prose that no marker
// covers, so ledger omission can never manufacture a complete badge.
//
// IT IS A FLOOR, NOT A SOUNDNESS PROOF (PRODUCT §1.2, harness-state-v2 decision 5). No
// deterministic detector can identify every factual assertion in prose; this one catches the
// common shape and nothing more. The semantic job — prose that asserts a fact without tripping any
// of these signals ("the client gives up after a while") — belongs to the evidence-fed RISK CRITIC
// of harness-state-v2 decision 4, which ships with the review-routing wave. The complete/green
// state therefore means "every claim in this page's ledger is checked and no unmarked assertion
// was detected", NOT "this page contains no unverified statement".
//
// THE RULE (single statement): a SENTENCE carrying an ASSERTION SIGNAL — a bare numeric literal or
// one of the documented verbs/modals — is flagged when (a) it is real prose, meaning at least one
// ordinary word survives after every inline-code span and dotted identifier path is removed, and
// (b) its OWNING BLOCK contains an IDENTIFIER SIGNAL anywhere — an inline-code identifier or a
// dotted identifier path, in that sentence or any other sentence of the same block. Headings are
// scanned as their own scope (a heading is prose the reader reads) and attributed to the first
// block of the section they open. A sentence with no assertion signal is never flagged, and a
// block with no identifier anywhere stays clean however assertive its narration.
//
// BLOCK, NOT SENTENCE, IS THE IDENTIFIER SCOPE (impl-24 finding): "The `retry` helper wraps the
// call. It always returns 2." asserts a fact about `retry`, but the assertion sentence names no
// identifier of its own. Requiring both signals in the SAME sentence let every such continuation
// escape. The block is the unit the ledger anchors to anyway, so it is the honest scope.

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
const dottedIdentifierPatternGlobal = new RegExp(dottedIdentifierPattern.source, 'gu');

// Inline code that reads as an identifier or an identifier path, as opposed to a command line or
// a snippet. `retryLimit`, `config.retries`, `Client#send` all qualify; `npm i -g docstube` does
// not.
const codeIdentifierPattern = /^[A-Za-z_$][\w$]*(?:[.#][A-Za-z_$][\w$]*)*(?:\(\))?$/u;

// At least one ordinary prose word outside the code spans AND outside the identifier paths. A
// "sentence" that is nothing but identifiers (a bare `retryLimit` in a table cell, a
// `config.retries` API index entry) asserts nothing — before this stripped dotted paths too, a
// bare dotted path satisfied the prose gate all by itself.
const proseWordPattern = /[A-Za-z]{2,}/u;

const withoutInlineCode = (text: string): string => text.replaceAll(/`[^`]*`/gu, ' ');

// The prose residue every signal test runs against: no inline code, no identifier paths. Numbers
// and verbs found here belong to the sentence's ENGLISH, not to a symbol name.
const proseResidue = (text: string): string => withoutInlineCode(text).replaceAll(dottedIdentifierPatternGlobal, ' ');

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

// The VISIBLE prose of a block, OUTSIDE every JSX/HTML element. Claim subtrees contribute nothing —
// their prose is, by definition, covered. Code fences and frontmatter never reach here; inline
// code is kept but tagged, because it is the identifier signal the detector needs.
const collectSegments = (node: ScanNode, into: Segment[]): void => {
  if (node.type === 'code' || node.type === 'yaml' || node.type === 'mdxjsEsm') {
    return;
  }
  // PAGE-AUTHORED MARKUP IS OUTSIDE THE ATTRIBUTION MODEL (impl-24 finding): raw HTML was always
  // meant to be excluded, but MDX parses `<div>…</div>` as a JSX element, so half the exclusion
  // leaked. Every JSX/HTML element subtree is skipped uniformly — `<Claim>` (covered by
  // definition), theme components, and hand-written markup alike. The kernel cannot attribute
  // prose inside an arbitrary component's children to a block the ledger could anchor a claim to,
  // and a span the writer could not fix is worse than a span not reported. This is a documented
  // limit of the deterministic floor, not a soundness claim.
  if (node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement' || node.type === 'html') {
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
  // Expressions render text the kernel cannot see; they contribute nothing rather than fabricating
  // prose.
  if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression') {
    return;
  }
  if (node.type === 'break') {
    into.push({ kind: 'text', value: ' ' });
    return;
  }
  // Table cells, list items, paragraphs, and headings sit in separate subtrees; a sentence never
  // runs across two of them, so each container ends the sentence in progress.
  const isContainer =
    node.type === 'tableCell' || node.type === 'listItem' || node.type === 'paragraph' || node.type === 'heading';
  for (const child of (node.children ?? []) as ScanNode[]) {
    collectSegments(child, into);
  }
  if (isContainer) {
    into.push({ kind: 'boundary', value: '' });
  }
};

type Sentence = { text: string; hasIdentifier: boolean };

// Sentence splitting over the segment stream: inline code is re-rendered with backticks so the
// excerpt reads like the source prose, and a per-sentence flag records whether the sentence
// carried an identifier signal (backticked identifier or plain-prose dotted path).
const splitSentences = (segments: readonly Segment[]): Sentence[] => {
  const sentences: Sentence[] = [];
  let text = '';
  let hasCodeIdentifier = false;
  const flush = (): void => {
    const trimmed = text.trim();
    if (trimmed !== '') {
      sentences.push({
        text: trimmed,
        hasIdentifier: hasCodeIdentifier || dottedIdentifierPattern.test(withoutInlineCode(trimmed))
      });
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

// The per-sentence half of the rule; `blockHasIdentifier` carries the block-scoped half.
const detectorFor = (sentence: Sentence, blockHasIdentifier: boolean): string | undefined => {
  if (!blockHasIdentifier) {
    return undefined;
  }
  const prose = proseResidue(sentence.text);
  // The sentence must still be PROSE — an index entry that is only identifiers asserts nothing.
  if (!proseWordPattern.test(prose)) {
    return undefined;
  }
  if (numericLiteralPattern.test(prose)) {
    return coverageLintRules.numericLiteral;
  }
  if (assertionSignalPattern.test(prose)) {
    return coverageLintRules.assertionVerb;
  }
  return undefined;
};

const flattenBlocks = (page: PageEntity): BlockEntity[] => [
  ...page.preamble,
  ...page.sections.flatMap((section) => section.blocks)
];

type ScanUnit = { node: RootContent; blockId: string };

// Content nodes paired with the block id each span is reported against. Non-heading nodes are the
// blocks themselves, in EXTRACTION order — the same set blockSourceRanges walks, so index i is the
// i-th block of the flattened page entity and the reported blockId is exact. A HEADING is not a
// block, but it is prose the reader reads, so it is scanned and attributed to the FIRST block of
// the section it opens (the nearest following block); a trailing heading falls back to the block
// before it. A page with no blocks at all has nothing to attribute and reports nothing.
const scanUnits = (tree: Root, blocks: readonly BlockEntity[]): ScanUnit[] => {
  const nodes = tree.children.filter((node) => node.type !== 'yaml' && node.type !== 'mdxjsEsm');
  const blockIds: Array<string | undefined> = [];
  let blockIndex = 0;
  for (const node of nodes) {
    if (node.type === 'heading') {
      blockIds.push(undefined);
      continue;
    }
    blockIds.push(blocks[blockIndex]?.id);
    blockIndex += 1;
  }
  for (let index = nodes.length - 2; index >= 0; index -= 1) {
    blockIds[index] ??= blockIds[index + 1];
  }
  for (let index = 1; index < nodes.length; index += 1) {
    blockIds[index] ??= blockIds[index - 1];
  }
  const units: ScanUnit[] = [];
  for (const [index, node] of nodes.entries()) {
    const blockId = blockIds[index];
    if (blockId !== undefined) {
      units.push({ node, blockId });
    }
  }
  return units;
};

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
  const spans: CoverageLintSpan[] = [];
  for (const { node, blockId } of scanUnits(tree, flattenBlocks(page))) {
    // A code-example block is literal source, never asserted prose.
    if (node.type === 'code') {
      continue;
    }
    const segments: Segment[] = [];
    collectSegments(node as ScanNode, segments);
    const sentences = splitSentences(segments);
    // BLOCK SCOPE: one identifier anywhere in the block arms every assertion-shaped sentence in it.
    const blockHasIdentifier = sentences.some((sentence) => sentence.hasIdentifier);
    for (const sentence of sentences) {
      const detector = detectorFor(sentence, blockHasIdentifier);
      if (detector === undefined) {
        continue;
      }
      spans.push({ blockId, excerpt: truncate(sentence.text), detector });
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
