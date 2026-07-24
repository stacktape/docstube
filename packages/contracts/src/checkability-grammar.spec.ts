import { describe, expect, it } from 'vitest';
import { assessClaimCheckability, canonicalizeAssertionText } from './checkability-grammar.ts';

// EXACT CANONICAL VISIBLE MATCH (wave 2b close FINAL, impl-13): existence/value evidence may only
// DECIDE a claim whose VISIBLE marker text, after minimal cosmetic normalization, exactly equals
// one canonical assertion — and whose predicate states the SAME assertion. No windows, no
// allowlists, no denial vocabulary: any other word anywhere in the visible span fails the match,
// so unknown prose is unchecked by construction. Everything else stays honestly unchecked —
// never a repair spiral, never an arms race with synonyms or scripts.

const existence = (markerText: string, predicate: string, subjectName = 'greet') =>
  assessClaimCheckability({ style: 'existence', subjectName, markerText, predicate });

const value = (markerText: string, predicate: string, citedValue = '3', valueNames = ['DEFAULT_RETRIES']) =>
  assessClaimCheckability({
    style: 'value',
    subjectName: 'DEFAULT_RETRIES',
    valueNames,
    citedValue,
    markerText,
    predicate
  });

describe('cosmetic normalization', () => {
  it('strips backticks, collapses whitespace, drops one trailing period, and applies NFC', () => {
    expect(canonicalizeAssertionText('`greet`   exists.')).toBe('greet exists');
    expect(canonicalizeAssertionText(' DEFAULT_RETRIES defaults to `3` ')).toBe('DEFAULT_RETRIES defaults to 3');
    // NFC: a decomposed é normalizes to the composed form.
    expect(canonicalizeAssertionText('café')).toBe('café');
    // Only ONE trailing period is cosmetic.
    expect(canonicalizeAssertionText('greet exists..')).toBe('greet exists.');
  });
});

