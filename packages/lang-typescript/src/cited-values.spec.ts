import { describe, expect, it } from 'vitest';
import { extractCitedValues } from './cited-values.ts';

const valuesOf = (content: string, symbol?: string): Record<string, string> =>
  extractCitedValues(symbol === undefined ? { file: 'src/mod.ts', content } : { file: 'src/mod.ts', content, symbol });

describe('extractCitedValues', () => {
  it('extracts exported const primitives under the bare const name', () => {
    expect(valuesOf('export const DEFAULT_RETRIES = 3;\n')).toEqual({ DEFAULT_RETRIES: '3' });
  });

  it('normalizes quote styles and numeric spellings to one canonical form', () => {
    expect(valuesOf("export const MODE = 'fast';\n")).toEqual(valuesOf('export const MODE = "fast";\n'));
    expect(valuesOf('export const MODE = `fast`;\n')).toEqual({ MODE: '"fast"' });
    expect(valuesOf('export const MAX = 1_000;\n')).toEqual({ MAX: '1000' });
    expect(valuesOf('export const MAX = 1e3;\n')).toEqual({ MAX: '1000' });
  });

  it('walks exported object-literal consts into dot paths, insensitive to key order', () => {
    const values = valuesOf('export const retryDefaults = { maxAttempts: 3, backoff: { factor: 2, jitter: true } };\n');
    expect(values).toEqual({
      'retryDefaults.backoff.factor': '2',
      'retryDefaults.backoff.jitter': 'true',
      'retryDefaults.maxAttempts': '3'
    });
    expect(
      valuesOf('export const retryDefaults = { backoff: { jitter: true, factor: 2 }, maxAttempts: 3 };\n')
    ).toEqual(values);
  });

  it('sees through as-const and satisfies wrappers', () => {
    expect(valuesOf('export const cfg = { port: 8080 } as const;\n')).toEqual({ 'cfg.port': '8080' });
  });

  it('extracts enum member values, explicit and auto-incremented', () => {
    expect(valuesOf('export enum LogLevel {\n  Debug,\n  Info,\n  Error = 10,\n  Fatal\n}\n')).toEqual({
      'LogLevel.Debug': '0',
      'LogLevel.Error': '10',
      'LogLevel.Fatal': '11',
      'LogLevel.Info': '1'
    });
    expect(valuesOf("export enum Mode {\n  Fast = 'fast',\n  Slow = 'slow'\n}\n")).toEqual({
      'Mode.Fast': '"fast"',
      'Mode.Slow': '"slow"'
    });
  });

  it('extracts default parameter values for functions, arrow consts, and class methods', () => {
    expect(valuesOf('export function createClient(host: string, timeout = 3000): void {}\n')).toEqual({
      'createClient.param.timeout.default': '3000'
    });
    expect(valuesOf('export const scale = (value: number, factor = 2): number => value * factor;\n')).toEqual({
      'scale.param.factor.default': '2'
    });
    expect(valuesOf('export class Client {\n  connect(timeout = 3000): void {}\n}\n')).toEqual({
      'Client.connect.param.timeout.default': '3000'
    });
  });

  it('skips values that would require evaluation', () => {
    const values = valuesOf(
      [
        'const base = 10;',
        'export const derived = base * 2;',
        'export const fromCall = compute();',
        'export const aliased = base;',
        'export const mixed = { literal: 1, spread: { ...base }, computed: base + 1 };',
        'export function f(x = compute()): void {}'
      ].join('\n')
    );
    expect(values).toEqual({ 'mixed.literal': '1' });
  });

  it('skips non-exported declarations', () => {
    expect(valuesOf('const internal = 3;\n')).toEqual({});
  });

  it('filters to one symbol path when asked', () => {
    const content = 'export const a = 1;\nexport const cfg = { max: 2 };\nexport function f(n = 3): void {}\n';
    expect(valuesOf(content, 'cfg')).toEqual({ 'cfg.max': '2' });
    expect(valuesOf(content, 'f')).toEqual({ 'f.param.n.default': '3' });
  });

  it('returns keys in sorted order for deterministic comparison', () => {
    const values = valuesOf('export const cfg = { zeta: 1, alpha: 2 };\n');
    expect(Object.keys(values)).toEqual(['cfg.alpha', 'cfg.zeta']);
  });
});
