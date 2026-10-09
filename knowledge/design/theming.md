# Multi-theme architecture (v2 — post Sol design review, 2026-07-17)

Draft v1 was adversarially reviewed by GPT-5.6 Sol (`theming-design-review.md`); this v2 adopts
its structural findings scoped to v1 pragmatism (UX-first, three built-in themes, ecosystem
mechanics deferred but designed-for). Source-theme specs: `theme-spec-stacktape.md`,
`theme-spec-docstube.md` (both Sol-produced, implementation-grade).

Built-in themes: `basic` (current zero-dependency skeleton), `stacktape` (faithful port of
../stacktape/docs — dark-only, Tailwind 4 + shiki 4 + React islands), `docstube` (the brand look
from apps/web GeneratedDocs.astro — light/dark, dp-token system).

## Contracts

Themes are authored as REAL SOURCE DIRECTORIES and shipped as compiled bundles (adopts Sol #5/#11
"author as directories, ship as bundles" — same pattern as the embedded python inspector):

```
packages/theme/src/themes/<name>/
  theme.ts          — ThemeManifest (typed metadata, build hooks, renderer map, tokens)
  site/**           — the actual Astro source tree vendored into emitted sites
  assets/**         — fonts/images (embedded base64 at package build)
scripts/build-theme-bundles.ts  — compiles site/** + assets/** into generated
  packages/theme/src/themes/<name>/bundle.generated.ts (checked in; sync-tested like
  python-inspector-source)
```

```ts
type ThemeManifest = {
  name: string; // builtins: bare names; plugin themes later: 'plugin/name'
  description: string;
  dependencies: Record<string, string>; // exact pins; conflict with kernel deps = build error
  build: ThemeBuild; // typed Astro hooks — the kernel owns astro.config
  renderers: Record<string, string>; // component contract name -> export in site/components
  tokens: ThemeTokens; // defaults; config theme.tokens overrides the semantic set
  options?: Record<string, unknown>; // theme-scoped knobs (validated by the theme)
};

// The kernel generates astro.config.mjs from invariants (MDX, static output, Pagefind, content
// dirs) plus these typed hooks — themes never own the config file (Sol #6, one owner).
type ThemeBuild = {
  integrationsModule?: string; // site/ path exporting extra Astro integrations (e.g. react())
  globalStyleEntry: string; // site/ path of the css entry the layout imports
  shiki?: { themes: string[]; transformers?: string[] }; // code-block pipeline config
};

// Semantic tokens every theme MUST honor (portable brand overrides — Sol #8 scoped to v1):
// accent, accentDark, fontBody, fontCode. Everything else is theme-internal; the existing
// free-form theme.tokens record maps onto the theme's own custom properties as an escape hatch.
type ThemeTokens = { accent: string; accentDark?: string; fontBody: string; fontCode: string } & Record<string, string>;
```

## Proof rendering is a conformance contract, not a theme choice (Sol #4)

The product's signature is visible verification. The KERNEL, not the theme:

- injects `data-docstube-entity-id` + `data-docstube-guarantee` attributes on rendered sections/
  blocks (site-data + a kernel-provided wrapper module every theme layout must mount);
- provides portable primitives `DocstubeGuarantee` (badge) and `DocstubeSources` (provenance
  popover) whose STYLING hooks are themeable but whose presence is mandatory;
- conformance test per theme (CI): the emitted site of a fixture manifest renders all three
  guarantee levels with visible accessible labels and source links. A theme that hides proof
  fails its build.

## Emitted-file ownership + theme switching (Sol #3)

Emission writes `.docstube/theme-files.json`: `{ theme, themeVersion, files: [{path, hash}] }`.

Refresh/theme-switch algorithm:

1. Read the previous ownership manifest (absent → treat all previous theme paths as unowned,
   overwrite-only legacy mode).
2. For each previously-owned path not in the new bundle: delete IF its hash still matches
   (user-modified files are preserved and reported as conflicts, never silently destroyed).
3. Write new bundle files; overwrite owned files; a user-modified owned file is reported and
   skipped unless `--force-theme`.
4. Rewrite package.json deps + kernel astro.config.
   Content (`content/**`, `public/*.md`, llms.txt), site-data, and the MCP server are
   kernel/content-owned and never touched by theme operations.

## Ownership table (Sol #15)

| Path                                                              | Owner                         | Theme switch touches?         |
| ----------------------------------------------------------------- | ----------------------------- | ----------------------------- |
| content/**, public/\*.md, llms.txt, mcp/**                        | content/kernel                | never                         |
| src/site-data.mjs                                                 | kernel                        | never                         |
| astro.config.mjs, package.json                                    | kernel (theme hooks as input) | rewritten                     |
| src/layouts/**, src/components/**, src/styles/**, public/fonts/** | theme bundle                  | manifest-driven replace       |
| src/docstube/** (proof primitives, entity wrappers)               | kernel                        | rewritten                     |
| anything user-added                                               | user                          | preserved; conflicts reported |

## Config

`theme.name: string` — default `'basic'`; the wizard always writes an explicit name; changing the
shipped default later never restyles existing repos (Sol #14). `theme.tokens` = semantic set +
theme-scoped extras. Unknown theme at emit = hard error listing available themes.

## Adopted-later (designed for, deliberately not built now)

- Plugin-provided themes through the plugin host (registry seam: emitSite takes a resolved
  ThemeBundle — the CLI resolves from the builtin map today; the host slot is where plugins join).
  Namespacing rule reserved: plugin themes are 'plugin/name'.
- Component contract versioning (Callout@1) and per-theme renderer schema validation beyond the
  name→export map.
- Emitted lockfiles (v1: exact pins + per-theme CI build fixtures catch drift).
- Downloadable theme bundles / size budgets (three embedded themes are fine; policy documented:
  embedded = offline-guaranteed set).
- Full semantic token schema (light/dark palettes per role, typography scale) beyond the four
  mandatory tokens.

## Faithfulness process

Implementation agents build `stacktape` and `docstube` against the Sol specs (both source repos
are the founder's — vendoring portable files verbatim is allowed and preferred). Note from the
specs: stacktape is DARK-ONLY (no light palette exists — the port keeps that); docstube is
light-default with a dark mode. Sol then reviews each built theme against its own spec before the
dogfood site adopts `docstube`.
