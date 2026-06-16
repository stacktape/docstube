import { describe, expect, it } from 'vitest';
import {
  buildSourceMap,
  detectCodemapLanguage,
  diffSourceMaps,
  normalizeSourceForHash,
  serializeSourceMap
} from './codemap.ts';

const tsFixture = [
  'export function keep(value: string) {',
  '  return value.trim();',
  '}',
  '',
  'export function changed(value: number) {',
  '  return value + 1;',
  '}'
].join('\n');

describe('codemap source maps', () => {
  it('detects tier-one languages and degrades unsupported files to file tracking', () => {
    expect(detectCodemapLanguage('src/toolkit.ts')).toBe('typescript');
    expect(detectCodemapLanguage('src/toolkit.py')).toBe('python');
    expect(detectCodemapLanguage('README.md')).toBe('unknown');

    const sourceMap = buildSourceMap([{ path: 'README.md', content: '# Project' }]);
    expect(sourceMap.symbols).toMatchObject([{ kind: 'file', language: 'unknown', filePath: 'README.md' }]);
  });

  it('normalizes hashes for TS/JS and Python fixtures', () => {
    expect(normalizeSourceForHash('export const value = 1; // comment\n', 'typescript')).toBe(
      'export const value = 1;'
    );
    expect(normalizeSourceForHash('def value():\n    return 1  # comment\n', 'python')).toBe('def value():\nreturn 1');
  });

  it('detects changed symbols without flagging unchanged symbols', () => {
    const before = buildSourceMap([{ path: 'src/toolkit.ts', content: tsFixture }]);
    const after = buildSourceMap([
      {
        path: 'src/toolkit.ts',
        content: tsFixture.replace('return value + 1;', 'return value + 2;')
      }
    ]);

    const diff = diffSourceMaps(before, after);
    expect(diff.changed).toEqual(['typescript:src/toolkit.ts:changed']);
    expect(diff.unchanged).toEqual(['typescript:src/toolkit.ts:keep']);
  });

  it('serializes stable source-map artifacts', () => {
    const sourceMap = buildSourceMap([
      { path: 'src/b.py', content: 'def beta():\n    return 2\n' },
      { path: 'src/a.ts', content: 'export const alpha = 1;\n' }
    ]);

    expect(serializeSourceMap(sourceMap)).toMatchSnapshot();
  });
});
