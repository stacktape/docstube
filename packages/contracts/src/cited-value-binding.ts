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

// Real LEXICAL number tokenization (impl-07 finding 1): a numeric literal token must stand on its
// own word boundary —
//   - never inside an identifier: "retry3", "v3", "sha256" contribute NO tokens;
//   - never a fragment of a larger literal: ".5" is the single token 0.5 (its "5" is not a
//     token), "13" is 13 (not 1 and 3), "1.2.3" is a version string and yields NO token;
//   - trailing sentence punctuation is fine ("defaults to 3." tokenizes 3), but a literal glued
//     to trailing identifier characters ("3px") is unit/identifier text, not a bindable number.
const NUMERIC_TOKEN =
  /(?<![A-Za-z0-9_.])[+-]?(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?(?![A-Za-z0-9_]|\.\d)/gu;

// Every lexically valid numeric token in the text, as canonicalized numbers.
export const lexNumericTokens = (text: string): number[] =>
  [...text.matchAll(NUMERIC_TOKEN)]
    .map((match) => Number(match[0].replaceAll('_', '')))
    .filter((value) => Number.isFinite(value));

// Explicit negation shortly before an occurrence of the value ("not 3", "no longer defaults to
// 3", "rather than 3"): the sentence names the value only to DENY it — binding must fail.
// Deliberately CONSERVATIVE: a negation cue anywhere in the short window rejects, and the writer
// gets a repair error demanding one plainly asserted value.
const NEGATION_CUE = /\b(?:not|never|cannot|no longer|rather than|instead of)\b|n't\b/iu;

const WINDOW = 32;

const negatedAt = (text: string, index: number): boolean =>
  NEGATION_CUE.test(text.slice(Math.max(0, index - WINDOW), index));

// Match positions of the value's occurrences in the text (empty when it never occurs).
const occurrenceIndexes = (value: NormalizedCitedValue, text: string): number[] => {
  if (value.kind === 'number') {
    const target = Number(value.canonical);
    return [...text.matchAll(NUMERIC_TOKEN)]
      .filter((match) => Number(match[0].replaceAll('_', '')) === target)
      .map((match) => match.index);
  }
  if (value.kind === 'boolean' || value.kind === 'null') {
    const pattern = new RegExp(`(?:^|[^A-Za-z0-9_])(${value.canonical})(?:[^A-Za-z0-9_]|$)`, 'giu');
    return [...text.matchAll(pattern)].map((match) => match.index + match[0].indexOf(match[1] ?? ''));
  }
  const bare = value.bare ?? (JSON.parse(value.canonical) as string);
  if (bare === '') {
    return [];
  }
  const escaped = escapeRegExp(bare);
  const quotedPattern = new RegExp(`["'\`]${escaped}["'\`]`, 'gu');
  const barePattern = new RegExp(`(?:^|[^A-Za-z0-9_])(${escaped})(?:[^A-Za-z0-9_]|$)`, 'gu');
  return [
    ...[...text.matchAll(quotedPattern)].map((match) => match.index + 1),
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
      message: `the asserted value ${value.canonical} does not appear in the visible marked prose — the sentence the reader sees must state the exact value the ledger asserts`
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
      message: `the asserted value ${value.canonical} does not appear in the claim predicate — the atomic predicate must restate the exact asserted value`
    });
  } else if (predicateOccurrences.some((index) => negatedAt(texts.predicate, index))) {
    issues.push({
      code: 'negated-in-predicate',
      message: `the claim predicate NEGATES the asserted value ${value.canonical} — the predicate must assert the value, not deny it`
    });
  }
  return { ok: issues.length === 0, issues };
};
