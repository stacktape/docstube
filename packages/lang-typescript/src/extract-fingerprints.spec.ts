import { diffFingerprints, hashSymbol } from '@docstube/codemap';
import type { FingerprintedCodemap } from '@docstube/codemap';
import { codemapSchema, fingerprintSnapshotSchema, symbolFingerprintSchema } from '@docstube/contracts';
import type { SymbolFingerprint } from '@docstube/contracts';
import type { LanguagePackContext } from '@docstube/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { extractFingerprints } from './extract-fingerprints.ts';
import { extractSymbols } from './extract-symbols.ts';

const silentLogger = { info: () => {}, warn: () => {} };

const virtualContext = (files: Record<string, string>): LanguagePackContext => ({
  repoRoot: '/virtual',
  files: Object.keys(files),
  readFile: async (repoRelativePath) => files[repoRelativePath] ?? '',
  hashSymbol,
  logger: silentLogger
});

const fingerprintByPath = async (
  files: Record<string, string>
): Promise<Map<string, SymbolFingerprint & { name: string }>> => {
  const ctx = virtualContext(files);
  const [records, result] = [await extractSymbols(ctx), await extractFingerprints(ctx)];
  const nameByHash = new Map(records.map((record) => [record.hash, record.name]));
  return new Map(
    result.symbols.map((symbol) => {
      const name = nameByHash.get(symbol.symbolHash) ?? symbol.symbolHash;
      return [name, { ...symbol, name }];
    })
  );
};

// Full before/after state for diffFingerprints, as core will assemble it.
const sideFor = async (files: Record<string, string>): Promise<FingerprintedCodemap> => {
  const ctx = virtualContext(files);
  return {
    codemap: codemapSchema.parse({ schemaVersion: 1, commit: 'abc1234', symbols: await extractSymbols(ctx) }),
    fingerprints: fingerprintSnapshotSchema.parse({
      schemaVersion: 1,
      commit: 'abc1234',
      symbols: (await extractFingerprints(ctx)).symbols,
      unparsedFiles: []
    })
  };
};

const clientSource = (body: string, timeoutDefault: string): string =>
  `export function createClient(host: string, timeout = ${timeoutDefault}): string {\n${body}\n}\n`;

