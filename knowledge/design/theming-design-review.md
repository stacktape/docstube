## Ranked design flaws

1. **Critical — themes are not actually connected to the plugin or emission architecture**

The proposal says plugins register themes through the plugin host, but the hook surface has no theme registration method or `ThemeDefinition`. It only registers components, verifiers, language packs, and similar providers ([hook-types.ts](C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:202)). Meanwhile, the CLI imports `emitSite` directly from `@docstube/theme` and passes no plugin host or resolved theme ([emit-current-site.ts](C:/Projects/docstube/apps/cli/src/commands/emit-current-site.ts:6), [emit-current-site.ts](C:/Projects/docstube/apps/cli/src/commands/emit-current-site.ts:69)).

This breaks immediately for the first plugin-provided theme. At the fifth or twentieth built-in theme, it encourages a second private registry inside `@docstube/theme`, separate from the core plugin registry.

Concrete fix: define a public `ThemeDefinition` and `host.theme()` in `plugin-sdk`; have core produce a resolved registry with duplicate-ID validation and provenance. Pass the selected, resolved theme into the emitter. The CLI must obtain it from the loaded plugin host, not let `emitSite` perform hidden global lookup.

2. **Critical — component contracts are conflated with theme implementations**

`ComponentDefinition` owns the semantic name and Zod props schema. `ThemeDefinition.components: string[]` only claims that some implementation exists. There is no structural connection between the implementation and the registered props contract.

The current emitter imports every built-in component regardless of `config.components` ([emit-site.ts](C:/Projects/docstube/packages/theme/src/emit-site.ts:239)). The block registry is global across registered components ([block-registry.ts](C:/Projects/docstube/packages/core/src/entities/block-registry.ts:7)), while theme coverage is per theme. A page can therefore be valid against the global registry but impossible to render under the selected theme.

It gets worse with plugins: `ComponentDefinition.source` is merely a `modulePath` ([hook-types.ts](C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:196)). The design says this closes the vendoring gap but never specifies how the path is resolved, copied, bundled, permission-checked, or accompanied by transitive files and dependencies.

Concrete fix: separate:

- `ComponentContract`: stable ID, version, props schema, required rendering semantics.
- `ComponentRenderer`: contract ID/version, emitted module/files, dependencies, framework, export name.
- Theme renderer coverage: a map from contract ID to renderer, not `string[]`.

Validate every component used by emitted MDX, not merely every component enabled in config. Define collision and compatibility rules, such as `Callout@1`.

3. **Critical — refresh cannot safely switch themes because there is no ownership manifest or deletion model**

The proposal reduces refresh to rewriting current theme files and `package.json` ([theming.md](C:/Projects/docstube/knowledge/design/theming.md:50)). That leaves stale layouts, components, CSS, fonts, public assets, scripts, and integration config from the old theme. A switch from Stacktape to Basic could leave Tailwind inputs, font assets, and old modules in place. Removed files within the same theme revision have the same problem.

Current emission only creates and overwrites files; it never removes obsolete output ([emit-site.ts](C:/Projects/docstube/packages/theme/src/emit-site.ts:718)). Existing users may also have manually edited the generated site, so blindly deleting everything outside content would destroy user work.

Concrete fix: emit a `.docstube/theme-files.json` ownership manifest containing theme ID, theme version, generator version, path, and content hash. On refresh:

- Delete previously owned files absent from the new manifest.
- Overwrite unchanged-owned files.
- Detect user-modified owned files by hash and fail or preserve them under an explicit conflict policy.
- Keep kernel-owned, content-owned, and user-owned files in separate namespaces/manifests.
- Perform path normalization and reject traversal, absolute paths, case-fold collisions, and writes into content-owned locations.

Theme switching needs a migration operation, not just a rewrite loop.

4. **Critical — guarantee and provenance rendering are optional despite being core product semantics**

The proposal puts guarantee data in `site-data.mjs`, but themes are not required to use it. A theme can render a polished site that completely hides the product’s defining verification signal and source citations.

The current skeleton already renders page guarantees, section chips, and sources ([emit-site.ts](C:/Projects/docstube/packages/theme/src/emit-site.ts:415), [emit-site.ts](C:/Projects/docstube/packages/theme/src/emit-site.ts:451)). Moving the layout wholly into theme-owned files discards that guarantee unless the theme contract makes it mandatory.

