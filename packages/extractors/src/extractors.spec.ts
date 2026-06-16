import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  extractPythonApiReferencesWithGriffe,
  extractTypeScriptApiReferences,
  type ApiReferenceSymbol
} from './extractors';

const makeTempProject = async (): Promise<{ root: string; entry: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'docstube-extractors-'));
  const src = join(root, 'src');
  await mkdir(src, { recursive: true });
  const entry = join(src, 'toolkit.ts');
  await writeFile(
    entry,
    [
      '/** Adds two numbers. */',
      'export function add(left: number, right: number): number {',
      '  return left + right;',
      '}',
      '',
      '/** Toolkit options. */',
      'export type ToolkitOptions = { verbose: boolean };',
      '',
      'function internalOnly() {',
      '  return false;',
      '}'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, target: 'ESNext', module: 'ESNext' }, include: ['src/**/*.ts'] }),
    'utf8'
  );
  return { root, entry };
};

describe('API extractors', () => {
  it('extracts TypeScript API references through TypeDoc', async () => {
    const project = await makeTempProject();
    const result = await extractTypeScriptApiReferences({
      cwd: project.root,
      entryPoints: [project.entry],
      tsconfig: join(project.root, 'tsconfig.json')
    });

    expect(result.status).toBe('completed');
    expect(result.status === 'completed' ? result.source : null).toBe('typedoc');
    expect(result.status === 'completed' ? result.symbols.map((symbol) => symbol.name).toSorted() : []).toEqual([
      'ToolkitOptions',
      'add'
    ]);
    expect(result.status === 'completed' ? result.symbols.every((symbol) => symbol.source === 'typedoc') : false).toBe(
      true
    );
  });

  it('returns a structured griffe skip when the command is unavailable', async () => {
    const result = await extractPythonApiReferencesWithGriffe({
      moduleName: 'toolkit',
      searchPath: process.cwd(),
      pythonCommand: 'definitely-not-python'
    });

    expect(result).toEqual({ status: 'skipped', extractor: 'griffe', reason: 'Python griffe package is unavailable' });
  });

  it('can return explicit mock griffe fixture output when unavailable', async () => {
    const mockSymbol: ApiReferenceSymbol = {
      id: 'griffe:toolkit.py:build',
      name: 'build',
      kind: 'function',
      sourcePath: 'toolkit.py',
      line: 1,
      extractor: 'griffe',
      source: 'mock'
    };

    const result = await extractPythonApiReferencesWithGriffe({
      moduleName: 'toolkit',
      searchPath: process.cwd(),
      pythonCommand: 'definitely-not-python',
      mockSymbolsWhenUnavailable: [mockSymbol]
    });

    expect(result).toEqual({ status: 'completed', extractor: 'griffe', source: 'mock', symbols: [mockSymbol] });
  });
});
