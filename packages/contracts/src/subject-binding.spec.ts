import { describe, expect, it } from 'vitest';
import { bindClaimSubject, identifierOccursAsToken, valueNameBindableSegments } from './subject-binding.ts';

// Subject binding (impl-09 finding 1): evidence may only mint when the visible prose or the
// predicate names the subject the evidence points at — as an identifier token, case-sensitive,
// compared against the CODEMAP record's name (plus the cited-value path segments for values).

describe('identifierOccursAsToken', () => {
  it('matches a delimited identifier: backticks, quotes, dots, parens, punctuation all bound it', () => {
    for (const text of [
      '`createClient` returns a client.',
      'call createClient() first',
      'the createClient.timeout option',
      'see "createClient" for details',
      'createClient'
    ]) {
      expect(identifierOccursAsToken('createClient', text)).toBe(true);
    }
  });

  it('never matches a fragment of a longer identifier', () => {
    expect(identifierOccursAsToken('retry', '`retries` defaults to 3.')).toBe(false);
    expect(identifierOccursAsToken('retry', 'the retryCount option')).toBe(false);
    expect(identifierOccursAsToken('retry', 'maxRetry wins')).toBe(false);
    expect(identifierOccursAsToken('Client', 'createClient exists')).toBe(false);
  });

  it('is case-sensitive: MODE never binds prose saying mode', () => {
    expect(identifierOccursAsToken('MODE', 'the mode option')).toBe(false);
    expect(identifierOccursAsToken('MODE', 'the MODE constant')).toBe(true);
  });
});

describe('valueNameBindableSegments', () => {
  it('offers root, intermediate, and leaf identifier segments of a dotted path', () => {
    expect(valueNameBindableSegments('retryDefaults.backoff.factor')).toEqual(['retryDefaults', 'backoff', 'factor']);
    expect(valueNameBindableSegments('LogLevel.Warn')).toEqual(['LogLevel', 'Warn']);
  });

  it("NEVER offers the structural grammar keywords 'param' and 'default' — ordinary prose words", () => {
    expect(valueNameBindableSegments('createClient.param.timeout.default')).toEqual(['createClient', 'timeout']);
  });
});

describe('bindClaimSubject', () => {
  it("REJECTS Sol's probe 1: 'inventedFunction exists' against an unrelated real symbol", () => {
    const result = bindClaimSubject({
      subjectName: 'greet',
      markerText: '`inventedFunction` exists.',
      predicate: 'inventedFunction exists'
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.candidates).toEqual(['greet']);
  });

  it("REJECTS Sol's probe 2: 'INVENTED_DEFAULT is 3' against an unrelated equal-valued name", () => {
    const result = bindClaimSubject({
      subjectName: 'DEFAULT_RETRIES',
      valueNames: ['DEFAULT_RETRIES'],
      markerText: '`INVENTED_DEFAULT` is 3.',
      predicate: 'INVENTED_DEFAULT is 3'
    });
    expect(result.ok).toBe(false);
  });

  it('binds through the codemap record name — genuine aliasing keeps passing', () => {
    // Prose names `createClient`; the evidence points at the symbol whose codemap NAME is
    // createClient — the rule compares against the record name, never the writer's proposal text.
    expect(
      bindClaimSubject({
        subjectName: 'createClient',
        markerText: '`createClient` accepts an options object.',
        predicate: 'createClient accepts an options parameter'
      })
    ).toEqual({ ok: true, boundName: 'createClient' });
  });

  it('binds a value claim through any identifier segment of the valueName path', () => {
    // Root identifier named.
    expect(
      bindClaimSubject({
        subjectName: 'retryDefaults',
        valueNames: ['retryDefaults.backoff.factor'],
        markerText: '`retryDefaults` uses exponential backoff.',
        predicate: 'the backoff factor defaults to 2'
      }).ok
    ).toBe(true);
    // Only the leaf path segment named — still bound.
    expect(
      bindClaimSubject({
        subjectName: 'retryDefaults',
        valueNames: ['retryDefaults.backoff.factor'],
        markerText: 'the `factor` option defaults to 2.',
        predicate: 'factor defaults to 2'
      }).ok
    ).toBe(true);
    // A parameter-default path binds through the parameter name, not through 'default'.
    expect(
      bindClaimSubject({
        subjectName: 'createClient',
        valueNames: ['createClient.param.retries.default'],
        markerText: '`retries` defaults to 3.',
        predicate: 'the retries option defaults to 3'
      }).ok
    ).toBe(true);
    expect(
      bindClaimSubject({
        subjectName: 'createClient',
        valueNames: ['createClient.param.retries.default'],
        markerText: 'the default is 3.',
        predicate: 'the default is 3'
      }).ok
    ).toBe(false);
  });

  it('binds through either side: marker text OR predicate suffices', () => {
    expect(
      bindClaimSubject({
        subjectName: 'greet',
        markerText: 'The greeting helper exists.',
        predicate: 'greet exists'
      }).ok
    ).toBe(true);
  });
});
