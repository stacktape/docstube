import { describe, expect, it } from 'vitest';
import { assessClaimCheckability, NEUTRAL_ALLOWLIST } from './checkability-grammar.ts';

// The fail-closed canonical checkability grammar (wave 2b close FINAL, impl-12): existence/value
// evidence may only DECIDE claims phrased inside the canonical grammar (gate 1: canonical
// predicate; gate 2: visible-window allowlist + denial screen). Everything else stays honestly
// unchecked — never a repair spiral, never an arms race with negation synonyms.

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

describe('gate 1 — canonical predicate (existence family)', () => {
  it('accepts every canonical existence form, with backticks and a trailing period tolerated', () => {
    for (const predicate of [
      'greet exists',
      '`greet` exists.',
      'greet is exported',
      'greet is exported from greeter',
      'greet is exported from `greeter`',
      'greet is defined',
      'greet is available'
    ]) {
      expect(existence('`greet` exists.', predicate)).toEqual({ checkable: true });
    }
  });

  it('rejects any predicate outside the family — shape prose is not existence-checkable', () => {
    for (const predicate of [
      'greet accepts a GreetOptions parameter',
      'greet returns a string',
      'greet was exported',
      'there is a function greet',
      'greet exists and is exported',
      'greet does not exist'
    ]) {
      const result = existence('`greet` exists.', predicate);
      expect(result).toMatchObject({ checkable: false, gate: 'canonical-predicate' });
    }
  });

  it('is case-sensitive and whole-identifier on the subject', () => {
    expect(existence('`greet` exists.', 'GREET exists')).toMatchObject({ checkable: false });
    expect(existence('`greet` exists.', 'greeting exists')).toMatchObject({ checkable: false });
  });
});

describe('gate 1 — canonical predicate (value family)', () => {
  it('accepts is/equals/defaults to/is set to with the subject root or a bound value path', () => {
    for (const predicate of [
      'DEFAULT_RETRIES is 3',
      'DEFAULT_RETRIES equals 3',
      'DEFAULT_RETRIES defaults to 3',
      'DEFAULT_RETRIES is set to 3.',
      '`DEFAULT_RETRIES` defaults to 3'
    ]) {
      expect(value('`DEFAULT_RETRIES` defaults to 3.', predicate)).toEqual({ checkable: true });
    }
    // A dotted value path rooted at the subject is an accepted subject spelling.
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

  it('requires the predicate value to normalize EXACTLY to the bound citedValue — kind and bytes', () => {
    // Wrong number, and the string "3" against the number 3, both fail gate 1.
    expect(value('`DEFAULT_RETRIES` is 3.', 'DEFAULT_RETRIES is 4')).toMatchObject({
      checkable: false,
      gate: 'canonical-predicate'
    });
    expect(value('`DEFAULT_RETRIES` is 3.', 'DEFAULT_RETRIES is "3"')).toMatchObject({ checkable: false });
  });

  it('normalized spellings of the SAME value pass: bare and JSON-quoted semantic strings agree', () => {
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

  it('rejects non-canonical value phrasing outside the verb family', () => {
    expect(value('`DEFAULT_RETRIES` is 3.', 'the DEFAULT_RETRIES option has a default of 3')).toMatchObject({
      checkable: false,
      gate: 'canonical-predicate'
    });
  });
});

describe('gate 2 — visible-window allowlist (fail closed by construction)', () => {
  it("Sol's impl-12 probe: '`greet` is absent' over predicate 'greet exists' is NOT checkable", () => {
    // The negation-cue vocabulary never listed 'absent' — the allowlist does not need to: any
    // unknown word near the subject fails, so the synonym arms race is over.
    const result = existence('`greet` is absent.', 'greet exists');
    expect(result).toMatchObject({ checkable: false, gate: 'visible-window' });
    expect(result.checkable === false && result.reason).toContain('absent');
  });

  it("Sol's long-window probe: a denial pushed beyond every window still fails (denial screen)", () => {
    const result = existence(
      '`greet` is available as the value of the option of the key that is not defined.',
      'greet exists'
    );
    expect(result).toMatchObject({ checkable: false, gate: 'visible-window' });
    expect(result.checkable === false && result.reason).toContain('"not"');
  });

  it('the documented fail-closed COST: a wordy-but-TRUE positive is honestly not checkable', () => {
    // 'added' and 'v2' are unknown vocabulary inside the window. The writer keeps the marker
    // tight ('`greet` exists.') and puts the history outside the marker.
    const result = existence('`greet`, added in v2, exists.', 'greet exists');
    expect(result).toMatchObject({ checkable: false, gate: 'visible-window' });
    expect(result.checkable === false && result.reason).toContain('"added"');
    expect(result.checkable === false && result.reason).toContain('"v2"');
  });

  it('an unrelated backticked identifier near the subject is unknown vocabulary', () => {
    expect(existence('`greet` exists like `shout`.', 'greet exists')).toMatchObject({
      checkable: false,
      gate: 'visible-window'
    });
  });

  it('a numeral in an existence window is unknown (no bound value exists to equal it)', () => {
    expect(existence('`greet` exists in 3 variants.', 'greet exists')).toMatchObject({
      checkable: false,
      gate: 'visible-window'
    });
  });

  it('a numeral NOT equal to the bound value fails a value claim window', () => {
    expect(value('`DEFAULT_RETRIES` is 3 of 15.', 'DEFAULT_RETRIES is 3')).toMatchObject({
      checkable: false,
      gate: 'visible-window'
    });
  });

  it("contractions fail closed on their own tokens ('doesn' + 't' are unknown)", () => {
    expect(existence("`greet` doesn't exist.", 'greet exists')).toMatchObject({ checkable: false });
  });

  it('the subject and value must occur as word tokens in the visible prose', () => {
    expect(existence('the function exists.', 'greet exists')).toMatchObject({ checkable: false });
    expect(value('`DEFAULT_RETRIES` is small.', 'DEFAULT_RETRIES is 3')).toMatchObject({ checkable: false });
  });

  it("the gate-1 'exported from' module identifier is a claim-bound token in the window", () => {
    expect(existence('`greet` is exported from `greeter`.', 'greet is exported from greeter')).toEqual({
      checkable: true
    });
    // A DIFFERENT module identifier in the prose is unknown vocabulary.
    expect(existence('`greet` is exported from `elsewhere`.', 'greet is exported from greeter')).toMatchObject({
      checkable: false,
      gate: 'visible-window'
    });
  });

  it('canonical positives pass end to end: tight markers of neutral words plus bound tokens', () => {
    expect(existence('`greet` exists.', 'greet exists')).toEqual({ checkable: true });
    expect(existence('the `greet` function is available.', 'greet is available')).toEqual({ checkable: true });
    expect(value('`DEFAULT_RETRIES` defaults to 3.', 'DEFAULT_RETRIES defaults to 3')).toEqual({ checkable: true });
    expect(value('the `DEFAULT_RETRIES` value is set to 3.', 'DEFAULT_RETRIES is set to 3')).toEqual({
      checkable: true
    });
  });

  it('multi-token semantic string values bind each of their word tokens', () => {
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

describe('the neutral allowlist itself', () => {
  it('contains no negation or past-tense vocabulary — fail-closed by curation', () => {
    for (const word of ['not', 'no', 'never', 'cannot', 'was', 'were', 'absent', 'missing', 'removed', 'formerly']) {
      expect(NEUTRAL_ALLOWLIST.has(word)).toBe(false);
    }
  });
});
