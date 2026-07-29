// Public API of @docstube/lang-typescript — the TypeScript language pack (ARCHITECTURE.md §7).
// The pack owns its extraction method (the TypeScript compiler API); symbol hashing and diffing
// stay kernel-owned in @docstube/codemap.

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { FingerprintCapablePack } from '@docstube/codemap';
import { definePlugin } from '@docstube/plugin-sdk';
import { extractCitedValues } from './cited-values.ts';
import { extractFingerprints } from './extract-fingerprints.ts';
import { extractSymbols } from './extract-symbols.ts';
import { extractSchemaShapes } from './schema-shape.ts';
import { typecheckSnippet } from './snippet-typecheck.ts';

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  );

// FingerprintCapablePack = the plugin-sdk pack shape plus the additive typed-fingerprint
// capability hosted by @docstube/codemap (ARCHITECTURE.md §7.2). `extractCitedValues` is a second
// additive capability, duck-typed by the kernel's claim-verification stage (core
// pipeline/verify-claims.ts): the 0.1.0 minimal value-predicate verifier calls it at verify time
// to compare a claim's asserted value against the code, with EXACTLY the normalization the
// valuePrints facet hashes. `extractSchemaShapes` is the third, duck-typed the same way: the
// schema-shape verifier calls it at verify time to decide claims about a declared schema's fields
// against the shape the schemaShapePrint facet hashes.
export const typescriptLanguagePack: FingerprintCapablePack & {
  extractCitedValues: typeof extractCitedValues;
  extractSchemaShapes: typeof extractSchemaShapes;
} = {
  id: 'typescript',
  displayName: 'TypeScript',
  fileExtensions: ['.ts', '.tsx', '.mts', '.cts'],
  detect: async (repoRoot) =>
    (await exists(join(repoRoot, 'tsconfig.json'))) || (await exists(join(repoRoot, 'package.json'))),
  extractSymbols,
  extractFingerprints,
  extractCitedValues,
  extractSchemaShapes,
  snippetToolchain: { typecheck: typecheckSnippet }
};

export { extractSymbols } from './extract-symbols.ts';
export { extractFingerprints } from './extract-fingerprints.ts';
export { extractCitedValues } from './cited-values.ts';
export type { ExtractCitedValuesInput } from './cited-values.ts';
export { collectSchemaShapes, declaredShapeOf, extractSchemaShapes } from './schema-shape.ts';
export type { ExtractSchemaShapesInput } from './schema-shape.ts';
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
