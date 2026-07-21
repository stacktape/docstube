import { describe, expect, it } from 'vitest';
import { fileFingerprintSchema, fingerprintSnapshotSchema, symbolFingerprintSchema } from './fingerprint-schema.ts';

const symbolHash = `ts:${'a'.repeat(64)}`;
const print = 'b'.repeat(64);

describe('symbol fingerprints', () => {
  it('round-trips a symbol fingerprint with named value prints', () => {
    const result = symbolFingerprintSchema.safeParse({
      symbolHash,
      signaturePrint: print,
      valuePrints: { attempts: print, timeoutMs: print },
      bodyPrint: print
    });
    expect(result.success).toBe(true);
    expect(result.data?.valuePrints['attempts']).toBe(print);
  });

  it('treats every print as optional-where-unavailable — a .d.ts symbol is signature-only', () => {
    const signatureOnly = symbolFingerprintSchema.parse({ symbolHash, signaturePrint: print });
    expect(signatureOnly.bodyPrint).toBeUndefined();
    expect(signatureOnly.valuePrints).toEqual({});
    // A symbol with no extractable facets still fingerprints (whole-file fallback covers change detection).
    expect(symbolFingerprintSchema.safeParse({ symbolHash }).success).toBe(true);
  });

  it('keeps the codemap sourceKey format for symbolHash', () => {
    // Not a bare sha — must be the namespaced `<lang>:<sha256>` codemap key.
    expect(symbolFingerprintSchema.safeParse({ symbolHash: print, signaturePrint: print }).success).toBe(false);
  });
});

describe('fingerprint snapshot', () => {
  it('accepts symbols plus whole-file fallbacks for unparsable files', () => {
    const result = fingerprintSnapshotSchema.safeParse({
      schemaVersion: 1,
      commit: 'a1b2c3d',
      symbols: [{ symbolHash, signaturePrint: print, bodyPrint: print }],
      unparsedFiles: [{ file: 'package.json', contentHash: print }]
    });
    expect(result.success).toBe(true);
  });

  it('rejects absolute paths in file fallbacks', () => {
    expect(fileFingerprintSchema.safeParse({ file: '/etc/passwd', contentHash: print }).success).toBe(false);
  });
});
