import { describe, expect, it } from 'vitest';
import { codemapSchema } from '@docstube/contracts';
import type { ExtractedClaim } from './extract-claims.ts';
import { buildCodemapIndex, matchClaim, normalizeIdentifier } from './match-claims.ts';

// The deterministic half of audit. Every defect asserted here is re-checkable by hand against the
// fixture codemap — that property is the whole point (never overclaim).

const hex = (fill: string) => `sym:${fill.repeat(64)}`;

const codemap = codemapSchema.parse({
  schemaVersion: 1,
  commit: '0'.repeat(40),
  symbols: [
    {
      hash: hex('a'),
      lang: 'ts',
      kind: 'function',
      name: 'greet',
      containerPath: ['src', 'greeter'],
      file: 'src/greeter.ts',
      span: [5, 8]
    },
    {
      hash: hex('b'),
      lang: 'ts',
      kind: 'method',
      name: 'send',
      containerPath: ['src', 'client', 'Greeter'],
      file: 'src/client.ts',
      span: [10, 14]
    }
  ]
});

const index = buildCodemapIndex(codemap);

const claim = (identifiers: string[], claimClass = 'factual'): ExtractedClaim => ({
  text: 'test claim',
  anchor: { quote: 'test claim', prefix: '', suffix: '' },
  claimClass,
  identifiers
});

describe('matchClaim', () => {
  it('grounds a bare symbol name', () => {
    expect(matchClaim(claim(['greet']), index)).toEqual({ status: 'grounded' });
  });

  it('grounds decorated identifiers: backticks, call parens, generics', () => {
    expect(matchClaim(claim(['`greet()`']), index).status).toBe('grounded');
    expect(matchClaim(claim(['greet(options)']), index).status).toBe('grounded');
  });

  it('grounds a containerPath segment (class/module container)', () => {
    expect(matchClaim(claim(['Greeter']), index).status).toBe('grounded');
  });

  it('grounds a dotted path matching a containerPath-tail + name suffix', () => {
    expect(matchClaim(claim(['Greeter.send']), index).status).toBe('grounded');
    expect(matchClaim(claim(['src.greeter.greet']), index).status).toBe('grounded');
    expect(matchClaim(claim(['Greeter#send']), index).status).toBe('grounded');
  });

  it('rejects a dotted path whose halves exist but never as a real suffix', () => {
    // 'greeter' and 'send' both exist somewhere, but greet lives in src/greeter and send in Greeter.
    const match = matchClaim(claim(['greeter.send']), index);
    expect(match.status).toBe('defect');
  });

  it('reports a missing identifier as a stale-reference defect', () => {
    const match = matchClaim(claim(['removedFn']), index);
    expect(match).toEqual({
      status: 'defect',
      defects: [
        {
          kind: 'stale-reference',
          identifier: 'removedFn',
          reason: expect.stringContaining('does not exist in the codemap')
        }
      ]
    });
  });

  it('grounds a claim when ANY checkable identifier grounds (stragglers are not staleness)', () => {
    // Live-calibrated: claims name their anchor symbol plus incidental tokens; one grounded
    // identifier anchors the claim to real API.
    expect(matchClaim(claim(['greet', 'options.loud', 'name']), index).status).toBe('grounded');
  });

  it('emits defects only when EVERY checkable identifier fails to ground', () => {
    const match = matchClaim(claim(['removedFn', 'alsoGone']), index);
    expect(match).toMatchObject({
      status: 'defect',
      defects: [{ identifier: 'removedFn' }, { identifier: 'alsoGone' }]
    });
  });

  it('marks claims without identifiers unverifiable', () => {
    expect(matchClaim(claim([]), index).status).toBe('unverifiable');
  });

  it('never turns ambient globals into defects', () => {
    expect(matchClaim(claim(['Promise', 'string']), index).status).toBe('unverifiable');
  });

  it('never turns non-identifier tokens (flags, paths) into defects', () => {
    expect(matchClaim(claim(['--json']), index).status).toBe('unverifiable');
    expect(matchClaim(claim(['src/greeter.ts']), index).status).toBe('unverifiable');
  });
});

describe('normalizeIdentifier', () => {
  it('strips decorations and normalizes hash-paths', () => {
    expect(normalizeIdentifier('`greet()`')).toBe('greet');
    expect(normalizeIdentifier('Array<string>')).toBe('Array');
    expect(normalizeIdentifier('Greeter#send')).toBe('Greeter.send');
  });

  it('returns undefined for non-identifier shapes', () => {
    expect(normalizeIdentifier('--json')).toBeUndefined();
    expect(normalizeIdentifier('src/greeter.ts')).toBeUndefined();
    expect(normalizeIdentifier('https://example.com')).toBeUndefined();
    expect(normalizeIdentifier('')).toBeUndefined();
  });
});
