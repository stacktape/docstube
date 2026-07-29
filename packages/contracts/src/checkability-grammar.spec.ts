import { describe, expect, it } from 'vitest';
import {
  assessClaimCheckability,
  canonicalizeAssertionText,
  parseValueAssertionText,
  renderValuePathSubject
} from './checkability-grammar.ts';

// EXACT CANONICAL VISIBLE MATCH (wave 2b close FINAL, impl-13/impl-14): existence/value evidence
// may only DECIDE a claim whose VISIBLE marker text, after minimal cosmetic normalization,
// exactly equals one canonical assertion — and whose predicate states the SAME assertion. No
// windows, no allowlists, no denial vocabulary: any other word anywhere in the visible span
// fails the match, so unknown prose is unchecked by construction. Marker text is AST-derived
// RENDERED text (inline-code already contributed bare content), so these tests feed BARE
// spellings — a backtick that survives rendering is literal content and must fail.

const existence = (markerText: string, predicate: string, subjectName = 'greet') =>
  assessClaimCheckability({ style: 'existence', subjectName, markerPureText: true, markerText, predicate });

const value = (markerText: string, predicate: string, citedValue = '3', valueNames = ['DEFAULT_RETRIES']) =>
  assessClaimCheckability({
    style: 'value',
    subjectName: 'DEFAULT_RETRIES',
    valueNames,
    citedValue,
    markerPureText: true,
    markerText,
    predicate
  });

describe('cosmetic normalization', () => {
  it('collapses whitespace, drops one trailing period, and applies NFC — nothing else', () => {
    expect(canonicalizeAssertionText('greet   exists.')).toBe('greet exists');
    expect(canonicalizeAssertionText(' DEFAULT_RETRIES defaults to 3 ')).toBe('DEFAULT_RETRIES defaults to 3');
    // NFC: a decomposed é normalizes to the composed form.
    expect(canonicalizeAssertionText('café')).toBe('café');
    // Only ONE trailing period is cosmetic.
    expect(canonicalizeAssertionText('greet exists..')).toBe('greet exists.');
  });

  it('does NOT strip backticks — rendered text is already bare, so a surviving backtick is literal content', () => {
    expect(canonicalizeAssertionText('greet ex`ists.')).toBe('greet ex`ists');
    expect(canonicalizeAssertionText('`greet` exists.')).toBe('`greet` exists');
  });
});

describe('renderValuePathSubject — the ONE documented value-path rendering', () => {
  it('renders parameter defaults call-shaped and every other path as itself', () => {
    expect(renderValuePathSubject('DEFAULT_RETRIES')).toBe('DEFAULT_RETRIES');
    expect(renderValuePathSubject('retryDefaults.backoff.factor')).toBe('retryDefaults.backoff.factor');
    expect(renderValuePathSubject('LogLevel.Warn')).toBe('LogLevel.Warn');
    expect(renderValuePathSubject('createClient.param.retries.default')).toBe('createClient(retries)');
    // Class-member owners keep their dotted owner path.
    expect(renderValuePathSubject('Client.connect.param.timeout.default')).toBe('Client.connect(timeout)');
  });
});

describe('pure-marker precondition — the render-laundering class (wave 2b close final)', () => {
  it('a NON-PURE marker is never checkable, even with exact canonical text on both sides', () => {
    // The scanned text is canonical, but the marker contained nodes (image alt, footnote, …)
    // whose rendered output the scan cannot vouch for — checkability fails before any grammar.
    expect(
      assessClaimCheckability({
        style: 'existence',
        subjectName: 'greet',
        markerPureText: false,
        markerText: 'greet exists.',
        predicate: 'greet exists'
      })
    ).toMatchObject({ checkable: false, gate: 'marker-impure' });
    expect(
      assessClaimCheckability({
        style: 'value',
        subjectName: 'DEFAULT_RETRIES',
        valueNames: ['DEFAULT_RETRIES'],
        citedValue: '3',
        markerPureText: false,
        markerText: 'DEFAULT_RETRIES is 3.',
        predicate: 'DEFAULT_RETRIES is 3'
      })
    ).toMatchObject({ checkable: false, gate: 'marker-impure' });
  });

  it('the impure reason teaches the fix: plain prose and backticked identifiers only', () => {
    const result = assessClaimCheckability({
      style: 'existence',
      subjectName: 'greet',
      markerPureText: false,
      markerText: 'greet exists.',
      predicate: 'greet exists'
    });
    expect(result.checkable === false && result.reason).toContain('plain prose and backticked identifiers');
  });
});

