// The ONE shared normalization + binding vocabulary for asserted values (wave 2b-iii, finding 1).
// Both sides of the trust spine use exactly these helpers:
//   - the submit_page validator (agent-runtime) binds a claim's citedValue to the visible marked
//     prose IN-SESSION, so a writer that launders the correct value through the ledger while the
//     prose asserts something else gets a precise repair error while the model is still there;
//   - claim verification (core) re-checks the same binding (defense in depth) and normalizes the
//     citedValue before comparing it against the language pack's extraction.
// One helper kills the asymmetric-normalization class of bugs: an unquoted semantic string
// ("linear") and its JSON-quoted extraction ('"linear"') normalize identically, so they can never
// falsely contradict each other again.
//
// The canonical scalar grammar matches the cited-value extraction rules (lang-typescript
// cited-values.ts): strings render as JSON (double-quoted, escaped), numbers through Number()
// (1_000, 1e3, and 1000 normalize identically), booleans as true/false, null as null.

import { negationCueBefore } from './negation-cue.ts';

export type CitedValueKind = 'string' | 'number' | 'boolean' | 'null';

export type NormalizedCitedValue = {
  kind: CitedValueKind;
  // The canonical scalar text — byte-comparable against extracted cited values.
  canonical: string;
  // For strings: the unquoted inner text (used for bare-occurrence binding).
  bare?: string;
};

const NUMERIC_LITERAL = /^[+-]?(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?$/;

const quoted = (raw: string, quote: string): boolean => raw.length >= 2 && raw.startsWith(quote) && raw.endsWith(quote);

// Normalize a writer-authored asserted value into the canonical scalar form. Writers may emit the
// value already normalized ("3", '"linear"', "true"), single/backtick-quoted, or as a bare
// semantic string ("linear") — every spelling lands on one canonical form.
export const normalizeCitedValue = (raw: string): NormalizedCitedValue => {
  const trimmed = raw.trim();
  if (trimmed === 'true' || trimmed === 'false') {
    return { kind: 'boolean', canonical: trimmed };
  }
  if (trimmed === 'null') {
    return { kind: 'null', canonical: 'null' };
  }
  if (NUMERIC_LITERAL.test(trimmed)) {
    const numeric = Number(trimmed.replaceAll('_', ''));
    if (Number.isFinite(numeric)) {
      return { kind: 'number', canonical: String(numeric) };
    }
  }
  if (trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'string') {
        return { kind: 'string', canonical: JSON.stringify(parsed), bare: parsed };
      }
    } catch {
      // Not valid JSON: falls through to the bare-string rule below.
    }
  }
  if (quoted(trimmed, "'") || quoted(trimmed, '`')) {
    const inner = trimmed.slice(1, -1);
    return { kind: 'string', canonical: JSON.stringify(inner), bare: inner };
  }
  // Bare semantic string ("linear", "exponential-backoff"): canonical form is its JSON quoting —
  // identical to what cited-value extraction produces for the same source string.
  return { kind: 'string', canonical: JSON.stringify(trimmed), bare: trimmed };
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const QUOTE_CHARS = new Set(['"', "'", '`']);

// TYPE-AWARE occurrence discipline (impl-08 finding 1): a token wrapped in matching quotes is the
// prose form of a STRING, never of a number/boolean/null — so numeric 3 must not bind the quoted
// string "3" ('"3" (a string)' is Sol's probe), and vice versa a string whose content merely looks
// like a scalar of another type ("3", "true", "null") binds ONLY through a quoted occurrence.
const isQuoteWrapped = (text: string, start: number, end: number): boolean => {
  const before = start > 0 ? text[start - 1] : undefined;
  const after = end < text.length ? text[end] : undefined;
  return before !== undefined && QUOTE_CHARS.has(before) && after === before;
};

// True when a string's bare content is lexically a scalar of ANOTHER type — such a string can
// never bind through a bare token (the bare token IS the other type's prose form).
const bareLooksLikeOtherScalar = (bare: string): boolean =>
  bare === 'true' || bare === 'false' || bare === 'null' || NUMERIC_LITERAL.test(bare);

