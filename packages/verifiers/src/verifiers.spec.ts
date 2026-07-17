import { describe, expect, it } from 'vitest';
import { isDocstubePlugin } from '@docstube/plugin-sdk';
import type { PluginRegistrationHost, VerifierDefinition } from '@docstube/plugin-sdk';
import verifiersPlugin, { builtinVerifierIds } from './verifiers.ts';

const collectingHost = (registered: VerifierDefinition[]): PluginRegistrationHost => ({
  verifier: (definition) => registered.push(definition),
  languagePack: () => {},
  contentSource: () => {},
  importer: () => {},
  deployTarget: () => {},
  searchProvider: () => {},
  component: () => {}
});

describe('@docstube/verifiers plugin', () => {
  it('is a branded plugin with the expected manifest', () => {
    expect(isDocstubePlugin(verifiersPlugin)).toBe(true);
    expect(verifiersPlugin.manifest.name).toBe('@docstube/verifiers');
    expect(verifiersPlugin.manifest.version).toBe('0.0.2');
    expect(verifiersPlugin.manifest.permissions).toEqual({
      network: false,
      exec: ['bash', 'node', 'shellcheck'],
      writableRoots: []
    });
    expect(verifiersPlugin.manifest.capabilities).toEqual([{ kind: 'verifier', ids: builtinVerifierIds }]);
  });

  it('registers exactly the nine built-in verifiers', async () => {
    const registered: VerifierDefinition[] = [];
    await verifiersPlugin.register(collectingHost(registered));

    expect(registered.map((definition) => definition.id)).toEqual(builtinVerifierIds);
    expect(builtinVerifierIds).toEqual([
      'mdx-compile',
      'internal-links',
      'code-typecheck-ts',
      'entity-integrity',
      'snippet-exec',
      'shellcheck',
      'sample-parses',
      'prose-lints',
      'diagram-d2'
    ]);
  });

  it('declares scopes and proof semantics per verifier', async () => {
    const registered: VerifierDefinition[] = [];
    await verifiersPlugin.register(collectingHost(registered));
    const byId = new Map(registered.map((definition) => [definition.id, definition]));

    expect(byId.get('mdx-compile')).toMatchObject({ scope: 'page', localeScope: 'per-locale', proves: false });
    // Site-scope coverage runs after guarantee assignment, so links gate but never prove.
    expect(byId.get('internal-links')).toMatchObject({ scope: 'site', localeScope: 'per-locale', proves: false });
    expect(byId.get('code-typecheck-ts')).toMatchObject({
      scope: 'block',
      localeScope: 'source-only',
      proves: true,
      appliesTo: { blockTypes: ['code-example'], languages: ['ts', 'tsx', 'typescript'] }
    });
    expect(byId.get('entity-integrity')).toMatchObject({ scope: 'page', localeScope: 'per-locale', proves: false });
    expect(byId.get('snippet-exec')).toMatchObject({
      scope: 'block',
      localeScope: 'source-only',
      proves: true,
      appliesTo: { blockTypes: ['code-example'], languages: ['bash', 'sh', 'js', 'javascript', 'ts', 'typescript'] }
    });
    expect(byId.get('shellcheck')).toMatchObject({
      scope: 'block',
      localeScope: 'source-only',
      proves: false,
      appliesTo: { blockTypes: ['code-example'], languages: ['bash', 'sh'] }
    });
    expect(byId.get('sample-parses')).toMatchObject({
      scope: 'block',
      localeScope: 'per-locale',
      proves: true,
      appliesTo: { blockTypes: ['code-example'], languages: ['json', 'yaml', 'yml'] }
    });
    expect(byId.get('prose-lints')).toMatchObject({ scope: 'page', localeScope: 'per-locale', proves: false });
  });
});