Mandatory component names alone are too weak: a theme could export `GuaranteeBadge` that renders nothing. Data attributes alone are useful for review tooling but do not ensure visible affordances.

Concrete fix: make proof rendering a conformance contract:

- Kernel emits a versioned, normalized proof model for page, section, block, and claim entities.
- Kernel provides mandatory portable primitives such as `DocstubeGuarantee`, `DocstubeSources`, and entity wrappers, or performs invariant markup injection outside the theme.
- Require stable attributes including `data-docstube-entity-id`, `data-docstube-guarantee`, and provenance anchors for review/UI tooling.
- Add emitted-site conformance tests that parse/render representative pages and assert visible labels, accessible names, source links, and all three guarantee levels.

The theme should style these primitives, not decide whether they exist.

5. **High — `ThemeFile` is an under-specified package/bundling system**

`content | generator | base64` looks simple only because it omits the hard parts:

- executable generators mean themes are code, contradicting “a theme is data”;
- no file mode or executable bit;
- no symlinks;
- no media type or encoding metadata;
- no source maps;
- no directory ownership;
- no merge/patch semantics for shared config;
- no path safety;
- no collision rules;
- no deterministic ordering;
- no size limits;
- no way to express files imported by plugin component sources;
- no integrity/version metadata.

For plugin themes, generator functions also execute third-party code in the docstube process. That needs the same trust and permission posture as other plugin code.

Concrete fix: use a normalized theme bundle artifact: a directory tree plus a manifest. At package build time, compile built-in theme source directories into embeddable assets. At runtime, materialize the bundle and apply a small, typed set of substitutions or generated kernel files. Treat plugin theme registration as executable plugin code, then require it to return a validated bundle.

Do not use ad hoc generator functions for arbitrary individual files unless there is a compelling case.

6. **High — the dependency model does not handle theme-specific Astro build graphs**

A dependency map plus “astro.config additions” is not compositional. Stacktape needs Tailwind 4, Shiki 4, React, Astro integrations, CSS entry points, possibly Vite plugins, and configuration ordering. Another theme may need Sass, UnoCSS, remark/rehype plugins, image services, or no React. Two integrations can require ordering or mutually incompatible options.

The current kernel hardcodes Astro 6.4.6, MDX, React, Pagefind, and the complete integrations list ([emit-site.ts](C:/Projects/docstube/packages/theme/src/emit-site.ts:53), [emit-site.ts](C:/Projects/docstube/packages/theme/src/emit-site.ts:266)). The proposal names an Astro 7 theme but never says whether Astro belongs to the kernel or theme. If the theme owns `astro.config.mjs`, it can accidentally remove required MDX behavior, entity injection, base URL handling, or static output. If the kernel owns it, arbitrary theme “additions” require a fragile config-merging language.

Concrete fix: define a build adapter contract, not config fragments:

```ts
type AstroThemeBuild = {
  astroMajor: 7;
  dependencies: PackageRequirements;
  integrationsModule: string;
  globalStyleEntry: string;
  vitePluginsModule?: string;
  shiki?: ShikiOptions;
};
```

The kernel should generate the final config from invariant settings plus typed theme hooks. Alternatively, give each theme the full config but require it to import a kernel-generated `docstube-astro-base.mjs` and validate the resulting build. Pick one owner.

Also define dependency-conflict behavior. A flat `Record<string,string>` silently overwrites collisions between shared, theme, and plugin-component dependencies.

7. **High — “exact pins” do not provide reproducible emitted-site builds**

Exact versions in `package.json` are not enough. Transitive versions still move without a committed lockfile. The emitted site currently promises repeatable builds while emitting no lockfile ([emit-site.ts](C:/Projects/docstube/packages/theme/src/emit-site.ts:51)).

There is also no package-manager contract. The current comment says `npm install`, while the repository otherwise standardizes on pnpm. Theme dependency resolution may differ across npm versions.

Concrete fix: emit a lockfile generated and tested by the docstube release, and define the supported install command (`npm ci`, for example). Store dependency resolution per released theme bundle. Validate peer dependencies and Node/Astro compatibility during docstube CI.

