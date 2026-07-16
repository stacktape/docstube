import { codemapSchema, symbolRecordSchema } from '@docstube/contracts';
import type { Codemap, SymbolRecord } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import { diffSymbols } from './diff-symbols.ts';
import { hashSymbol, normalizeDeclaration } from './symbol-hash.ts';

type SymbolSpec = {
  kind?: string;
  name: string;
  containerPath?: string[];
  declaration: string;
  file?: string;
};

const makeSymbol = (spec: SymbolSpec): SymbolRecord => {
  const kind = spec.kind ?? 'function';
  const containerPath = spec.containerPath ?? ['src', 'lib'];
  const normalizedDeclaration = normalizeDeclaration(spec.declaration);
  return symbolRecordSchema.parse({
    hash: hashSymbol({ lang: 'ts', kind, containerPath, normalizedDeclaration }),
    lang: 'ts',
    kind,
    name: spec.name,
    containerPath,
    file: spec.file ?? 'src/lib.ts',
    span: [1, 3],
    visibility: 'public'
  });
};

const makeCodemap = (symbols: SymbolRecord[]): Codemap =>
  codemapSchema.parse({ schemaVersion: 1, commit: 'abc1234', symbols });

const greet = makeSymbol({ name: 'greet', declaration: 'export function greet(name: string) { return name; }' });
const wave = makeSymbol({ name: 'wave', declaration: 'export function wave() { return "wave"; }' });

describe('diffSymbols', () => {
  it('counts identical hashes as unchanged', () => {
    const diff = diffSymbols(makeCodemap([greet, wave]), makeCodemap([greet, wave]));
    expect(diff).toEqual({ added: [], removed: [], changed: [], unchangedCount: 2 });
  });

  it('reports new symbols as added', () => {
    const diff = diffSymbols(makeCodemap([greet]), makeCodemap([greet, wave]));
    expect(diff.added).toEqual([wave]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it('reports deleted symbols as removed', () => {
    const diff = diffSymbols(makeCodemap([greet, wave]), makeCodemap([wave]));
    expect(diff.removed).toEqual([greet]);
    expect(diff.added).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it('reports a body change under the same identity as changed', () => {
    const greetLoud = makeSymbol({
      name: 'greet',
      declaration: 'export function greet(name: string) { return name.toUpperCase(); }'
    });
    const diff = diffSymbols(makeCodemap([greet, wave]), makeCodemap([greetLoud, wave]));
    expect(diff.changed).toEqual([{ before: greet, after: greetLoud }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it('reports a pure rename as removed + added, never changed', () => {
    const salute = makeSymbol({ name: 'salute', declaration: 'export function salute(name: string) { return name; }' });
    const diff = diffSymbols(makeCodemap([greet]), makeCodemap([salute]));
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([greet]);
    expect(diff.added).toEqual([salute]);
    expect(diff.unchangedCount).toBe(0);
  });

  it('does not pair symbols across different kinds or container paths', () => {
    const greetMethod = makeSymbol({
      kind: 'method',
      name: 'greet',
      containerPath: ['src', 'lib', 'Greeter'],
      declaration: 'greet(name: string) { return name; }'
    });
    const diff = diffSymbols(makeCodemap([greet]), makeCodemap([greetMethod]));
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([greet]);
    expect(diff.added).toEqual([greetMethod]);
  });

  it('handles empty codemaps', () => {
    const diff = diffSymbols(makeCodemap([]), makeCodemap([greet]));
    expect(diff.added).toEqual([greet]);
    expect(diff.unchangedCount).toBe(0);
  });
});
