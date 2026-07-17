import { describe, expect, it } from 'vitest';
import { failureModeCodes, toFailureModeCode } from './failure-modes.ts';

describe('failure-mode registry', () => {
  it('maps known finding checks to registry codes', () => {
    expect(toFailureModeCode({ check: 'code-typecheck-ts' })).toBe('verify.typecheck-failed');
    expect(toFailureModeCode({ check: 'snippet-exec' })).toBe('verify.snippet-failed');
    expect(toFailureModeCode({ check: 'internal-links' })).toBe('verify.links-broken');
    expect(toFailureModeCode({ check: 'mdx-compile' })).toBe('verify.mdx-compile-failed');
    expect(toFailureModeCode({ check: 'diagram-d2' })).toBe('verify.d2-failed');
    expect(toFailureModeCode({ check: 'claim-grounding' })).toBe('claims.ungrounded');
    expect(toFailureModeCode({ check: 'review-error' })).toBe('review.error');
    expect(toFailureModeCode({ check: 'translation-structure' })).toBe('translate.structure-mismatch');
  });

  it('maps flag kinds and error kinds', () => {
    expect(toFailureModeCode({ flagKind: 'system' })).toBe('gate.exhausted');
    expect(toFailureModeCode({ errorKind: 'rate-limited' })).toBe('transport.rate-limited');
    expect(toFailureModeCode({ errorKind: 'timeout' })).toBe('transport.timeout');
    expect(toFailureModeCode({ errorKind: 'frozen-budget' })).toBe('run.frozen-budget');
  });

  it("NEVER passes arbitrary strings through — anything unknown becomes 'other'", () => {
    expect(toFailureModeCode({ check: 'src/secret-file.ts leaked' })).toBe('other');
    expect(toFailureModeCode({ flagKind: 'tribal-knowledge' })).toBe('other');
    expect(toFailureModeCode({ errorKind: 'C:/Users/someone/private' })).toBe('other');
    expect(toFailureModeCode({})).toBe('other');
  });

  it('every mapped output is a registry code', () => {
    const codes: string[] = [...failureModeCodes];
    for (const probe of ['code-typecheck-ts', 'nonsense', 'internal-links']) {
      expect(codes).toContain(toFailureModeCode({ check: probe }));
    }
  });
});
