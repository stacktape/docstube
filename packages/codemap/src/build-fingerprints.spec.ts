import { fileURLToPath } from 'node:url';
import { contentHash, fingerprintSnapshotSchema, sha256Hex, symbolFingerprintSchema } from '@docstube/contracts';
import type { SymbolFingerprint } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import { buildFingerprintSnapshot, InvalidSymbolFingerprintError } from './build-fingerprints.ts';
import type { FingerprintCapablePack } from './build-fingerprints.ts';

const repoRoot = fileURLToPath(new URL('../test-fixtures/sample-repo', import.meta.url));

const silentLogger = { info: () => {}, warn: () => {} };

// A minimal fingerprint-capable pack: fingerprints alpha.txt, leaves beta.txt unparsed.
const fingerprintPack: FingerprintCapablePack = {
  id: 'fake',
  displayName: 'Fake',
  fileExtensions: ['.txt'],
  extractSymbols: async () => [],
  extractFingerprints: async (ctx) => {
    const file = 'src/alpha.txt';
    const content = (await ctx.readFile(file)).trim();
    const symbol = symbolFingerprintSchema.parse({
      symbolHash: ctx.hashSymbol({
        lang: 'fake',
        kind: 'module',
        containerPath: [file],
        normalizedDeclaration: content
      }),
      signaturePrint: sha256Hex(content),
      // Deliberately unsorted — the host must emit them byte-stably sorted.
      valuePrints: { 'alpha.zeta': sha256Hex('2'), 'alpha.beta': sha256Hex('1') },
      bodyPrint: sha256Hex(`${content}-body`)
    });
    return { symbols: [symbol], parsedFiles: [file] };
  }
};

const plainPack: FingerprintCapablePack = {
  id: 'plain',
  displayName: 'Plain',
  fileExtensions: ['.txt'],
  extractSymbols: async () => []
};

describe('buildFingerprintSnapshot', () => {
  it('combines pack fingerprints with whole-file fallbacks for everything not parsed', async () => {
    const snapshot = await buildFingerprintSnapshot({
      repoRoot,
      commit: 'abc1234',
      packs: [fingerprintPack],
      logger: silentLogger
    });
    expect(() => fingerprintSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.commit).toBe('abc1234');
    expect(snapshot.symbols).toHaveLength(1);
    expect(Object.keys(snapshot.symbols[0]?.valuePrints ?? {})).toEqual(['alpha.beta', 'alpha.zeta']);
    // alpha.txt was parsed; beta.txt falls back to a whole-file content hash.
    expect(snapshot.unparsedFiles.map((record) => record.file)).toEqual(['src/beta.txt']);
    expect(snapshot.unparsedFiles[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: two builds are byte-identical', async () => {
    const options = { repoRoot, commit: 'abc1234', packs: [fingerprintPack], logger: silentLogger };
    const first = await buildFingerprintSnapshot(options);
    const second = await buildFingerprintSnapshot(options);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('falls back to whole-file hashing for packs without fingerprint support — never less safe', async () => {
    const snapshot = await buildFingerprintSnapshot({
      repoRoot,
      commit: 'abc1234',
      packs: [plainPack],
      logger: silentLogger
    });
    expect(snapshot.symbols).toEqual([]);
    expect(snapshot.unparsedFiles.map((record) => record.file)).toEqual(['src/alpha.txt', 'src/beta.txt']);
  });

  it('hashes fallback files with the shared contentHash normalization', async () => {
    const snapshot = await buildFingerprintSnapshot({
      repoRoot,
      commit: 'abc1234',
      packs: [],
      logger: silentLogger
    });
    const alpha = snapshot.unparsedFiles.find((record) => record.file === 'src/alpha.txt');
    expect(alpha?.contentHash).toBe(contentHash('alpha declaration body\n'));
  });

  it('rejects invalid pack fingerprints loudly', async () => {
    const brokenPack: FingerprintCapablePack = {
      id: 'broken',
      displayName: 'Broken',
      fileExtensions: ['.txt'],
      extractSymbols: async () => [],
      extractFingerprints: async () => ({
        // Name-keyed id instead of a `<lang>:<sha256>` sourceKey — must be rejected.
        symbols: [{ symbolHash: 'fake:alpha', valuePrints: {} } as unknown as SymbolFingerprint],
        parsedFiles: []
      })
    };
    await expect(
      buildFingerprintSnapshot({ repoRoot, commit: 'abc1234', packs: [brokenPack], logger: silentLogger })
    ).rejects.toThrow(InvalidSymbolFingerprintError);
  });
});
