---
title: 'Writing plugins'
description: 'Create and load docstube plugins with @docstube/plugin-sdk.'
---

# Writing plugins

Start with the SDK entry point, then decide which hook your repository needs. <Claim id="c1">`definePlugin` is exported.</Claim> <Claim id="c2">`PluginRegistrationHost` is exported.</Claim> <Claim id="c3">`PluginManifest` is exported.</Claim>

A plugin file should default-export a `definePlugin` call. <Claim id="c4">`definePlugin` parses manifest input with `pluginManifestSchema`.</Claim> <Claim id="c5">`definePlugin` throws a `TypeError` when `register` is not a function.</Claim> <Claim id="c6">`definePlugin` returns a frozen branded plugin object.</Claim>

```ts no-exec
import { definePlugin } from '@docstube/plugin-sdk';
import type {
  Finding,
  PageArtifact,
  VerifierContext,
  VerifierDefinition,
  VerifierRunResult
} from '@docstube/plugin-sdk';

const verifierId = 'frontmatter-title';

const verify = async (_ctx: VerifierContext, pages: PageArtifact[]): Promise<VerifierRunResult> => {
  const findings: Finding[] = [];

  for (const artifact of pages) {
    const hasTitle = /^title:\s*\S/mu.test(artifact.mdx);
    if (!hasTitle) {
      findings.push({
        source: 'verifier',
        check: verifierId,
        severity: 'error',
        message: `page "${artifact.page.slug}" is missing a frontmatter title`,
        entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id },
        file: artifact.mdxPath
      });
    }
  }

  return {
    verifier: verifierId,
    plugin: 'docstube-plugin-frontmatter-title',
    status: findings.some((finding) => finding.severity === 'error') ? 'fail' : 'pass',
    findings,
    coveredEntityIds: pages.map((artifact) => artifact.page.id)
  };
};

export const frontmatterTitleVerifier: VerifierDefinition = {
  id: verifierId,
  title: 'Frontmatter title',
  scope: 'page',
  localeScope: 'per-locale',
  proves: true,
  verify
};

export default definePlugin({
  apiVersion: 1,
  name: 'docstube-plugin-frontmatter-title',
  version: '0.1.0',
  description: 'Fails pages that omit a frontmatter title.',
  permissions: { network: false, exec: [], writableRoots: [] },
  capabilities: [{ kind: 'verifier', ids: [verifierId] }],
  register: (host) => {
    host.verifier(frontmatterTitleVerifier);
  }
});
```

## Manifest

Keep the manifest honest because the host compares declarations with registrations. <Claim id="c7">`pluginApiVersion` is 1.</Claim> <Claim id="c8">`pluginManifestSchema` requires `apiVersion` to equal `pluginApiVersion`.</Claim> <Claim id="c9">`pluginManifestSchema` requires at least one capability declaration.</Claim>

Permissions are declared in the manifest. <Claim id="c10">`pluginPermissionsSchema.network` defaults to false.</Claim> <Claim id="c11">`pluginPermissionsSchema.exec` defaults to an empty array.</Claim> <Claim id="c12">`pluginPermissionsSchema.writableRoots` defaults to an empty array.</Claim>

For maintainers, the practical review is simple: use `network: false` unless the plugin contacts a service, list only the executables the plugin calls through `ctx.exec`, and list only repo-relative roots the plugin writes through `ctx.fs.writeFile`.

## Hooks

The registration host is the plugin's connection to docstube. <Claim id="c13">`PluginRegistrationHost.verifier` exists.</Claim> <Claim id="c14">`PluginRegistrationHost.languagePack` exists.</Claim> <Claim id="c15">`PluginRegistrationHost.contentSource` exists.</Claim> <Claim id="c16">`PluginRegistrationHost.importer` exists.</Claim> <Claim id="c17">`PluginRegistrationHost.deployTarget` exists.</Claim> <Claim id="c18">`PluginRegistrationHost.searchProvider` exists.</Claim> <Claim id="c19">`PluginRegistrationHost.component` exists.</Claim>

A verifier is the usual first plugin because it can add a repository-specific check without changing docstube itself. <Claim id="c20">`VerifierDefinition.scope` accepts `block`, `page`, or `site`.</Claim> <Claim id="c21">`VerifierDefinition.localeScope` accepts `source-only` or `per-locale`.</Claim> <Claim id="c22">`VerifierDefinition.verify` receives a `VerifierContext` and an array of `PageArtifact` values.</Claim>

The verifier example above returns a `VerifierRunResult`. <Claim id="c23">`VerifierRunResult.status` accepts `pass`, `fail`, `error`, or `skipped`.</Claim> <Claim id="c24">`Finding.severity` accepts `info`, `warning`, or `error`.</Claim>

## Runtime Handles

Verifier code receives controlled helpers through `VerifierContext`. <Claim id="c25">`PluginFs.readFile` exists.</Claim> <Claim id="c26">`PluginFs.exists` exists.</Claim> <Claim id="c27">`PluginFs.writeFile` exists.</Claim> <Claim id="c28">`PluginExec` accepts `cwd`, `input`, `timeoutMs`, and `env` options.</Claim>

The core verifier runner wires those helpers from the plugin manifest. <Claim id="c29">`createPluginExec` rejects a command that is not listed in `permissions.exec`.</Claim> <Claim id="c30">`createPluginFs.writeFile` throws when a write target is outside `writableRoots`.</Claim>

## Loading

Enable plugins in `docstube.yml`.

```yaml
plugins:
  - docstube-plugin-frontmatter-title
  - ./plugins/frontmatter-title.ts
```

The loader treats the two forms differently. <Claim id="c31">`loadConfiguredPlugins` reads plugin specifiers from `config.plugins`.</Claim> <Claim id="c32">`loadConfiguredPlugins` treats relative and absolute plugin specifiers as local plugins.</Claim> <Claim id="c33">`loadConfiguredPlugins` resolves npm plugin specifiers from the documented repository.</Claim> <Claim id="c34">`loadConfiguredPlugins` rejects a plugin module whose default export was not created with `definePlugin`.</Claim>

Use a local path while developing a private verifier. Use an npm package when multiple repositories should share the same plugin.

## Scaffold

The CLI has a starter path for plugin authors. <Claim id="c35">`runPluginCommand` is exported.</Claim> <Claim id="c36">`runPluginCommand` accepts only the `scaffold` action.</Claim> <Claim id="c37">`runPluginCommand` writes `plugins/<name>.ts`.</Claim> <Claim id="c38">`runPluginCommand` writes `plugins/<name>.spec.ts`.</Claim> <Claim id="c39">`runPluginCommand` materializes the `plugin-authoring` skill.</Claim>

```bash
pnpm docstube plugin scaffold frontmatter-title
```

After scaffolding, register the generated local plugin in `docstube.yml`.

```yaml
plugins:
  - ./plugins/frontmatter-title.ts
```

Then point your coding agent at `.docstube/skills/plugin-authoring/SKILL.md` when the starter needs custom verifier logic, a language pack, a deploy target, or another hook kind.