describe('extractFingerprints', () => {
  it('emits schema-valid fingerprints whose hashes join the extracted symbol records', async () => {
    const ctx = virtualContext({
      'src/mod.ts':
        'export function add(a: number, b: number): number {\n  return a + b;\n}\nexport const LIMIT = 10;\n'
    });
    const records = await extractSymbols(ctx);
    const { symbols, parsedFiles } = await extractFingerprints(ctx);
    expect(parsedFiles).toEqual(['src/mod.ts']);
    expect(symbols.length).toBe(records.length);
    const recordHashes = new Set(records.map((record) => record.hash));
    for (const symbol of symbols) {
      expect(() => symbolFingerprintSchema.parse(symbol)).not.toThrow();
      expect(recordHashes.has(symbol.symbolHash)).toBe(true);
      expect(symbol.signaturePrint).toBeDefined();
    }
  });

  it('is deterministic: same input produces a byte-identical result', async () => {
    const files = {
      'src/mod.ts': 'export const retryDefaults = { maxAttempts: 3, backoff: { factor: 2 } };\n',
      'src/fn.ts': 'export function go(retries = 3): void {}\n'
    };
    const first = await extractFingerprints(virtualContext(files));
    const second = await extractFingerprints(virtualContext(files));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('keeps every print stable under reformatting and comment edits', async () => {
    const original = await fingerprintByPath({ 'src/mod.ts': clientSource('  return host;', '3000') });
    const reformatted = await fingerprintByPath({
      'src/mod.ts':
        '/** Creates a client. */\nexport function createClient(\n  host: string,\n  timeout = 3000\n): string {\n  // passthrough\n  return host;\n}\n'
    });
    expect(reformatted.get('createClient')).toEqual(original.get('createClient'));
  });

  it('moves only the bodyPrint on a body-only edit', async () => {
    const before = (await fingerprintByPath({ 'src/mod.ts': clientSource('  return host;', '3000') })).get(
      'createClient'
    );
    const after = (await fingerprintByPath({ 'src/mod.ts': clientSource('  return host.trim();', '3000') })).get(
      'createClient'
    );
    expect(after?.bodyPrint).not.toBe(before?.bodyPrint);
    expect(after?.signaturePrint).toBe(before?.signaturePrint);
    expect(after?.valuePrints).toEqual(before?.valuePrints);
  });

  it('moves exactly the default valuePrint on a default-value edit, and the diff names it', async () => {
    const before = await sideFor({ 'src/mod.ts': clientSource('  return host;', '3000') });
    const after = await sideFor({ 'src/mod.ts': clientSource('  return host;', '5000') });
    const beforePrint = before.fingerprints.symbols.find((s) => Object.keys(s.valuePrints).length > 0);
    const afterPrint = after.fingerprints.symbols.find((s) => Object.keys(s.valuePrints).length > 0);
    expect(beforePrint?.signaturePrint).toBe(afterPrint?.signaturePrint);
    expect(beforePrint?.valuePrints['createClient.param.timeout.default']).not.toBe(
      afterPrint?.valuePrints['createClient.param.timeout.default']
    );

    const diff = diffFingerprints(before, after);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]).toMatchObject({
      signatureChanged: false,
      changedValueNames: ['createClient.param.timeout.default'],
      addedValueNames: [],
      removedValueNames: [],
      bodyOnly: false
    });
  });

  it('reports a body-only edit as bodyOnly in the diff (the "regenerates 0 pages" case)', async () => {
    const before = await sideFor({ 'src/mod.ts': clientSource('  return host;', '3000') });
    const after = await sideFor({ 'src/mod.ts': clientSource('  return host.trim();', '3000') });
    const diff = diffFingerprints(before, after);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]).toMatchObject({ signatureChanged: false, bodyChanged: true, bodyOnly: true });
  });

  it('ignores object-literal key reordering in every print (identity re-mints, facets hold)', async () => {
    const source = 'export const retryDefaults = { maxAttempts: 3, backoff: { factor: 2, jitter: true } };\n';
    const reorderedSource = 'export const retryDefaults = { backoff: { jitter: true, factor: 2 }, maxAttempts: 3 };\n';
    const original = (await fingerprintByPath({ 'src/mod.ts': source })).get('retryDefaults');
    const reordered = (await fingerprintByPath({ 'src/mod.ts': reorderedSource })).get('retryDefaults');
    expect(reordered?.signaturePrint).toBe(original?.signaturePrint);
    expect(reordered?.valuePrints).toEqual(original?.valuePrints);
    expect(reordered?.bodyPrint).toBe(original?.bodyPrint);

    // The kernel symbolHash covers the raw declaration and re-mints; the diff pairs the two
    // hashes and reports a pure rekey — no facet changed, nothing to invalidate.
    const diff = diffFingerprints(
      await sideFor({ 'src/mod.ts': source }),
      await sideFor({ 'src/mod.ts': reorderedSource })
    );
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]).toMatchObject({
      signatureChanged: false,
      changedValueNames: [],
      addedValueNames: [],
      removedValueNames: [],
      bodyChanged: false,
      bodyOnly: false
    });
  });

  it('prints the same signature for export-modifier and export-list styles', async () => {
    const modifier = (await fingerprintByPath({ 'src/mod.ts': 'export function f(a: number): void {}\n' })).get('f');
    const list = (await fingerprintByPath({ 'src/mod.ts': 'function f(a: number): void {}\nexport { f };\n' })).get(
      'f'
    );
    expect(list?.signaturePrint).toBe(modifier?.signaturePrint);
  });

  it('keeps an arrow-const signature stable under body edits and captures its param defaults', async () => {
    const before = (
      await fingerprintByPath({
        'src/mod.ts': 'export const scale = (value: number, factor = 2): number => value * factor;\n'
      })
    ).get('scale');
    const after = (
      await fingerprintByPath({
        'src/mod.ts': 'export const scale = (value: number, factor = 2): number => factor * value;\n'
      })
    ).get('scale');
    expect(before?.valuePrints['scale.param.factor.default']).toBeDefined();
    expect(after?.signaturePrint).toBe(before?.signaturePrint);
    expect(after?.bodyPrint).not.toBe(before?.bodyPrint);
  });

  it('emits signature-only fingerprints for .d.ts files', async () => {
    const ctx = virtualContext({
      'src/generated.d.ts': 'export declare function gen(count?: number): void;\nexport declare const LIMIT: number;\n'
    });
    const { symbols, parsedFiles } = await extractFingerprints(ctx);
    expect(parsedFiles).toEqual(['src/generated.d.ts']);
    expect(symbols.length).toBeGreaterThan(0);
    for (const symbol of symbols) {
      expect(symbol.signaturePrint).toBeDefined();
      expect(symbol.valuePrints).toEqual({});
      expect(symbol.bodyPrint).toBeUndefined();
    }
  });

  it('leaves files with no exported declarations to the whole-file fallback', async () => {
    const { symbols, parsedFiles } = await extractFingerprints(
      virtualContext({ 'src/internal.ts': 'const helper = 1;\n' })
    );
    expect(symbols).toEqual([]);
    expect(parsedFiles).toEqual([]);
  });
});
