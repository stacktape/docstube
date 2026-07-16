import { fileURLToPath } from 'node:url';
import { codemapSchema, sourceKeySchema } from '@docstube/contracts';
import type { LanguagePackDefinition } from '@docstube/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { buildCodemap, InvalidSymbolRecordError } from './build-codemap.ts';

const repoRoot = fileURLToPath(new URL('../test-fixtures/sample-repo', import.meta.url));

const silentLogger = { info: () => {}, warn: () => {} };

// A minimal pack exercising the full LanguagePackContext surface without any parser.
const fakePack: LanguagePackDefinition = {
  id: 'fake',
  displayName: 'Fake',
  fileExtensions: ['.txt'],
  extractSymbols: (ctx) =>
    Promise.all(
      ctx.files.map(async (file) => {
        const normalizedDeclaration = (await ctx.readFile(file)).trim();
        return {
          hash: ctx.hashSymbol({ lang: 'fake', kind: 'module', containerPath: [file], normalizedDeclaration }),
          lang: 'fake',
          kind: 'module',
          name: file,
          containerPath: [file],
          file,
          span: [1, 1] as [number, number],
          visibility: 'public' as const,
          signature: normalizedDeclaration,
          project: '.'
        };
      })
    )
};

const brokenPack: LanguagePackDefinition = {
  id: 'broken',
  displayName: 'Broken',
  fileExtensions: ['.txt'],
  // Name-keyed id instead of a sourceKey hash — must be rejected by record validation.
  extractSymbols: async (ctx) =>
    ctx.files.map((file) => ({
      hash: `fake:${file}`,
      lang: 'fake',
      kind: 'module',
      name: file,
      containerPath: [file],
      file,
      span: [1, 1] as [number, number],
      visibility: 'public' as const,
      project: '.'
    }))
};

describe('buildCodemap', () => {
  it('aggregates validated pack output into a schema-valid codemap', async () => {
    const codemap = await buildCodemap({ repoRoot, commit: 'abc1234', packs: [fakePack], logger: silentLogger });
    expect(() => codemapSchema.parse(codemap)).not.toThrow();
    expect(codemap.commit).toBe('abc1234');
    expect(codemap.symbols.map((symbol) => symbol.file)).toEqual(['src/alpha.txt', 'src/beta.txt']);
    expect(codemap.symbols[0]?.signature).toBe('alpha declaration body');
    for (const symbol of codemap.symbols) {
      expect(() => sourceKeySchema.parse(symbol.hash)).not.toThrow();
    }
  });

  it('applies the project option to every record', async () => {
    const codemap = await buildCodemap({
      repoRoot,
      commit: 'abc1234',
      packs: [fakePack],
      project: 'packages/api',
      logger: silentLogger
    });
    expect(codemap.symbols.every((symbol) => symbol.project === 'packages/api')).toBe(true);
  });

  it('respects the ignore list', async () => {
    const codemap = await buildCodemap({
      repoRoot,
      commit: 'abc1234',
      packs: [fakePack],
      ignore: ['src/beta.txt'],
      logger: silentLogger
    });
    expect(codemap.symbols.map((symbol) => symbol.file)).toEqual(['src/alpha.txt']);
  });

  it('rejects invalid records with a typed error naming the pack', async () => {
    await expect(
      buildCodemap({ repoRoot, commit: 'abc1234', packs: [brokenPack], logger: silentLogger })
    ).rejects.toThrow(InvalidSymbolRecordError);
    await expect(
      buildCodemap({ repoRoot, commit: 'abc1234', packs: [brokenPack], logger: silentLogger })
    ).rejects.toThrow(/broken/);
  });
});
