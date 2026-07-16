import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSymbol, walkRepoFiles } from '@docstube/codemap';
import { sourceKeySchema, symbolRecordSchema } from '@docstube/contracts';
import type { SymbolRecord } from '@docstube/contracts';
import type { LanguagePackContext } from '@docstube/plugin-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractSymbols } from './extract-symbols.ts';
import { resolvePythonInterpreter } from './python-interpreter.ts';

const repoRoot = fileURLToPath(new URL('../test-fixtures/sample-lib', import.meta.url));

const silentLogger = { info: () => {}, warn: () => {} };

// The suite spawns the real python interpreter (the pack's doctor-check contract: documenting a
// Python repo implies python is installed). Hosts without one skip instead of failing.
const pythonInterpreter = await resolvePythonInterpreter();
if (pythonInterpreter === undefined) {
  console.warn('lang-python extract-symbols specs skipped: no python interpreter found on PATH');
}

const contextFor = async (root: string, warnings?: string[]): Promise<LanguagePackContext> => ({
  repoRoot: root,
  files: await walkRepoFiles({ repoRoot: root, extensions: ['.py'] }),
  readFile: (repoRelativePath) => readFile(join(root, repoRelativePath), 'utf8'),
  hashSymbol,
  logger: warnings === undefined ? silentLogger : { info: () => {}, warn: (message) => warnings.push(message) }
});

const classHash = (records: SymbolRecord[]): string | undefined => records.find((r) => r.kind === 'class')?.hash;
const methodHash = (records: SymbolRecord[]): string | undefined => records.find((r) => r.kind === 'method')?.hash;