describe('existence family — exact canonical visible match', () => {
  it('accepts each canonical form when the visible prose and the predicate state the SAME assertion — and reports it', () => {
    for (const form of ['exists', 'is defined', 'is available', 'is exported'] as const) {
      expect(existence(`greet ${form}.`, `greet ${form}`)).toEqual({ checkable: true, form });
    }
  });

  it('cosmetic differences between the sides are tolerated — whitespace and a trailing period only', () => {
    expect(existence('greet  exists.', 'greet exists')).toEqual({ checkable: true, form: 'exists' });
    expect(existence('greet is defined', 'greet is defined.')).toEqual({ checkable: true, form: 'is defined' });
  });

  it("Sol's escaped-backtick probe: a LITERAL backtick in the rendered prose fails the match", () => {
    // MDX '`greet` ex\`ists.' renders as 'greet ex`ists.' — under the old backtick-stripping
    // normalizer this collapsed to 'greet exists' and minted checked. Backticks are content now.
    expect(existence('greet ex`ists.', 'greet exists')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });

  it('a backticked predicate is no longer cosmetic — the ledger predicate spells identifiers bare', () => {
    expect(existence('greet exists.', '`greet` exists')).toMatchObject({
      checkable: false,
      gate: 'canonical-predicate'
    });
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
      expect(existence('greet exists.', predicate)).toMatchObject({ checkable: false, gate: 'canonical-predicate' });
    }
  });

  it('is case-sensitive and whole-identifier on the subject', () => {
    expect(existence('GREET exists.', 'GREET exists')).toMatchObject({ checkable: false });
    expect(existence('greeting exists.', 'greeting exists')).toMatchObject({ checkable: false });
  });

  it("Sol's laundering probe: 'greet returns the value.' over predicate 'greet exists' is NOT checkable", () => {
    // The predicate is canonical, but the reader sees a behavior sentence — the visible text must
    // BE the canonical assertion, not merely accompany one.
    const result = existence('greet returns the value.', 'greet exists');
    expect(result).toMatchObject({ checkable: false, gate: 'canonical-visible' });
    expect(result.checkable === false && result.reason).toContain('ONLY the canonical assertion');
  });

  it("Sol's module probe: 'greet is exported from fiction.' is NOT checkable — the from-variant is removed", () => {
    // The module was never verified by any evidence; the variant returns in v1.x only with a
    // codemap-verified module binding.
    expect(existence('greet is exported from fiction.', 'greet is exported from fiction')).toMatchObject({
      checkable: false
    });
    // Even a bare 'is exported' predicate cannot ride under module-naming visible prose.
    expect(existence('greet is exported from fiction.', 'greet is exported')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });

  it("Sol's non-Latin probe: 'greet 不存在.' is NOT checkable — no tokenizer exists to fool", () => {
    expect(existence('greet 不存在.', 'greet exists')).toMatchObject({ checkable: false, gate: 'canonical-visible' });
  });

  it("Sol's distant-clause probe: 'greet, which recently ceased to exist, exists' is NOT checkable", () => {
    expect(existence('greet, which recently ceased to exist, exists', 'greet exists')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });

  it('the documented fail-closed COST: wordy-but-TRUE positives are honestly not checkable', () => {
    expect(existence('greet, added in v2, exists.', 'greet exists')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
    expect(existence('the greet function is available.', 'greet is available')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });

  it('mixed canonical forms are DIFFERENT assertions — the sides must state the same one', () => {
    expect(existence('greet exists.', 'greet is defined')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });
});

const rootOnly = (markerText: string, predicate: string) =>
  assessClaimCheckability({
    style: 'value',
    subjectName: 'configFileNames',
    valueNames: ['configFileNames.config'],
    citedValue: 'docstube.yml',
    markerPureText: true,
    markerText,
    predicate
  });

const paramDefault = (markerText: string, predicate: string) =>
  assessClaimCheckability({
    style: 'value',
    subjectName: 'createClient',
    valueNames: ['createClient.param.retries.default'],
    citedValue: '3',
    markerPureText: true,
    markerText,
    predicate
  });

describe('value family — exact canonical visible match', () => {
  it('accepts is/equals/defaults to/is set to when both sides state the same assertion', () => {
    for (const verb of ['is', 'equals', 'defaults to', 'is set to']) {
      expect(value(`DEFAULT_RETRIES ${verb} 3.`, `DEFAULT_RETRIES ${verb} 3`)).toEqual({ checkable: true });
    }
  });

  it('the FULL dotted value path is the accepted subject spelling', () => {
    expect(
      assessClaimCheckability({
        style: 'value',
        subjectName: 'retryDefaults',
        valueNames: ['retryDefaults.backoff.factor'],
        citedValue: '2',
        markerPureText: true,
        markerText: 'retryDefaults.backoff.factor is 2.',
        predicate: 'retryDefaults.backoff.factor is 2'
      })
    ).toEqual({ checkable: true });
  });

  it("Sol's root-substitution probe: the ROOT OBJECT alone never substitutes for a bound value path", () => {
    // 'configFileNames is docstube.yml' asserts a value for the whole OBJECT while the evidence
    // proves only the .config leaf — under the old subject list the root name slipped through.
    expect(rootOnly('configFileNames is docstube.yml.', 'configFileNames is docstube.yml')).toMatchObject({
      checkable: false,
      gate: 'canonical-predicate'
    });
    // The full path keeps working.
    expect(rootOnly('configFileNames.config is docstube.yml.', 'configFileNames.config is docstube.yml')).toEqual({
      checkable: true
    });
  });

  it('parameter defaults use the call-shaped rendering — the raw grammar path is not prose', () => {
    expect(paramDefault('createClient(retries) defaults to 3.', 'createClient(retries) defaults to 3')).toEqual({
      checkable: true
    });
    // Neither the raw grammar path nor the bare owner substitutes for the rendered form.
    expect(
      paramDefault('createClient.param.retries.default is 3.', 'createClient.param.retries.default is 3')
    ).toMatchObject({ checkable: false, gate: 'canonical-predicate' });
    expect(paramDefault('createClient defaults to 3.', 'createClient defaults to 3')).toMatchObject({
      checkable: false,
      gate: 'canonical-predicate'
    });
  });

  it('requires the value on BOTH sides to normalize EXACTLY to the bound citedValue — kind and bytes', () => {
    // Wrong number, and the string "3" against the number 3, both fail.
    expect(value('DEFAULT_RETRIES is 3.', 'DEFAULT_RETRIES is 4')).toMatchObject({
      checkable: false,
      gate: 'canonical-predicate'
    });
    expect(value('DEFAULT_RETRIES is 3.', 'DEFAULT_RETRIES is "3"')).toMatchObject({ checkable: false });
    expect(value('DEFAULT_RETRIES is "3".', 'DEFAULT_RETRIES is 3')).toMatchObject({
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
        markerPureText: true,
        markerText: 'MODE defaults to linear.',
        predicate: 'MODE defaults to "linear"'
      })
    ).toEqual({ checkable: true });
  });

  it("Sol's behavior-prose probe: 'MODE returns linear.' is NOT checkable — behavior prose can never reach value evidence", () => {
    expect(
      assessClaimCheckability({
        style: 'value',
        subjectName: 'MODE',
        valueNames: ['MODE'],
        citedValue: 'linear',
        markerPureText: true,
        markerText: 'MODE returns linear.',
        predicate: 'MODE returns linear'
      })
    ).toMatchObject({ checkable: false, gate: 'canonical-predicate' });
  });

  it('a verb mismatch between the sides is a DIFFERENT assertion, not cosmetic', () => {
    expect(value('DEFAULT_RETRIES defaults to 3.', 'DEFAULT_RETRIES is 3')).toMatchObject({
      checkable: false,
      gate: 'canonical-visible'
    });
  });

  it('ANY extra word or literal backtick in the visible span fails the exact match', () => {
    for (const markerText of [
      'the DEFAULT_RETRIES value is set to 3.',
      'DEFAULT_RETRIES is 3 of 15.',
      'DEFAULT_RETRIES is 3 across most retry paths.',
      'DEFAULT_RETRIES is now 3.',
      'DEFAULT_RETRIES` is 3.'
    ]) {
      expect(value(markerText, 'DEFAULT_RETRIES is 3')).toMatchObject({
        checkable: false,
        gate: 'canonical-visible'
      });
    }
  });

  it('rejects non-canonical predicate phrasing outside the verb family', () => {
    expect(value('DEFAULT_RETRIES is 3.', 'the DEFAULT_RETRIES option has a default of 3')).toMatchObject({
      checkable: false,
      gate: 'canonical-predicate'
    });
  });

  it('a value claim with no bound citedValue is never checkable', () => {
    expect(
      assessClaimCheckability({
        style: 'value',
        subjectName: 'DEFAULT_RETRIES',
        markerPureText: true,
        markerText: 'DEFAULT_RETRIES is 3.',
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
        markerPureText: true,
        markerText: 'MODE is set to exponential-backoff.',
        predicate: 'MODE is set to exponential-backoff'
      })
    ).toEqual({ checkable: true });
  });
});

// THE OPEN PARSER (impl-15 finding 2): reads the value PATH out of a claim's own assertion so the
// kernel can look it up in the fingerprint snapshot. It only NOMINATES a candidate — subject
// binding, snapshot agreement, and the closed grammar above still decide everything.
describe('parseValueAssertionText', () => {
  it('reads subject, verb, and value spelling from the canonical forms', () => {
    expect(parseValueAssertionText('configFileNames.config is docstube.yml')).toEqual({
      subject: 'configFileNames.config',
      verb: 'is',
      valueSpelling: 'docstube.yml'
    });
    expect(parseValueAssertionText('DEFAULT_RETRIES defaults to 3.')).toEqual({
      subject: 'DEFAULT_RETRIES',
      verb: 'defaults to',
      valueSpelling: '3'
    });
    // The call-shaped rendering of a parameter default round-trips renderValuePathSubject.
    expect(parseValueAssertionText('createClient(retries) equals 3')).toMatchObject({
      subject: renderValuePathSubject('createClient.param.retries.default'),
      verb: 'equals'
    });
  });

  it("longest-verb-first: 'is set to' is never truncated to a bare 'is'", () => {
    expect(parseValueAssertionText('MODE is set to linear')).toEqual({
      subject: 'MODE',
      verb: 'is set to',
      valueSpelling: 'linear'
    });
  });

  it('refuses anything that is not exactly one canonical value assertion', () => {
    // Verb outside the family, prose before the subject, and a non-identifier subject.
    expect(parseValueAssertionText('action.yml uses node24')).toBeUndefined();
    expect(parseValueAssertionText('the DEFAULT_RETRIES option is 3')).toBeUndefined();
    expect(parseValueAssertionText('greet exists')).toBeUndefined();
  });
});
