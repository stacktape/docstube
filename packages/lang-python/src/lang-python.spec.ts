import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCodemap } from '@docstube/codemap';
import { codemapSchema } from '@docstube/contracts';
import { isDocstubePlugin } from '@docstube/plugin-sdk';
import type { LanguagePackDefinition, PluginRegistrationHost } from '@docstube/plugin-sdk';
import { describe, expect, it } from 'vitest';
import langPythonPlugin, { pythonLanguagePack, resolvePythonInterpreter } from './lang-python.ts';

const repoRoot = fileURLToPath(new URL('../test-fixtures/sample-lib', import.meta.url));

const silentLogger = { info: () => {}, warn: () => {} };

const pythonInterpreter = await resolvePythonInterpreter();
if (pythonInterpreter === undefined) {
  console.warn('lang-python end-to-end specs skipped: no python interpreter found on PATH');
}

describe.skipIf(pythonInterpreter === undefined)('pythonLanguagePack end-to-end', () => {
  it('builds a schema-valid codemap over the fixture lib despite the broken file', async () => {
    const codemap = await buildCodemap({
      repoRoot,
      commit: 'abc1234',
      packs: [pythonLanguagePack],
      logger: silentLogger
    });
    expect(() => codemapSchema.parse(codemap)).not.toThrow();
    const names = codemap.symbols.map((symbol) => symbol.name);
    expect(names).toContain('greet');
    expect(names).toContain('Counter');
    expect(names).toContain('increment');
    expect(names).toContain('DEFAULT_GREETING');
    expect(names).not.toContain('_format_name');
    expect(names).not.toContain('__init__');
    expect(codemap.symbols.every((symbol) => symbol.hash.startsWith('py:'))).toBe(true);
  });
});

describe('pythonLanguagePack definition', () => {
  it('detects a Python repo via pyproject.toml, setup.py, or requirements.txt', async () => {
    expect(await pythonLanguagePack.detect?.(repoRoot)).toBe(true);
    const emptyDir = await mkdtemp(join(tmpdir(), 'docstube-lang-python-detect-'));
    try {
      expect(await pythonLanguagePack.detect?.(emptyDir)).toBe(false);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('exposes a snippet run toolchain and no typecheck (pyright is optional tooling)', () => {
    expect(typeof pythonLanguagePack.snippetToolchain?.run).toBe('function');
    expect(pythonLanguagePack.snippetToolchain?.typecheck).toBeUndefined();
  });

  it('matches only .py files', () => {
    expect(pythonLanguagePack.fileExtensions).toEqual(['.py']);
  });
});

describe('default plugin export', () => {
  it('is a docstube plugin declaring the language-pack capability and interpreter exec permission', () => {
    expect(isDocstubePlugin(langPythonPlugin)).toBe(true);
    expect(langPythonPlugin.manifest.name).toBe('@docstube/lang-python');
    expect(langPythonPlugin.manifest.capabilities).toEqual([{ kind: 'language-pack', ids: ['python'] }]);
    expect(langPythonPlugin.manifest.permissions.exec).toEqual(['python', 'python3']);
  });

  it('registers the python language pack with the host', async () => {
    const registered: LanguagePackDefinition[] = [];
    const host = { languagePack: (definition: LanguagePackDefinition) => registered.push(definition) };
    await langPythonPlugin.register(host as unknown as PluginRegistrationHost);
    expect(registered).toEqual([pythonLanguagePack]);
  });
});
