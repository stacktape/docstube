import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSymbol, walkRepoFiles } from '@docstube/codemap';
import { sourceKeySchema, symbolRecordSchema } from '@docstube/contracts';
import type { SymbolRecord } from '@docstube/contracts';
import type { LanguagePackContext } from '@docstube/plugin-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractSymbols } from './extract-symbols.ts';

const repoRoot = fileURLToPath(new URL('../test-fixtures/sample-lib', import.meta.url));

const silentLogger = { info: () => {}, warn: () => {} };

const contextFor = async (root: string): Promise<LanguagePackContext> => ({
  repoRoot: root,
  files: await walkRepoFiles({ repoRoot: root, extensions: ['.ts', '.tsx', '.mts', '.cts'] }),
  readFile: (repoRelativePath) => readFile(join(root, repoRelativePath), 'utf8'),
  hashSymbol,
  logger: silentLogger
});

const virtualContext = (files: Record<string, string>): LanguagePackContext => ({
  repoRoot: '/virtual',
  files: Object.keys(files),
  readFile: async (repoRelativePath) => files[repoRelativePath] ?? '',
  hashSymbol,
  logger: silentLogger
});

let symbols: SymbolRecord[] = [];
const byName = (name: string): SymbolRecord | undefined => symbols.find((symbol) => symbol.name === name);

beforeAll(async () => {
  symbols = await extractSymbols(await contextFor(repoRoot));
});

describe('extractSymbols', () => {
  it('emits schema-valid records with sourceKey hashes', () => {
    expect(symbols.length).toBeGreaterThan(0);
    for (const symbol of symbols) {
      expect(() => symbolRecordSchema.parse(symbol)).not.toThrow();
      expect(() => sourceKeySchema.parse(symbol.hash)).not.toThrow();
      expect(symbol.hash.startsWith('ts:')).toBe(true);
      expect(symbol.span[1]).toBeGreaterThanOrEqual(symbol.span[0]);
    }
  });

  it('extracts an exported function with module-path containerPath and a JSDoc-free span', () => {
    const greet = byName('greet');
    expect(greet).toMatchObject({
      kind: 'function',
      containerPath: ['src', 'greeter'],
      file: 'src/greeter.ts',
      visibility: 'public'
    });
    expect(greet?.span).toEqual([4, 6]);
    expect(greet?.signature?.startsWith('export function greet(name: string)')).toBe(true);
  });

  it('does not emit non-exported helpers', () => {
    expect(byName('formatName')).toBeUndefined();
  });

  it('extracts a class plus its public members as child symbols', () => {
    expect(byName('Counter')).toMatchObject({ kind: 'class', containerPath: ['src', 'counter'] });
    expect(byName('increment')).toMatchObject({
      kind: 'method',
      containerPath: ['src', 'counter', 'Counter'],
      file: 'src/counter.ts'
    });
    expect(byName('count')).toMatchObject({ kind: 'property', containerPath: ['src', 'counter', 'Counter'] });
    expect(byName('increment')?.span).toEqual([7, 10]);
  });

  it('does not emit private class members', () => {
    expect(byName('step')).toBeUndefined();
    expect(byName('reset')).toBeUndefined();
  });

  it('extracts interfaces, type aliases, enums, and exported variables', () => {
    expect(byName('RetryOptions')).toMatchObject({ kind: 'interface', containerPath: ['src', 'types'] });
    expect(byName('RetryResult')).toMatchObject({ kind: 'type' });
    expect(byName('LogLevel')).toMatchObject({ kind: 'enum' });
    expect(byName('DEFAULT_RETRIES')).toMatchObject({ kind: 'variable' });
  });

  it('treats export-list exports as exported', () => {
    expect(byName('internalLimit')).toMatchObject({ kind: 'variable', containerPath: ['src', 'types'] });
  });

  it('keeps hashes stable under comment and whitespace edits', async () => {
    const original = await extractSymbols(
      virtualContext({ 'src/mod.ts': 'export function add(a: number, b: number): number {\n  return a + b;\n}\n' })
    );
    const reformatted = await extractSymbols(
      virtualContext({
        'src/mod.ts':
          '/** Adds two numbers. */\nexport function add(\n  a: number,\n  b: number\n): number {\n  // sum\n  return a + b;\n}\n'
      })
    );
    expect(reformatted[0]?.hash).toBe(original[0]?.hash);
  });

  it('changes the hash when the function is renamed', async () => {
    const original = await extractSymbols(
      virtualContext({ 'src/mod.ts': 'export function add(a: number, b: number): number {\n  return a + b;\n}\n' })
    );
    const renamed = await extractSymbols(
      virtualContext({ 'src/mod.ts': 'export function plus(a: number, b: number): number {\n  return a + b;\n}\n' })
    );
    expect(renamed[0]?.hash).not.toBe(original[0]?.hash);
  });

  it('skips declaration files', async () => {
    const records = await extractSymbols(
      virtualContext({ 'src/generated.d.ts': 'export declare function gen(): void;\n' })
    );
    expect(records).toEqual([]);
  });
});
