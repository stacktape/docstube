import { describe, expect, it } from 'vitest';
import { cacheKeyFields, type CacheKeyInput, deriveCacheKey, sha256Schema } from './cache-key';

const hash = (char: string): string => char.repeat(64);

const baseInput: CacheKeyInput = {
  promptHash: hash('a'),
  inputHashes: [hash('b'), hash('c')],
  model: 'gpt-5-codex',
  adapterId: 'codex',
  adapterVersion: '1.2.3'
};

describe('sha256Schema', () => {
  it('accepts a 64-char lowercase hex digest', () => {
    expect(sha256Schema.parse(hash('a'))).toBe(hash('a'));
  });

  it('rejects uppercase, wrong length, and non-hex digests', () => {
    for (const bad of [hash('A'), 'abc', `${hash('a')}0`, 'not-a-hash']) {
      expect(sha256Schema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('deriveCacheKey', () => {
  it('is deterministic for identical inputs', () => {
    expect(deriveCacheKey(baseInput)).toBe(deriveCacheKey(baseInput));
  });

  it('produces a sha-256 hex digest', () => {
    expect(sha256Schema.safeParse(deriveCacheKey(baseInput)).success).toBe(true);
  });

  it('is independent of input-hash order', () => {
    const reordered: CacheKeyInput = { ...baseInput, inputHashes: [hash('c'), hash('b')] };
    expect(deriveCacheKey(reordered)).toBe(deriveCacheKey(baseInput));
  });

  it('changes when any contributing field changes', () => {
    const original = deriveCacheKey(baseInput);
    expect(deriveCacheKey({ ...baseInput, promptHash: hash('d') })).not.toBe(original);
    expect(deriveCacheKey({ ...baseInput, inputHashes: [hash('b')] })).not.toBe(original);
    expect(deriveCacheKey({ ...baseInput, model: 'other-model' })).not.toBe(original);
    expect(deriveCacheKey({ ...baseInput, adapterId: 'claude' })).not.toBe(original);
    expect(deriveCacheKey({ ...baseInput, adapterVersion: '1.2.4' })).not.toBe(original);
  });

  it('rejects malformed inputs', () => {
    expect(() => deriveCacheKey({ ...baseInput, promptHash: 'nope' })).toThrow(/lowercase hex SHA-256/);
  });

  it('documents the contributing fields', () => {
    expect([...cacheKeyFields]).toEqual(['adapterId', 'adapterVersion', 'inputHashes', 'model', 'promptHash']);
  });
});