// Real LEXICAL number tokenization (impl-07 finding 1): a numeric literal token must stand on its
// own word boundary —
//   - never inside an identifier: "retry3", "v3", "sha256" contribute NO tokens;
//   - never a fragment of a larger literal: ".5" is the single token 0.5 (its "5" is not a
//     token), "13" is 13 (not 1 and 3), "1.2.3" is a version string and yields NO token;
//   - trailing sentence punctuation is fine ("defaults to 3." tokenizes 3), but a literal glued
//     to trailing identifier characters ("3px") is unit/identifier text, not a bindable number.
const NUMERIC_TOKEN =
  /(?<![A-Za-z0-9_.])[+-]?(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?(?![A-Za-z0-9_]|\.\d)/gu;

// Every lexically valid numeric token in the text, as canonicalized numbers. Quote-wrapped tokens
// are excluded: "3" in prose is the string form, not a numeric candidate (impl-08 finding 1).
export const lexNumericTokens = (text: string): number[] =>
  [...text.matchAll(NUMERIC_TOKEN)]
    .filter((match) => !isQuoteWrapped(text, match.index, match.index + match[0].length))
    .map((match) => Number(match[0].replaceAll('_', '')))
    .filter((value) => Number.isFinite(value));

// Explicit negation shortly before an occurrence of the value ("not 3", "no longer defaults to
// 3", "rather than 3"): the sentence names the value only to DENY it — binding must fail.
// Deliberately CONSERVATIVE: a negation cue anywhere in the short window rejects, and the writer
// gets a repair error demanding one plainly asserted value. The cue vocabulary is shared with
// subject binding (negation-cue.ts) so polarity cannot be laundered through a looser sibling rule.
const negatedAt = (text: string, index: number): boolean => negationCueBefore(text, index);

// Match positions of the value's TYPE-MATCHING occurrences in the text (empty when it never
// occurs in the asserted type's prose form). Binding is type-aware (impl-08 finding 1):
//   number       an UNQUOTED lexical numeric token — the quoted string "3" never binds numeric 3;
//   boolean/null an UNQUOTED word occurrence — the quoted string "true" never binds boolean true;
//   string       a QUOTED occurrence always binds; a bare delimited occurrence binds ONLY when the
//                content is a semantic string ("linear") — a string whose content lexes as a
//                number/boolean/null ("3", "true") must appear quoted, or it would be
//                indistinguishable from the other type's prose form.
const occurrenceIndexes = (value: NormalizedCitedValue, text: string): number[] => {
  if (value.kind === 'number') {
    const target = Number(value.canonical);
    return [...text.matchAll(NUMERIC_TOKEN)]
      .filter(
        (match) =>
          Number(match[0].replaceAll('_', '')) === target &&
          !isQuoteWrapped(text, match.index, match.index + match[0].length)
      )
      .map((match) => match.index);
  }
  if (value.kind === 'boolean' || value.kind === 'null') {
    const pattern = new RegExp(`(?:^|[^A-Za-z0-9_])(${value.canonical})(?:[^A-Za-z0-9_]|$)`, 'giu');
    return [...text.matchAll(pattern)]
      .map((match) => match.index + match[0].indexOf(match[1] ?? ''))
      .filter((index) => !isQuoteWrapped(text, index, index + value.canonical.length));
  }
  const bare = value.bare ?? (JSON.parse(value.canonical) as string);
  if (bare === '') {
    return [];
  }
  const escaped = escapeRegExp(bare);
  const quotedPattern = new RegExp(`["'\`]${escaped}["'\`]`, 'gu');
  const quotedIndexes = [...text.matchAll(quotedPattern)].map((match) => match.index + 1);
  if (bareLooksLikeOtherScalar(bare)) {
    return quotedIndexes;
  }
  const barePattern = new RegExp(`(?:^|[^A-Za-z0-9_])(${escaped})(?:[^A-Za-z0-9_]|$)`, 'gu');
  return [
    ...quotedIndexes,
    ...[...text.matchAll(barePattern)].map((match) => match.index + match[0].indexOf(match[1] ?? ''))
  ];
};

// Deterministic value→text occurrence (finding 1): does the normalized scalar provably appear in
// the given text?
//   numbers      a LEXICAL numeric token equal to the value after Number() canonicalization
//                ("3", "3.0", "1_000", "1e3" bind 3/1000 as appropriate; "retry3" and ".5" never
//                bind 3 and 5);
//   booleans     word occurrence of true/false (case-insensitive — prose says "True" freely);
//   null         word occurrence of null;
//   strings      a quoted occurrence ("x", 'x', `x`) or a bare occurrence delimited by
//                non-identifier characters (so "linear" binds inside "backoff is linear." and
//                inside "`linear`", but never inside "nonlinear").
export const citedValueOccursInText = (value: NormalizedCitedValue, text: string): boolean =>
  occurrenceIndexes(value, text).length > 0;

export type CitedValueBindingIssueCode =
  | 'missing-in-marker'
  | 'missing-in-predicate'
  | 'ambiguous-marker'
  | 'negated-in-marker'
  | 'negated-in-predicate';

export type CitedValueBindingIssue = { code: CitedValueBindingIssueCode; message: string };

export type CitedValueBindingResult = { ok: boolean; issues: CitedValueBindingIssue[] };

// THE binding rule (impl-07 finding 1), shared verbatim by submit_page (in-session) and claim
// verification: the asserted value must be provably present in BOTH the VISIBLE marker text (the
// rendered prose the reader sees — link URLs and attributes excluded, derived from the marker
// AST) AND the claim's atomic predicate. Presence alone is not enough:
//   - a marker whose visible text contains MULTIPLE distinct numeric candidates cannot bind a
//     number unambiguously ("5, not 3", "3 retries within 15 seconds") — repair error demanding
//     one unambiguous value;
//   - explicit negation right before the value ("not 3", "no longer 3") denies it — binding fails
//     on whichever side carries the negation.
// Either-side occurrence (the old rule) let wrong prose ride a correct predicate into 'checked'.
export const bindCitedValue = (
  raw: string,
  texts: { markerText: string; predicate: string }
): CitedValueBindingResult => {
  const value = normalizeCitedValue(raw);
  const issues: CitedValueBindingIssue[] = [];
  const markerOccurrences = occurrenceIndexes(value, texts.markerText);
  if (markerOccurrences.length === 0) {
    issues.push({
      code: 'missing-in-marker',
      message: `the asserted ${value.kind} ${value.canonical} does not appear in the visible marked prose as a ${value.kind} — the sentence the reader sees must state the exact value the ledger asserts, in the asserted TYPE's form (numbers/booleans/null unquoted; strings quoted when their content looks like another scalar)`
    });
  } else {
    if (value.kind === 'number') {
      const distinct = new Set(lexNumericTokens(texts.markerText));
      if (distinct.size > 1) {
        issues.push({
          code: 'ambiguous-marker',
          message: `the visible marked prose contains ${distinct.size} distinct numeric values (${[...distinct].join(', ')}) — a value claim must wrap prose stating ONE unambiguous value; split the sentence or narrow the marker`
        });
      }
    }
    if (markerOccurrences.some((index) => negatedAt(texts.markerText, index))) {
      issues.push({
        code: 'negated-in-marker',
        message: `the visible marked prose NEGATES the asserted value ${value.canonical} ("not ${value.canonical}"-style) — the prose denies the very value the ledger asserts; fix one of them`
      });
    }
  }
  const predicateOccurrences = occurrenceIndexes(value, texts.predicate);
  if (predicateOccurrences.length === 0) {
    issues.push({
      code: 'missing-in-predicate',
      message: `the asserted ${value.kind} ${value.canonical} does not appear in the claim predicate as a ${value.kind} — the atomic predicate must restate the exact asserted value in its asserted type's form`
    });
  } else if (predicateOccurrences.some((index) => negatedAt(texts.predicate, index))) {
    issues.push({
      code: 'negated-in-predicate',
      message: `the claim predicate NEGATES the asserted value ${value.canonical} — the predicate must assert the value, not deny it`
    });
  }
  return { ok: issues.length === 0, issues };
};
