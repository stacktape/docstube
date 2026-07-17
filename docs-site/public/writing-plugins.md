---
title: "Writing plugins"
description: "Build docstube plugins with @docstube/plugin-sdk, registration hooks, permissions, plugin loading, and the plugin-authoring scaffold."
---

# Writing plugins

`@docstube/plugin-sdk` exposes `definePlugin` as the plugin entry point. It also re-exports plugin contract schemas and types, including `pluginManifestSchema`, `pluginPermissionsSchema`, `pluginCapabilityKindSchema`, `PluginManifest`, `PluginPermissions`, `PluginCapabilityKind`, `VerifierRunResult`, `Finding`, and `SymbolRecord`.

A plugin module must default-export the value returned by `definePlugin`. The loader rejects a module whose default export was not created with `definePlugin`.

```ts
import { definePlugin } from '@docstube/plugin-sdk';

export default definePlugin({
  apiVersion: 1,
  name: 'docstube-plugin-wordcount',
  version: '0.1.0',
  permissions: { network: false, exec: [], writableRoots: [] },
  capabilities: [{ kind: 'verifier', ids: ['wordcount'] }],
  register: (host) => {
    host.verifier({
      id: 'wordcount',
      title: 'Page word budget',
      scope: 'page',
      localeScope: 'per-locale',
      proves: false,
      verify: async (_ctx, pages) => ({
        verifier: 'wordcount',
        plugin: 'docstube-plugin-wordcount',
        status: 'pass',
        findings: [],
        coveredEntityIds: pages.map((artifact) => artifact.page.id)
      })
    });
  }
});
```

## Manifest validation

`definePlugin` accepts the manifest fields plus `register`, parses the manifest fields with `pluginManifestSchema`, checks that `register` is a function, and returns a branded `DocstubePlugin`.

`pluginManifestSchema` requires `apiVersion: 1`, a valid plugin package name, a semver `version`, and at least one capability declaration. `description` is optional.

`pluginPermissionsSchema` has three fields: `network`, `exec`, and `writableRoots`. The schema defaults are `network: false`, `exec: []`, and `writableRoots: []`.

```ts
import { pluginPermissionsSchema } from '@docstube/plugin-sdk';

const permissions = pluginPermissionsSchema.parse({
  network: false,
  exec: [],
  writableRoots: []
});

console.log(permissions);
```

## Registration hooks

`register(host)` receives a `PluginRegistrationHost`. The host has seven registration methods:

| Method | Definition type |
| --- | --- |
| `host.verifier(...)` | `VerifierDefinition` |
| `host.languagePack(...)` | `LanguagePackDefinition` |
| `host.contentSource(...)` | `ContentSourceDefinition` |
| `host.importer(...)` | `ImporterDefinition` |
| `host.deployTarget(...)` | `DeployTargetDefinition` |
| `host.searchProvider(...)` | `SearchProviderDefinition` |
| `host.component(...)` | `ComponentDefinition` |

The matching capability kinds are `verifier`, `language-pack`, `content-source`, `importer`, `deploy-target`, `search-provider`, and `component`.

During registration, docstube checks each registered id or component name against the plugin manifest capabilities. Registering an undeclared capability is an error. Declaring a capability without registering it is recorded as a warning.

## Verifier shape

A verifier definition contains `id`, `title`, optional `description`, `scope`, optional `appliesTo`, `localeScope`, `proves`, and `verify`.

`scope` is typed as `'block' | 'page' | 'site'`. `localeScope` is typed as `'source-only' | 'per-locale'`. `verify` receives a `VerifierContext` and an array of `PageArtifact` values, then returns a `VerifierRunResult`.

A verifier context includes the repository root, parsed config, codemap, glossary, block type registry, plugin file-system helper, plugin exec helper, and logger. `PluginFs` provides `readFile`, `exists`, and `writeFile`. `PluginExec` runs a command with arguments and optional `cwd`, `input`, `timeoutMs`, and `env`.

## Permissions

`permissions.network` declares whether the plugin intends to make network calls.

`permissions.exec` lists executables the plugin may spawn through the host-provided `ctx.exec` helper. The `PluginExec` type takes a command, argument list, and optional execution options.

`permissions.writableRoots` lists repo-relative roots the plugin may write through `ctx.fs.writeFile`. An empty list means the plugin declares no writable roots.

## Loading plugins

`loadConfiguredPlugins` loads every specifier in `config.plugins`.

Local plugin specifiers start with `.` or are absolute paths. They are imported from the repository root. Other specifiers are resolved as npm dependencies from the documented repository by using `createRequire` with that repository's `package.json`.

After import, the loader reads the module default export and rejects it unless `isDocstubePlugin` returns true. Loaded plugins are registered with source `"local"` or `"npm"`.

```yaml
plugins:
  - docstube-plugin-wordcount
  - ./plugins/wordcount.ts
```

## Scaffolding

The CLI `plugin` command supports the `scaffold` action.

`docstube plugin scaffold <name>` writes `plugins/<name>.ts` and `plugins/<name>.spec.ts` from the plugin-authoring example source, then materializes `.docstube/skills/plugin-authoring/SKILL.md`.

```bash
docstube plugin scaffold wordcount
```

The scaffold command prints the local plugin entry to add to `docstube.yml`, points the authoring agent at `.docstube/skills/plugin-authoring/SKILL.md`, and notes that `docstube check --list` shows the check after the plugin registers a verifier.