8. **High — token overrides are an untyped CSS injection bag, not a branding contract**

`Record<string,string>` accepts arbitrary names and values ([config-schema.ts](C:/Projects/docstube/packages/contracts/src/config-schema.ts:109)). It cannot communicate:

- light versus dark palette values;
- font family plus font files, weights, subsets, and preload policy;
- semantic versus raw colors;
- typography scale;
- spacing, radius, shadow, and code syntax tokens;
- component variants;
- layout density;
- theme-specific capabilities.

A Stacktape theme and a `dp-*` theme will naturally use unrelated token namespaces. A saved `accent` override may work in Basic, partially work in Docstube, and do nothing in a later theme. That is the contract leak users encounter during theme switches.

Allowing arbitrary CSS values also requires careful serialization; the current code inserts values directly into CSS declarations ([emit-site.ts](C:/Projects/docstube/packages/theme/src/emit-site.ts:307)).

Concrete fix: define a small, stable semantic token schema covering light and dark modes, typography, shape, and proof states. Themes map semantic tokens into their internal variables. Add an explicitly theme-scoped extension bag:

```yaml
theme:
  name: docstube
  tokens:
    color:
      accent: '#0a818b'
      dark:
        accent: '#36bebe'
    typography:
      body: Inter
      code: JetBrains Mono
  options:
    docstube:
      codeBlockVariant: rail
```

Fonts need a separate asset/source policy; component variants need validated per-theme options, not CSS token abuse.

9. **High — the proposed source-theme fidelity exceeds the data contract**

The Docstube marketing mock contains interactive light/dark mode switching, a moving rail, code-tab state, collapsible navigation, a three-pane responsive layout, a right-side TOC, and separate light/dark `dp-*` palettes. Those are behavioral modules and structured layout capabilities, not merely files plus flat tokens.

The Stacktape source is described as Astro 7 + React + Shiki 4 + Tailwind 4. Faithful code blocks likely require build-time Shiki configuration, transformers, language loading, dual-theme output, copy controls, titles, highlighting metadata, and CSS processing. `ThemeDefinition` has no typed way to declare any of these. They can only be hidden inside arbitrary template files, making the contract meaningless and preventing validation.

The proposal also references `knowledge/design/theme-spec-*.md`, but those files are not present in this repository. That makes the claimed faithfulness process non-executable as written.

Concrete fix: add explicit contracts for:

- layout regions and responsive behavior;
- color-mode capabilities and persistence;
- code renderer configuration;
- navigation/TOC behavior;
- client scripts/islands;
- search UI integration;
- theme-specific validated options.

Commit the source-theme specifications the design cites, or remove the claim until they exist.

10. **High — package-size strategy scales linearly with every bundled theme**

Embedding every text file and every font/image as source strings or base64 means the published `docstube` package and every standalone binary contain all themes. Base64 adds roughly one-third overhead before package compression, and fonts dominate quickly. The twentieth theme turns a CLI install into a theme asset archive.

Concrete fix: split policy by theme origin:

- Keep `basic` and the default first-party theme embedded for guaranteed offline and standalone operation.
- Treat additional first-party themes as optional downloadable signed bundles with a local cache, while allowing release binaries to opt into a “full/offline” asset set if needed.
- Allow plugin packages to supply their own bundles.
- Deduplicate common fonts/assets by content hash.
- Publish bundle sizes and enforce CI budgets.

If all built-ins must work offline in the standalone binary, accept and document the size cost explicitly rather than pretending the model scales without consequence.

11. **Medium-high — the vendoring alternatives are not separated by deployment requirement**

Using real npm theme dependencies makes theme development and deduplication easy, but violates the product rule that generated sites vendor what they need and avoids runtime `@docstube/*` dependencies only superficially. It also makes plugin package availability and network access part of future builds.

Git-subtree/template directories are human-readable and easy to develop, but subtree is a source-management mechanism, not an emission or plugin contract. Runtime package resolution is worst for standalone/offline behavior and makes refresh dependent on whatever package version happens to resolve.

