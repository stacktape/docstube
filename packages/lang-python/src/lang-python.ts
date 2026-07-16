// Public API of @docstube/lang-python — the Python language pack (ARCHITECTURE.md §7).
// The pack owns its extraction method (Python's own `ast` module, run as a subprocess — see
// src/python-inspector.py); symbol hashing and diffing stay kernel-owned in @docstube/codemap.

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { definePlugin } from '@docstube/plugin-sdk';
import type { LanguagePackDefinition } from '@docstube/plugin-sdk';
import { extractSymbols } from './extract-symbols.ts';
import { runSnippet } from './snippet-run.ts';

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  );

const detectionManifests = ['pyproject.toml', 'setup.py', 'requirements.txt'];

export const pythonLanguagePack: LanguagePackDefinition = {
  id: 'python',
  displayName: 'Python',
  fileExtensions: ['.py'],
  detect: async (repoRoot) => {
    const found = await Promise.all(detectionManifests.map((manifest) => exists(join(repoRoot, manifest))));
    return found.some(Boolean);
  },
  extractSymbols,
  // `typecheck` is intentionally absent for now: pyright is optional tooling, unlike the
  // interpreter itself. A future integration should follow the shellcheck-style graceful-skip
  // pattern (probe the executable, skip — never fail — when it is not installed).
  snippetToolchain: { run: runSnippet }
};

export { extractSymbols, PythonInspectorError } from './extract-symbols.ts';
export { runSnippet } from './snippet-run.ts';
export { PythonInterpreterNotFoundError, resolvePythonInterpreter } from './python-interpreter.ts';

export default definePlugin({
  apiVersion: 1,
  name: '@docstube/lang-python',
  version: '0.0.1',
  description: 'Python language pack: stdlib-ast symbol extraction via subprocess and sandboxed snippet execution.',
  permissions: { exec: ['python', 'python3'] },
  capabilities: [{ kind: 'language-pack', ids: ['python'] }],
  register: (host) => {
    host.languagePack(pythonLanguagePack);
  }
});
