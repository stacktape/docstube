import { describe, expect, it } from 'vitest';
import { citedValueBindsToTexts, citedValueOccursInText, normalizeCitedValue } from './cited-value-binding.ts';

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
  it('binds numbers through any equal numeric literal in the text', () => {
    const three = normalizeCitedValue('3');
    expect(citedValueOccursInText(three, 'Retries default to 3.')).toBe(true);
    expect(citedValueOccursInText(three, 'Retries default to 3.0 attempts.')).toBe(true);
    expect(citedValueOccursInText(normalizeCitedValue('1000'), 'the cap is 1_000 ms')).toBe(true);
    expect(citedValueOccursInText(three, 'Retries default to 5.')).toBe(false);
    // "13" contains the digit 3 but is not the number 3 — token equality, not substring.
    expect(citedValueOccursInText(three, 'Retries default to 13.')).toBe(false);
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

describe('citedValueBindsToTexts', () => {
  it('accepts a value present in the marker prose OR the predicate', () => {
    expect(citedValueBindsToTexts('3', ['Retries default to 3.', 'irrelevant'])).toBe(true);
    expect(citedValueBindsToTexts('3', ['is totally-wrong', 'the retries option defaults to 3'])).toBe(true);
  });

  it('rejects the value-laundering case: correct citedValue, wrong visible prose', () => {
    // The impl-06 probe: prose asserts "totally-wrong", the ledger smuggles the correct value.
    expect(citedValueBindsToTexts('3', ['`retries` is totally-wrong.', 'retries is totally-wrong'])).toBe(false);
  });
});
