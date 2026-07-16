// Public API of @docstube/verifiers — the built-in deterministic verifier plugin. Registered by
// core through the same plugin host API as third-party plugins (ARCHITECTURE.md §6.2).

import { definePlugin } from '@docstube/plugin-sdk';
import { codeTypecheckTsVerifier } from './code-typecheck-ts.ts';
import { diagramD2Verifier } from './diagram-d2.ts';
import { entityIntegrityVerifier } from './entity-integrity.ts';
import { internalLinksVerifier } from './internal-links.ts';
import { mdxCompileVerifier } from './mdx-compile.ts';
import { proseLintsVerifier } from './prose-lints.ts';
import { sampleParsesVerifier } from './sample-parses.ts';
import { shellcheckVerifier } from './shellcheck.ts';
import { snippetExecVerifier } from './snippet-exec.ts';

export { mdxCompileVerifier } from './mdx-compile.ts';
export { internalLinksVerifier, findLinks } from './internal-links.ts';
export type { MdxLink } from './internal-links.ts';
export { codeTypecheckTsVerifier, findCodeBlocks, mapFencesByHash } from './code-typecheck-ts.ts';
export type { MdxCodeBlock } from './code-typecheck-ts.ts';
export { entityIntegrityVerifier } from './entity-integrity.ts';
export { snippetExecVerifier } from './snippet-exec.ts';
export { shellcheckVerifier } from './shellcheck.ts';
export { sampleParsesVerifier } from './sample-parses.ts';
export { proseLintsVerifier } from './prose-lints.ts';
export { diagramD2Verifier, extractD2Nodes, groundD2Node } from './diagram-d2.ts';
export type { D2Node } from './diagram-d2.ts';
export { verifiersPluginName } from './run-support.ts';

const verifierDefinitions = [
  mdxCompileVerifier,
  internalLinksVerifier,
  codeTypecheckTsVerifier,
  entityIntegrityVerifier,
  snippetExecVerifier,
  shellcheckVerifier,
  sampleParsesVerifier,
  proseLintsVerifier,
  diagramD2Verifier
];

export const builtinVerifierIds: string[] = verifierDefinitions.map((definition) => definition.id);

const verifiersPlugin = definePlugin({
  apiVersion: 1,
  name: '@docstube/verifiers',
  version: '0.0.2',
  description:
    'Built-in deterministic verifiers: MDX compilation, internal link resolution, TypeScript snippet typechecking, entity-tree integrity, snippet runtime execution, shellcheck, JSON/YAML sample parsing, and anti-slop prose lints.',
  // snippet-exec spawns bash/node; shellcheck spawns shellcheck. Declared up front so the host
  // can restrict ctx.exec to exactly these (ARCHITECTURE.md §6.3).
  permissions: { exec: ['bash', 'node', 'shellcheck'] },
  capabilities: [{ kind: 'verifier', ids: builtinVerifierIds }],
  register: (host) => {
    for (const definition of verifierDefinitions) {
      host.verifier(definition);
    }
  }
});

export default verifiersPlugin;
