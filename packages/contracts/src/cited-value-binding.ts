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

const quoted = (raw: string, quote: string): boolean =>
  raw.length >= 2 && raw.startsWith(quote) && raw.endsWith(quote);

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

const NUMERIC_TOKEN = /[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/g;

// Deterministic value→prose binding (finding 1): does the normalized scalar provably appear in
// the given text?
//   numbers      any numeric literal in the text that equals the value after Number()
//                canonicalization ("3", "3.0", "1_000", "1e3" all bind 1000/3 as appropriate);
//   booleans     word occurrence of true/false (case-insensitive — prose says "True" freely);
//   null         word occurrence of null;
//   strings      a quoted occurrence ("x", 'x', `x`) or a bare occurrence delimited by
//                non-identifier characters (so "linear" binds inside "backoff is linear." and
//                inside "`linear`", but never inside "nonlinear").
export const citedValueOccursInText = (value: NormalizedCitedValue, text: string): boolean => {
  if (value.kind === 'number') {
    const target = Number(value.canonical);
    for (const token of text.match(NUMERIC_TOKEN) ?? []) {
      if (Number(token.replaceAll('_', '')) === target) {
        return true;
      }
    }
    return false;
  }
  if (value.kind === 'boolean' || value.kind === 'null') {
    return new RegExp(`(?:^|[^A-Za-z0-9_])${value.canonical}(?:[^A-Za-z0-9_]|$)`, 'iu').test(text);
  }
  const bare = value.bare ?? JSON.parse(value.canonical) as string;
  if (bare === '') {
    return false;
  }
  if (
    text.includes(`"${bare}"`) ||
    text.includes(`'${bare}'`) ||
    text.includes(`\`${bare}\``)
  ) {
    return true;
  }
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(bare)}(?:[^A-Za-z0-9_]|$)`, 'u').test(text);
};

// The full binding rule: the asserted value must be provably present in the VISIBLE marked prose
// or in the claim's own predicate (the atomic restatement of the same fact). Texts are checked in
// order; any occurrence binds.
export const citedValueBindsToTexts = (raw: string, texts: readonly string[]): boolean => {
  const normalized = normalizeCitedValue(raw);
  return texts.some((text) => citedValueOccursInText(normalized, text));
};
