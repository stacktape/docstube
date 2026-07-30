import { fingerprintSnapshotSchema, sha256Hex } from '@docstube/contracts';
import type { FingerprintSnapshot } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import { materialFingerprint, materialFingerprintIndex } from './material-fingerprint.ts';

const hashOf = (seed: string): string => `fake:${sha256Hex(seed)}`;
const printOf = (seed: string): string => sha256Hex(`print:${seed}`);

type SymbolSpec = { hash: string; signature?: string; values?: Record<string, string>; body?: string };

const snapshotOf = (symbols: SymbolSpec[]): FingerprintSnapshot =>
  fingerprintSnapshotSchema.parse({
    schemaVersion: 1,
    commit: 'abc1234',
    symbols: symbols.map((spec) => ({
      symbolHash: spec.hash,
      ...(spec.signature === undefined ? {} : { signaturePrint: printOf(spec.signature) }),
      valuePrints: Object.fromEntries(Object.entries(spec.values ?? {}).map(([name, seed]) => [name, printOf(seed)])),
      ...(spec.body === undefined ? {} : { bodyPrint: printOf(spec.body) })
    }))
  });

const fingerprintFor = (snapshot: FingerprintSnapshot, hash: string) =>
  snapshot.symbols.find((symbol) => symbol.symbolHash === hash);

describe('materialFingerprint', () => {
  it('ignores the body facet — a cosmetic refactor keeps the material fingerprint stable', () => {
    // Same symbol before/after a body-only edit: the declaration re-hashes, the signature does not.
    const before = snapshotOf([{ hash: hashOf('greet@v1'), signature: 'greet(name: string): string', body: 'v1' }]);
    const after = snapshotOf([{ hash: hashOf('greet@v2'), signature: 'greet(name: string): string', body: 'v2' }]);
    expect(materialFingerprint(hashOf('greet@v1'), fingerprintFor(before, hashOf('greet@v1')))).toBe(
      materialFingerprint(hashOf('greet@v2'), fingerprintFor(after, hashOf('greet@v2')))
    );
  });

  it('changes when the signature, a cited value, or the schema shape changes', () => {
    const base = snapshotOf([{ hash: hashOf('a'), signature: 'sig', values: { retries: '3' } }]);
    const signatureChanged = snapshotOf([{ hash: hashOf('a'), signature: 'sig2', values: { retries: '3' } }]);
    const valueChanged = snapshotOf([{ hash: hashOf('a'), signature: 'sig', values: { retries: '5' } }]);
    const material = materialFingerprint(hashOf('a'), fingerprintFor(base, hashOf('a')));
    expect(materialFingerprint(hashOf('a'), fingerprintFor(signatureChanged, hashOf('a')))).not.toBe(material);
    expect(materialFingerprint(hashOf('a'), fingerprintFor(valueChanged, hashOf('a')))).not.toBe(material);
  });

  it('falls back to the symbol hash when a pack emits no material facets', () => {
    // No facets ⇒ whole-declaration invalidation, and never a shared key across symbols.
    expect(materialFingerprint(hashOf('x'), undefined)).not.toBe(materialFingerprint(hashOf('y'), undefined));
    const bodyOnly = snapshotOf([{ hash: hashOf('x'), body: 'v1' }]);
    expect(materialFingerprint(hashOf('x'), fingerprintFor(bodyOnly, hashOf('x')))).toBe(
      materialFingerprint(hashOf('x'), undefined)
    );
  });
});

describe('materialFingerprintIndex', () => {
  it('buckets symbols by material fingerprint so ambiguity is visible to callers', () => {
    const snapshot = snapshotOf([
      { hash: hashOf('one'), signature: 'shared' },
      { hash: hashOf('two'), signature: 'shared' },
      { hash: hashOf('three'), signature: 'unique' }
    ]);
    const index = materialFingerprintIndex(snapshot);
    const shared = index.get(materialFingerprint(hashOf('one'), fingerprintFor(snapshot, hashOf('one'))));
    expect(shared).toEqual([hashOf('one'), hashOf('two')]);
    expect(index.get(materialFingerprint(hashOf('three'), fingerprintFor(snapshot, hashOf('three'))))).toEqual([
      hashOf('three')
    ]);
  });
});
