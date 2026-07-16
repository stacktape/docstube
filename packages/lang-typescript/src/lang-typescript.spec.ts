import { fileURLToPath } from 'node:url';
import { buildCodemap } from '@docstube/codemap';
import { codemapSchema } from '@docstube/contracts';
import { isDocstubePlugin } from '@docstube/plugin-sdk';
import type { LanguagePackDefinition, PluginRegistrationHost } from '@docstube/plugin-sdk';
import { describe, expect, it } from 'vitest';
import langTypescriptPlugin, { typescriptLanguagePack } from './lang-typescript.ts';

const repoRoot = fileURLToPath(new URL('../test-fixtures/sample-lib', import.meta.url));

const silentLogger = { info: () => {}, warn: () => {} };

describe('typescriptLanguagePack', () => {
  it('builds a schema-valid codemap end-to-end over the fixture lib', async () => {
    const codemap = await buildCodemap({
      repoRoot,
      commit: 'abc1234',
      packs: [typescriptLanguagePack],
      logger: silentLogger
    });
    expect(() => codemapSchema.parse(codemap)).not.toThrow();
    const names = codemap.symbols.map((symbol) => symbol.name);
    expect(names).toContain('greet');
    expect(names).toContain('Counter');
    expect(names).toContain('increment');
    expect(names).toContain('RetryOptions');
    expect(names).not.toContain('formatName');
    expect(codemap.symbols.every((symbol) => symbol.hash.startsWith('ts:'))).toBe(true);
  });

  it('detects a TypeScript-ish repo via package.json or tsconfig.json', async () => {
    expect(await typescriptLanguagePack.detect?.(repoRoot)).toBe(true);
  });

  it('exposes a snippet typecheck toolchain', () => {
    expect(typeof typescriptLanguagePack.snippetToolchain?.typecheck).toBe('function');
  });
});

describe('default plugin export', () => {
  it('is a docstube plugin declaring the language-pack capability', () => {
    expect(isDocstubePlugin(langTypescriptPlugin)).toBe(true);
    expect(langTypescriptPlugin.manifest.name).toBe('@docstube/lang-typescript');
    expect(langTypescriptPlugin.manifest.capabilities).toEqual([{ kind: 'language-pack', ids: ['typescript'] }]);
  });

  it('registers the typescript language pack with the host', async () => {
    const registered: LanguagePackDefinition[] = [];
    const host = { languagePack: (definition: LanguagePackDefinition) => registered.push(definition) };
    await langTypescriptPlugin.register(host as unknown as PluginRegistrationHost);
    expect(registered).toEqual([typescriptLanguagePack]);
  });
});