Concrete fix: author themes as normal directories/packages, but compile them into versioned vendorable bundles at docstube/plugin build time. Emitted sites should contain ordinary source files and ordinary third-party npm dependencies, not a runtime dependency on the theme package. This preserves:

- offline emission for embedded themes;
- standalone binary embedding;
- refresh without content regeneration;
- plugin-provided themes;
- inspectable, self-contained output.

12. **Medium-high — site context is too broad and unstable to expose directly to generators**

“Generator over `SiteContext`” provides no schema or compatibility/versioning boundary. Passing the entire nav, locales, and guarantee data to arbitrary file generators makes every future `SiteContext` change a theme API break. It also encourages generated source files containing page-specific data, causing large diffs on every content update.

Concrete fix: version the theme API and expose narrow serializable inputs. Prefer stable kernel-generated data modules consumed at runtime/build time by theme layouts. Theme bundle generation should depend mostly on site metadata and theme configuration, not the full manifest.

13. **Medium — theme naming and resolution are not ecosystem-safe**

`theme.name: string` has no namespace, version, origin, or conflict rule. Two plugins can register `stacktape`; a plugin can shadow `basic`; config cannot pin the theme implementation version; a later plugin update can silently redesign the site during refresh.

Concrete fix: use globally scoped IDs such as `@docstube/docstube` and `acme/brand`, reject duplicates, record provider plugin and version in emitted metadata, and optionally support a compatibility or version constraint. Built-in aliases can remain ergonomic but must resolve deterministically.

14. **Medium — theme selection is absent from the current strict config and migration is unspecified**

The current strict schema accepts only `theme.tokens` ([config-schema.ts](C:/Projects/docstube/packages/contracts/src/config-schema.ts:107)). Adding `theme.name` changes parsed output and serialized config behavior. Existing files need a defined default by schema/config version. Changing the default from Basic to Docstube later can silently restyle existing repositories after a docstube upgrade.

Concrete fix: once a project has emitted a site, persist an explicit theme selection in `docstube.yml`. For old configs, migrate or materialize `name: basic`; do not reinterpret omission as the newest default forever. New project creation can choose the new default.

15. **Medium — kernel/theme file boundaries are still contradictory**

The design calls `site-data.mjs` kernel-owned but says theme files may be generated from nav, locales, and guarantee data. It calls Pagefind wiring kernel-owned while search UI and integration placement necessarily affect theme layout and Astro configuration. It calls components theme-owned while component schemas live in a global plugin.

At twenty themes, every ambiguous boundary becomes a special case in `emit-site`.

Concrete fix: add an explicit ownership table for every emitted path and concern:

- kernel invariants and generated data;
- theme renderers and styling;
- plugin component renderers;
- content;
- user-owned customization.

For each, specify who creates it, who may import it, who may overwrite/delete it, and how compatibility is checked.

## Vendoring model recommendation

Use theme source directories during development, then compile each theme into a versioned bundle manifest containing files, hashes, component renderers, dependency requirements, and typed build metadata. Embed only the offline baseline set in the npm package and standalone binary. Materialize bundle contents into emitted sites; do not make emitted sites depend on a runtime theme package.

Real npm dependencies are appropriate for Astro, React, Tailwind, Shiki, and other upstream build dependencies. They are not the right delivery mechanism for the selected theme’s own layouts and components because that undermines self-contained output and refresh determinism.

## What I would change in the doc

- Replace the two loose types with versioned `ThemeBundle`, `ThemeBuild`, `ComponentContract`, and `ComponentRenderer` contracts.
- Specify how plugin themes reach the CLI emitter through the core plugin registry.
- Add a mandatory proof/provenance rendering and DOM conformance contract.
- Add an emitted-file ownership manifest and exact theme-switch migration algorithm.
- Give Astro configuration one clear owner and define typed theme build hooks.
- Replace flat dependency merging with conflict-checked requirements and emit a lockfile.
- Replace flat tokens with semantic light/dark/typography tokens plus validated theme-specific options.
- Define theme IDs, versions, collision handling, and persisted selection semantics.
- Document the embedded-versus-downloadable theme policy and package-size budget.
- Commit the referenced source-theme specifications and add build plus rendered-DOM conformance fixtures for Basic, Stacktape, and Docstube.
