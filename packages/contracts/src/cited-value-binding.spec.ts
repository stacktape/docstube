import { describe, expect, it } from 'vitest';
import {
  bindCitedValue,
  citedValueOccursInText,
  lexNumericTokens,
  normalizeCitedValue
} from './cited-value-binding.ts';

describe('normalizeCitedValue', () => {
  it('normalizes numeric spellings to one canonical form', () => {
    expect(normalizeCitedValue('3')).toEqual({ kind: 'number', canonical: '3' });
    expect(normalizeCitedValue('1_000').canonical).toBe('1000');
    expect(normalizeCitedValue('1e3').canonical).toBe('1000');
    expect(normalizeCitedValue('-2.50').canonical).toBe('-2.5');
  });

  it('normalizes every string spelling to the JSON-quoted canonical form (asymmetry fix)', () => {
    // The impl-06 false-contradiction case: an unquoted semantic string vs the JSON-quoted
    // extraction. All spellings must land on ONE canonical form.
    expect(normalizeCitedValue('linear').canonical).toBe('"linear"');
    expect(normalizeCitedValue('"linear"').canonical).toBe('"linear"');
    expect(normalizeCitedValue("'linear'").canonical).toBe('"linear"');
    expect(normalizeCitedValue('`linear`').canonical).toBe('"linear"');
  });

  it('keeps booleans and null literal', () => {
    expect(normalizeCitedValue('true')).toEqual({ kind: 'boolean', canonical: 'true' });
    expect(normalizeCitedValue('false').canonical).toBe('false');
    expect(normalizeCitedValue('null')).toEqual({ kind: 'null', canonical: 'null' });
  });

  it('treats numeric-looking strings in quotes as strings, not numbers', () => {
    expect(normalizeCitedValue('"3"')).toEqual({ kind: 'string', canonical: '"3"', bare: '3' });
  });
});

describe('citedValueOccursInText', () => {
  it('binds numbers through any equal LEXICAL numeric token in the text', () => {
    const three = normalizeCitedValue('3');
    expect(citedValueOccursInText(three, 'Retries default to 3.')).toBe(true);
    expect(citedValueOccursInText(three, 'Retries default to 3.0 attempts.')).toBe(true);
    expect(citedValueOccursInText(normalizeCitedValue('1000'), 'the cap is 1_000 ms')).toBe(true);
    expect(citedValueOccursInText(three, 'Retries default to 5.')).toBe(false);
    // "13" contains the digit 3 but is not the number 3 — token equality, not substring.
    expect(citedValueOccursInText(three, 'Retries default to 13.')).toBe(false);
  });

  it('lexes real numeric tokens: ".5" is 0.5, digits inside identifiers never tokenize (Sol probes)', () => {
    // The direct impl-07 probes: ".5" was read as 5; "3" was found inside "retry3" and "v3".
    expect(citedValueOccursInText(normalizeCitedValue('5'), 'the factor is .5 by default')).toBe(false);
    expect(citedValueOccursInText(normalizeCitedValue('0.5'), 'the factor is .5 by default')).toBe(true);
    expect(citedValueOccursInText(normalizeCitedValue('3'), 'call retry3 to retry')).toBe(false);
    expect(citedValueOccursInText(normalizeCitedValue('3'), 'since v3 of the API')).toBe(false);
    // Version strings and unit-glued digits are not numeric literals.
    expect(lexNumericTokens('upgrade from 1.2.3 today')).toEqual([]);
    expect(lexNumericTokens('a 3px border')).toEqual([]);
    expect(lexNumericTokens('retries default to 3, factor .5')).toEqual([3, 0.5]);
  });

  it('binds strings via quoted or bare delimited occurrence, never substrings', () => {
    const linear = normalizeCitedValue('linear');
    expect(citedValueOccursInText(linear, 'backoff is `linear` by default')).toBe(true);
    expect(citedValueOccursInText(linear, 'backoff is "linear" by default')).toBe(true);
    expect(citedValueOccursInText(linear, 'backoff is linear.')).toBe(true);
    expect(citedValueOccursInText(linear, 'backoff is nonlinear.')).toBe(false);
  });

  it('binds booleans and null as words', () => {
    expect(citedValueOccursInText(normalizeCitedValue('true'), '`loud` defaults to true.')).toBe(true);
    expect(citedValueOccursInText(normalizeCitedValue('true'), '`loud` defaults to True.')).toBe(true);
    expect(citedValueOccursInText(normalizeCitedValue('true'), '`loud` is truthy.')).toBe(false);
    expect(citedValueOccursInText(normalizeCitedValue('null'), 'returns null when missing')).toBe(true);
  });
});