describe('existence family — exact canonical visible match', () => {
  it('accepts each canonical form when the visible prose and the predicate state the SAME assertion', () => {
    for (const form of ['exists', 'is defined', 'is available', 'is exported']) {
      expect(existence(`\`greet\` ${form}.`, `greet ${form}`)).toEqual({ checkable: true });
    }
  });

  it('cosmetic differences between the sides are tolerated — backticks, whitespace, trailing period', () => {
    expect(existence('`greet`  exists.', 'greet exists')).toEqual({ checkable: true });
    expect(existence('greet is defined', '`greet` is defined.')).toEqual({ checkable: true });
  });

  it('rejects a predicate outside the family — shape/behavior prose is not existence-checkable', () => {
    for (const predicate of [
      'greet accepts a GreetOptions parameter',
      'greet returns a string',
      'greet was exported',
      'there is a function greet',
      'greet exists and is exported',
      'greet does not exist'
    ]) {
      expect(existence('`greet` exists.', predicate)).toMatchObject({ checkable: false, gate: 'canonical-predicate' });
    }
  });

  it('is case-sensitive and whole-identifier on the subject', () => {
    expect(existence('`GREET` exists.', 'GREET exists')).toMatchObject({ checkable: false });
    expect(existence('`greeting` exists.', 'greeting exists')).toMatchObject({ checkable: false });
  });

  it("Sol's laundering probe: '`greet` returns the value.' over predicate 'greet exists' is NOT checkable", () => {
    // The predicate is canonical, but the reader sees a behavior sentence — the visible text must
    // BE the canonical assertion, not merely accompany one.
    const result = existence('`greet` returns the value.', 'greet exists');
    expect(result).toMatchObject({ checkable: false, gate: 'canonical-visible' });
    expect(result.checkable === false && result.reason).toContain('ONLY the canonical assertion');
  });

  it("Sol's module probe: '`greet` is exported from `fiction`.' is NOT checkable — the from-variant is removed", () => {
    // The module was never verified by any evidence; the variant returns in v1.x only with a
    // codemap-verified module binding.
    expect(existence('`greet` is exported from `fiction`.', 'greet is exported from fiction')).toMatchObject({
      checkable: false
    });
    // Even a bare 'is exported' predicate cannot ride under module-naming visible prose.
    expect(existence('`greet` is exported from `fiction`.', 'greet is exported')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });

  it("Sol's non-Latin probe: '`greet` 不存在.' is NOT checkable — no tokenizer exists to fool", () => {
    expect(existence('`greet` 不存在.', 'greet exists')).toMatchObject({ checkable: false, gate: 'canonical-visible' });
  });

  it("Sol's distant-clause probe: '`greet`, which recently ceased to exist, exists' is NOT checkable", () => {
    expect(existence('`greet`, which recently ceased to exist, exists', 'greet exists')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });

  it('the documented fail-closed COST: wordy-but-TRUE positives are honestly not checkable', () => {
    expect(existence('`greet`, added in v2, exists.', 'greet exists')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
    expect(existence('the `greet` function is available.', 'greet is available')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });

  it('mixed canonical forms are DIFFERENT assertions — the sides must state the same one', () => {
    expect(existence('`greet` exists.', 'greet is defined')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });
});

describe('value family — exact canonical visible match', () => {
  it('accepts is/equals/defaults to/is set to when both sides state the same assertion', () => {
    for (const verb of ['is', 'equals', 'defaults to', 'is set to']) {
      expect(value(`\`DEFAULT_RETRIES\` ${verb} 3.`, `DEFAULT_RETRIES ${verb} 3`)).toEqual({ checkable: true });
    }
  });

  it('a dotted value path rooted at the subject is an accepted subject spelling', () => {
    expect(
      assessClaimCheckability({
        style: 'value',
        subjectName: 'retryDefaults',
        valueNames: ['retryDefaults.backoff.factor'],
        citedValue: '2',
        markerText: '`retryDefaults.backoff.factor` is 2.',
        predicate: 'retryDefaults.backoff.factor is 2'
      })
    ).toEqual({ checkable: true });
  });

  it('requires the value on BOTH sides to normalize EXACTLY to the bound citedValue — kind and bytes', () => {
    // Wrong number, and the string "3" against the number 3, both fail.
    expect(value('`DEFAULT_RETRIES` is 3.', 'DEFAULT_RETRIES is 4')).toMatchObject({
      checkable: false,
      gate: 'canonical-predicate'
    });
    expect(value('`DEFAULT_RETRIES` is 3.', 'DEFAULT_RETRIES is "3"')).toMatchObject({ checkable: false });
    expect(value('`DEFAULT_RETRIES` is "3".', 'DEFAULT_RETRIES is 3')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });

  it('normalized spellings of the SAME value are cosmetic: bare and JSON-quoted semantic strings agree', () => {
    expect(
      assessClaimCheckability({
        style: 'value',
        subjectName: 'MODE',
        valueNames: ['MODE'],
        citedValue: 'linear',
        markerText: '`MODE` defaults to linear.',
        predicate: 'MODE defaults to "linear"'
      })
    ).toEqual({ checkable: true });
  });

  it("Sol's behavior-prose probe: '`MODE` returns linear.' is NOT checkable — behavior prose can never reach value evidence", () => {
    expect(
      assessClaimCheckability({
        style: 'value',
        subjectName: 'MODE',
        valueNames: ['MODE'],
        citedValue: 'linear',
        markerText: '`MODE` returns linear.',
        predicate: 'MODE returns linear'
      })
    ).toMatchObject({ checkable: false, gate: 'canonical-predicate' });
  });

  it('a verb mismatch between the sides is a DIFFERENT assertion, not cosmetic', () => {
    expect(value('`DEFAULT_RETRIES` defaults to 3.', 'DEFAULT_RETRIES is 3')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });

  it('ANY extra word in the visible span fails the exact match', () => {
    for (const markerText of [
      'the `DEFAULT_RETRIES` value is set to 3.',
      '`DEFAULT_RETRIES` is 3 of 15.',
      '`DEFAULT_RETRIES` is 3 across most retry paths.',
      '`DEFAULT_RETRIES` is now 3.'
    ]) {
      expect(value(markerText, 'DEFAULT_RETRIES is 3')).toMatchObject({
        checkable: false,
        gate: 'canonical-visible'
      });
    }
  });

  it('rejects non-canonical predicate phrasing outside the verb family', () => {
    expect(value('`DEFAULT_RETRIES` is 3.', 'the DEFAULT_RETRIES option has a default of 3')).toMatchObject({
      checkable: false,
      gate: 'canonical-predicate'
    });
  });

  it('a value claim with no bound citedValue is never checkable', () => {
    expect(
      assessClaimCheckability({
        style: 'value',
        subjectName: 'DEFAULT_RETRIES',
        markerText: '`DEFAULT_RETRIES` is 3.',
        predicate: 'DEFAULT_RETRIES is 3'
      })
    ).toMatchObject({ checkable: false, gate: 'canonical-predicate' });
  });

  it('multi-word canonical positives pass — the value spelling is whatever normalizes to the bound value', () => {
    expect(
      assessClaimCheckability({
        style: 'value',
        subjectName: 'MODE',
        valueNames: ['MODE'],
        citedValue: 'exponential-backoff',
        markerText: '`MODE` is set to exponential-backoff.',
        predicate: 'MODE is set to exponential-backoff'
      })
    ).toEqual({ checkable: true });
  });
});
