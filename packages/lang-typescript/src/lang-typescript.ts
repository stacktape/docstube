// Public API of @docstube/lang-typescript — the TypeScript language pack (ARCHITECTURE.md §7).
// The pack owns its extraction method (the TypeScript compiler API); symbol hashing and diffing
// stay kernel-owned in @docstube/codemap.

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { definePlugin } from '@docstube/plugin-sdk';
import type { LanguagePackDefinition } from '@docstube/plugin-sdk';
import { extractSymbols } from './extract-symbols.ts';
import { typecheckSnippet } from './snippet-typecheck.ts';

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  );

export const typescriptLanguagePack: LanguagePackDefinition = {
  id: 'typescript',
  displayName: 'TypeScript',
  fileExtensions: ['.ts', '.tsx', '.mts', '.cts'],
  detect: async (repoRoot) =>
    (await exists(join(repoRoot, 'tsconfig.json'))) || (await exists(join(repoRoot, 'package.json'))),
  extractSymbols,
  snippetToolchain: { typecheck: typecheckSnippet }
};

export { extractSymbols } from './extract-symbols.ts';
export { typecheckSnippet } from './snippet-typecheck.ts';

export default definePlugin({
  apiVersion: 1,
  name: '@docstube/lang-typescript',
  version: '0.0.1',
  description: 'TypeScript language pack: compiler-API symbol extraction and in-memory snippet typechecking.',
  capabilities: [{ kind: 'language-pack', ids: ['typescript'] }],
  register: (host) => {
    host.languagePack(typescriptLanguagePack);
  }
});