// Writes inline sources into a temp dir and extracts from it (for hash-behavior comparisons).
const extractFrom = async (files: Record<string, string>): Promise<SymbolRecord[]> => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-lang-python-'));
  try {
    await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(dir, name), content, 'utf8')));
    return await extractSymbols({
      repoRoot: dir,
      files: Object.keys(files),
      readFile: (repoRelativePath) => readFile(join(dir, repoRelativePath), 'utf8'),
      hashSymbol,
      logger: silentLogger
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const widgetClass = (input: { initSignature?: string; methodSignature?: string; methodBody?: string }): string => {
  const constructorLine = input.initSignature ?? 'def __init__(self, size: int) -> None';
  const methodSignature = input.methodSignature ?? 'def resize(self, size: int) -> int';
  const methodBody = input.methodBody ?? 'return size';
  return `class Widget:\n    ${constructorLine}:\n        self.size = size\n\n    ${methodSignature}:\n        ${methodBody}\n`;
};

describe('extractSymbols without matching files', () => {
  it('returns no records and never needs an interpreter', async () => {
    const records = await extractSymbols({
      repoRoot: '/nowhere',
      files: [],
      readFile: async () => '',
      hashSymbol,
      logger: silentLogger
    });
    expect(records).toEqual([]);
  });
});

describe.skipIf(pythonInterpreter === undefined)('extractSymbols', () => {
  let symbols: SymbolRecord[] = [];
  const warnings: string[] = [];
  const byName = (name: string): SymbolRecord | undefined => symbols.find((symbol) => symbol.name === name);

  beforeAll(async () => {
    symbols = await extractSymbols(await contextFor(repoRoot, warnings));
  });

  it('emits schema-valid records with py-prefixed sourceKey hashes', () => {
    expect(symbols.length).toBeGreaterThan(0);
    for (const symbol of symbols) {
      expect(() => symbolRecordSchema.parse(symbol)).not.toThrow();
      expect(() => sourceKeySchema.parse(symbol.hash)).not.toThrow();
      expect(symbol.hash.startsWith('py:')).toBe(true);
      expect(symbol.span[1]).toBeGreaterThanOrEqual(symbol.span[0]);
    }
  });

  it('extracts a public function with module-path containerPath and a signature-shaped signature', () => {
    const greet = byName('greet');
    expect(greet).toMatchObject({
      kind: 'function',
      containerPath: ['src', 'greeter'],
      file: 'src/greeter.py',
      visibility: 'public'
    });
    expect(greet?.span).toEqual([6, 8]);
    expect(greet?.signature?.startsWith('def greet(name: str')).toBe(true);
  });

  it('extracts async functions with the async prefix in the signature', () => {
    const fetchGreeting = byName('fetch_greeting');
    expect(fetchGreeting).toMatchObject({ kind: 'function', containerPath: ['src', 'greeter'] });
    expect(fetchGreeting?.signature?.startsWith('async def fetch_greeting(')).toBe(true);
  });

  it('does not emit underscore-private module helpers', () => {
    expect(byName('_format_name')).toBeUndefined();
  });

  it('extracts a class plus its public methods as child symbols', () => {
    expect(byName('Counter')).toMatchObject({ kind: 'class', containerPath: ['src', 'counter'] });
    expect(byName('increment')).toMatchObject({
      kind: 'method',
      containerPath: ['src', 'counter', 'Counter'],
      file: 'src/counter.py'
    });
    expect(byName('increment')?.span).toEqual([8, 11]);
  });

  it('keeps decorators in method signatures', () => {
    expect(byName('is_positive')?.signature).toContain('@property');
  });

  it('folds __init__ into the class instead of emitting it as a method', () => {
    expect(byName('__init__')).toBeUndefined();
  });

  it('does not emit underscore-private methods', () => {
    expect(byName('_reset')).toBeUndefined();
  });

  it('extracts ALL_CAPS module constants as variables', () => {
    expect(byName('DEFAULT_GREETING')).toMatchObject({ kind: 'variable', containerPath: ['src', 'greeter'] });
    expect(byName('MAX_LENGTH')).toMatchObject({ kind: 'variable', containerPath: ['src', 'utils', 'text'] });
  });

  it('drops the __init__ segment from package-module containerPaths', () => {
    expect(byName('slugify')).toMatchObject({ containerPath: ['src', 'utils'], file: 'src/utils/__init__.py' });
  });

  it('uses full module segments for submodules', () => {
    expect(byName('truncate')).toMatchObject({ containerPath: ['src', 'utils', 'text'] });
  });

  it('reports the broken fixture file as a warning without failing the batch', () => {
    expect(warnings.some((message) => message.includes('src/broken_example.py'))).toBe(true);
    expect(symbols.some((symbol) => symbol.file === 'src/broken_example.py')).toBe(false);
  });

  it('keeps class and method hashes stable when only a method body changes', async () => {
    const original = await extractFrom({ 'mod.py': widgetClass({}) });
    const editedBody = await extractFrom({ 'mod.py': widgetClass({ methodBody: 'return size * 2' }) });
    expect(classHash(editedBody)).toBe(classHash(original));
    expect(methodHash(editedBody)).toBe(methodHash(original));
  });

  it('changes class and method hashes when a public method signature changes', async () => {
    const original = await extractFrom({ 'mod.py': widgetClass({}) });
    const editedSignature = await extractFrom({
      'mod.py': widgetClass({ methodSignature: 'def resize(self, size: int, animate: bool = False) -> int' })
    });
    expect(classHash(editedSignature)).not.toBe(classHash(original));
    expect(methodHash(editedSignature)).not.toBe(methodHash(original));
  });

  it('changes the class hash when the constructor signature changes', async () => {
    const original = await extractFrom({ 'mod.py': widgetClass({}) });
    const editedConstructor = await extractFrom({
      'mod.py': widgetClass({ initSignature: 'def __init__(self, size: int, name: str = "widget") -> None' })
    });
    expect(classHash(editedConstructor)).not.toBe(classHash(original));
  });

  it('keeps hashes stable under docstring and formatting edits', async () => {
    const original = await extractFrom({ 'mod.py': 'def add(a: int, b: int) -> int:\n    return a + b\n' });
    const reformatted = await extractFrom({
      'mod.py':
        '# helper\ndef add(\n    a: int,\n    b: int,\n) -> int:\n    """Adds two numbers."""\n    return a + b\n'
    });
    expect(reformatted[0]?.hash).toBe(original[0]?.hash);
  });

  it('changes the hash when a function is renamed', async () => {
    const original = await extractFrom({ 'mod.py': 'def add(a: int, b: int) -> int:\n    return a + b\n' });
    const renamed = await extractFrom({ 'mod.py': 'def plus(a: int, b: int) -> int:\n    return a + b\n' });
    expect(renamed[0]?.hash).not.toBe(original[0]?.hash);
  });
});
