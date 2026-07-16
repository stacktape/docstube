---
title: "Writing plugins"
description: "Build docstube plugins with @docstube/plugin-sdk, registration hooks, permissions, plugin loading, and the plugin-authoring scaffold."
---

# Writing Plugins

`@docstube/plugin-sdk` exposes `definePlugin` as the plugin entry point. The SDK also re-exports the contract schemas and types plugin authors need, including `pluginManifestSchema`, `pluginPermissionsSchema`, `pluginCapabilityKindSchema`, `PluginManifest`, `PluginPermissions`, `PluginCapabilityKind`, `VerifierRunResult`, `Finding`, and `SymbolRecord`.

A plugin module is loaded only when its default export is created by `definePlugin`. The loader checks that with `isDocstubePlugin`.

```ts
import { definePlugin } from '@docstube/plugin-sdk';
import type {
  Finding,
  PageArtifact,
  VerifierContext,
  VerifierDefinition,
  VerifierRunResult
} from '@docstube/plugin-sdk';

const verifierId = 'wordcount';
const softLimit = 1500;
const hardLimit = 3000;

const countWords = (mdx: string): number =>
  mdx
    .replace(/```[\s\S]*?```/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length > 0).length;

const verify = async (_ctx: VerifierContext, pages: PageArtifact[]): Promise<VerifierRunResult> => {
  const findings: Finding[] = [];
  for (const artifact of pages) {
    const words = countWords(artifact.mdx);
    if (words <= softLimit) {
      continue;
    }
    findings.push({
      source: 'verifier',
      check: verifierId,
      severity: words > hardLimit ? 'error' : 'warning',
      message: `page "${artifact.page.slug}" is ${words} words`,
      entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id },
      file: artifact.mdxPath,
      suggestion: 'Split the page or tighten its longest sections.',
      data: { words, softLimit, hardLimit }
    });
  }
  return {
    verifier: verifierId,
    plugin: 'docstube-plugin-wordcount',
    status: findings.some((finding) => finding.severity === 'error') ? 'fail' : 'pass',
    findings,
    coveredEntityIds: pages.map((artifact) => artifact.page.id)
  };
};

export const wordcountVerifier: VerifierDefinition = {
  id: verifierId,
  title: 'Page word budget',
  description: 'Pages over 1500 words get a warning; pages over 3000 words fail the gate.',
  scope: 'page',
  localeScope: 'per-locale',
  proves: false,
  verify
};

export default definePlugin({
  apiVersion: 1,
  name: 'docstube-plugin-wordcount',
  version: '0.1.0',
  description: 'Verifier: warns on pages over the word budget and fails the gate past the hard limit.',
  permissions: { network: false, exec: [], writableRoots: [] },
  capabilities: [{ kind: 'verifier', ids: [verifierId] }],
  register: (host) => {
    host.verifier(wordcountVerifier);
  }
});
```

## Manifest Validation

`definePlugin` accepts `DefinePluginInput`, parses the manifest portion with `pluginManifestSchema`, checks that `register` is a function, and returns a branded `DocstubePlugin`.

`pluginManifestSchema` uses `pluginApiVersion`, `pluginPermissionsSchema`, and `pluginCapabilityKindSchema`. The capability kind schema contains seven values:

```ts
import { pluginCapabilityKindSchema } from '@docstube/plugin-sdk';

const hookKinds = pluginCapabilityKindSchema.options;
console.log(hookKinds);
```

`pluginPermissionsSchema` includes `network`, `exec`, and `writableRoots`. In the schema, `network` defaults to `false`, while `exec` and `writableRoots` default to empty arrays.

## Registration Hooks

`PluginRegistrationHost` is the registration surface passed to the plugin `register` function. It has seven methods, each accepting one exported definition type:

| Method | Definition type |
| --- | --- |
| `verifier` | `VerifierDefinition` |
| `languagePack` | `LanguagePackDefinition` |
| `contentSource` | `ContentSourceDefinition` |
| `importer` | `ImporterDefinition` |
| `deployTarget` | `DeployTargetDefinition` |
| `searchProvider` | `SearchProviderDefinition` |
| `component` | `ComponentDefinition` |

`createPluginHost` records registrations for the same seven groups. During registration, it checks each registered id or component name against the plugin manifest capabilities. An undeclared registration is rejected, a duplicate id is rejected, and a declared capability that was not registered is recorded as a warning.

## Verifier Shape

`VerifierDefinition` has `id`, `title`, optional `description`, `scope`, optional `appliesTo`, `localeScope`, `proves`, and `verify`.

`scope` is typed as `'block' | 'page' | 'site'`. `localeScope` is typed as `'source-only' | 'per-locale'`. `verify` receives a `VerifierContext` and an array of `PageArtifact` values, then returns a `VerifierRunResult`.

`VerifierContext` includes the repository root, parsed config, codemap, glossary, block type registry, plugin file-system helper, plugin exec helper, and logger. `PluginFs` provides `readFile`, `exists`, and `writeFile`. `PluginExec` runs a command with arguments and optional `cwd`, `input`, and `timeoutMs`.

## Loading Plugins

`loadConfiguredPlugins` loads every specifier in `config.plugins`.

Local plugins are specifiers that start with `.` or are absolute paths. They are imported from the repository root. Other specifiers are resolved as npm dependencies from the documented repository by using `createRequire` with that repository's `package.json`.

After import, the loader reads the module default export and rejects it unless `isDocstubePlugin` returns true. Loaded plugins are registered with source `"local"` or `"npm"`.

```yaml
plugins:
  - docstube-plugin-wordcount
  - ./plugins/wordcount.ts
```

## Scaffolding

The CLI `plugin` command is implemented by `runPluginCommand`. The supported action is `scaffold`.

`docstube plugin scaffold <name>` writes `plugins/<name>.ts` and `plugins/<name>.spec.ts` from the plugin-authoring example source, then materializes `.docstube/skills/plugin-authoring/SKILL.md`.

```bash
docstube plugin scaffold wordcount
```

The scaffold command prints the local plugin entry to add to `docstube.yml`, points the authoring agent at `.docstube/skills/plugin-authoring/SKILL.md`, and notes that `docstube check --list` shows the check after the plugin registers a verifier.