describe('bindCitedValue (the ONE binding rule, shared by submit_page and verification)', () => {
  it('accepts a value stated in BOTH the visible marker text and the predicate', () => {
    expect(bindCitedValue('3', { markerText: 'Retries default to 3.', predicate: 'retries defaults to 3' })).toEqual({
      ok: true,
      issues: []
    });
    expect(
      bindCitedValue('linear', { markerText: 'backoff is `linear`.', predicate: 'backoff mode is linear' }).ok
    ).toBe(true);
  });

  it('REJECTS wrong prose riding a correct predicate (the impl-07 must-now-reject case)', () => {
    // The previously committed OR-rule accepted this pair; binding is bidirectional now.
    const result = bindCitedValue('3', {
      markerText: '`retries` is totally-wrong.',
      predicate: 'the retries option defaults to 3'
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(['missing-in-marker']);
  });

  it('rejects a correct marker riding a predicate that never states the value', () => {
    const result = bindCitedValue('3', { markerText: 'Retries default to 3.', predicate: 'retries have a default' });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(['missing-in-predicate']);
  });

  it('rejects the value-laundering case entirely: correct citedValue, wrong prose AND predicate', () => {
    const result = bindCitedValue('3', {
      markerText: '`retries` is totally-wrong.',
      predicate: 'retries is totally-wrong'
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code).toSorted()).toEqual(['missing-in-marker', 'missing-in-predicate']);
  });

  it('rejects multiple distinct numeric candidates in the visible prose (Sol conflict probe)', () => {
    const result = bindCitedValue('3', {
      markerText: 'Retries default to 3 within 15 seconds.',
      predicate: 'retries defaults to 3'
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(['ambiguous-marker']);
    expect(result.issues[0]?.message).toContain('ONE unambiguous value');
  });

  it('rejects explicit negation around the value ("5, not 3") on either side', () => {
    const marker = bindCitedValue('3', {
      markerText: 'Retries default to 5, not 3.',
      predicate: 'retries defaults to 3'
    });
    expect(marker.ok).toBe(false);
    // Two distinct candidates AND a negated occurrence: both defects are named.
    expect(marker.issues.map((issue) => issue.code).toSorted()).toEqual(['ambiguous-marker', 'negated-in-marker']);

    const predicate = bindCitedValue('3', {
      markerText: 'Retries default to 3.',
      predicate: 'retries no longer defaults to 3'
    });
    expect(predicate.ok).toBe(false);
    expect(predicate.issues.map((issue) => issue.code)).toEqual(['negated-in-predicate']);
  });

  it('accepts a single negated-free repetition of the same number (one distinct candidate)', () => {
    expect(
      bindCitedValue('3', { markerText: 'Retries default to 3 (yes, 3).', predicate: 'retries defaults to 3' }).ok
    ).toBe(true);
  });
});

describe('typed value binding (impl-08 finding 1: the asserted TYPE must match the prose form)', () => {
  it("REJECTS numeric 3 against the quoted string form (Sol's probe: '\"3\" (a string)')", () => {
    const result = bindCitedValue('3', {
      markerText: '`mode` defaults to "3" (a string).',
      predicate: 'the mode option defaults to the string "3"'
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('missing-in-marker');
  });

  it('rejects numeric 3 in the predicate when the predicate only states the quoted string form', () => {
    const result = bindCitedValue('3', {
      markerText: 'Retries default to 3.',
      predicate: 'retries defaults to "3"'
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(['missing-in-predicate']);
  });

  it('accepts the string "3" against quoted prose, and REJECTS it against a bare numeric token (vice versa)', () => {
    expect(
      bindCitedValue('"3"', {
        markerText: '`mode` defaults to "3" (a string).',
        predicate: 'the mode option defaults to the string "3"'
      }).ok
    ).toBe(true);
    const bare = bindCitedValue('"3"', {
      markerText: 'Retries default to 3.',
      predicate: 'retries defaults to 3'
    });
    expect(bare.ok).toBe(false);
    expect(bare.issues.map((issue) => issue.code).toSorted()).toEqual(['missing-in-marker', 'missing-in-predicate']);
  });

  it('accepts numeric 3 against unquoted prose that also mentions no other candidates', () => {
    expect(bindCitedValue('3', { markerText: 'Retries default to 3.', predicate: 'retries defaults to 3' }).ok).toBe(
      true
    );
  });

  it('keeps boolean/string discipline: boolean true never binds "true" (quoted), string "true" never binds bare true', () => {
    const boolAgainstQuoted = bindCitedValue('true', {
      markerText: '`flag` defaults to "true" (a string).',
      predicate: 'flag defaults to the string "true"'
    });
    expect(boolAgainstQuoted.ok).toBe(false);
    expect(boolAgainstQuoted.issues.map((issue) => issue.code)).toContain('missing-in-marker');
    const stringAgainstBare = bindCitedValue('"true"', {
      markerText: '`flag` defaults to true.',
      predicate: 'flag defaults to true'
    });
    expect(stringAgainstBare.ok).toBe(false);
    expect(stringAgainstBare.issues.map((issue) => issue.code).toSorted()).toEqual([
      'missing-in-marker',
      'missing-in-predicate'
    ]);
    // Semantic strings keep binding bare delimited occurrences — only other-scalar-shaped
    // contents require quoting.
    expect(bindCitedValue('linear', { markerText: 'backoff is linear.', predicate: 'backoff mode is linear' }).ok).toBe(
      true
    );
  });

  it('a quoted "3" in prose is not a numeric ambiguity candidate', () => {
    // The marker states ONE number (5) plus the string "3": no ambiguous-marker for numeric 5.
    expect(
      bindCitedValue('5', {
        markerText: 'Retries default to 5; `mode` defaults to "3".',
        predicate: 'retries defaults to 5'
      }).ok
    ).toBe(true);
    expect(lexNumericTokens('Retries default to 5; `mode` defaults to "3".')).toEqual([5]);
  });
});
