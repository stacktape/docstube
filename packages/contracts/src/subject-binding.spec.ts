import { describe, expect, it } from 'vitest';
import { bindClaimSubject, identifierOccursAsToken, valueNameBindableSegments } from './subject-binding.ts';

// Subject binding (impl-09 finding 1, tightened by impl-10 findings 1+2): evidence may only mint
// when BOTH the visible prose AND the predicate name the subject's ROOT identifier — as an
// identifier token, case-sensitive, compared against the CODEMAP record's name. Cited-value path
// segments are context only; they never substitute for the root.

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
  it("REJECTS Sol's probe 1: 'inventedFunction exists' on both sides against an unrelated real symbol", () => {
    const result = bindClaimSubject({
      subjectName: 'greet',
      markerText: '`inventedFunction` exists.',
      predicate: 'inventedFunction exists'
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.requiredName).toBe('greet');
    expect(result.ok ? [] : result.missingIn).toEqual(['marker', 'predicate']);
  });

  it("REJECTS Sol's impl-10 probe: predicate-only occurrence is laundering — readers never see the predicate", () => {
    // Visible prose asserts 'inventedFunction exists'; the predicate quietly names the REAL
    // symbol greet. Under the old either-side rule this minted 'checked' for a visibly false
    // sentence. The both-sides rule rejects: the root must occur in the VISIBLE text too.
    const result = bindClaimSubject({
      subjectName: 'greet',
      markerText: '`inventedFunction` exists.',
      predicate: 'greet exists'
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.missingIn).toEqual(['marker']);
  });

  it('REJECTS visible-only occurrence: the predicate must restate the subject it asserts about', () => {
    const result = bindClaimSubject({
      subjectName: 'greet',
      markerText: '`greet` exists.',
      predicate: 'the function exists'
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.missingIn).toEqual(['predicate']);
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

  it('a value claim binds when the ROOT identifier appears on both sides — segments are extra context', () => {
    // Legitimate case (impl-10 finding 2): the prose names retryDefaults (the root) and factor
    // (a segment); the predicate's dotted path contains the root as a token (dots delimit).
    expect(
      bindClaimSubject({
        subjectName: 'retryDefaults',
        valueNames: ['retryDefaults.backoff.factor'],
        markerText: '`retryDefaults` uses an exponential backoff `factor` of 2.',
        predicate: 'retryDefaults.backoff.factor is 2'
      })
    ).toEqual({ ok: true, boundName: 'retryDefaults' });
  });

  it("REJECTS common-leaf laundering — Sol's impl-10 probe: 'config' must not bind configFileNames.config", () => {
    // A false "The Vite `config` is docstube.yml" claim rode the unrelated configFileNames.config
    // value solely through the common leaf 'config'. Segments never substitute for the root.
    const result = bindClaimSubject({
      subjectName: 'configFileNames',
      valueNames: ['configFileNames.config'],
      markerText: 'The Vite `config` is `docstube.yml`.',
      predicate: 'config is docstube.yml'
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.requiredName).toBe('configFileNames');
    expect(result.ok ? [] : result.missingIn).toEqual(['marker', 'predicate']);
    expect(result.ok ? [] : result.contextSegments).toEqual(['config']);
  });

  it('REJECTS a leaf-segment-only occurrence even when both sides name the leaf', () => {
    // The old rule accepted this; naming only 'factor' leaves the actual subject unnamed.
    expect(
      bindClaimSubject({
        subjectName: 'retryDefaults',
        valueNames: ['retryDefaults.backoff.factor'],
        markerText: 'the `factor` option defaults to 2.',
        predicate: 'factor defaults to 2'
      }).ok
    ).toBe(false);
  });

  it("never binds through the structural grammar keywords 'param' and 'default'", () => {
    const result = bindClaimSubject({
      subjectName: 'createClient',
      valueNames: ['createClient.param.retries.default'],
      markerText: 'the default is 3.',
      predicate: 'the default is 3'
    });
    expect(result.ok).toBe(false);
    // 'param' and 'default' never even appear as context segments.
    expect(result.ok ? [] : result.contextSegments).toEqual(['retries']);
  });
});
