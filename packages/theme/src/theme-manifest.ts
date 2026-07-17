// The multi-theme contract (knowledge/design/theming.md). Themes are authored as real source
// directories under src/themes/<name>/ and shipped as compiled bundles (bundle.generated.ts,
// produced by scripts/build-theme-bundles.ts and sync-tested against the source tree).

// Semantic tokens every theme MUST honor (portable brand overrides). Everything else is
// theme-internal; the free-form config theme.tokens record maps onto the theme's own custom
// properties as an escape hatch.
export type ThemeTokens = { accent: string; accentDark?: string; fontBody: string; fontCode: string } & Record<
  string,
  string
>;

// Typed Astro build hooks — the kernel owns astro.config.mjs and generates it from invariants
// (MDX, static output, Pagefind, content dirs) plus these hooks. Themes never own the config file.
export type ThemeBuild = {
  // site/-relative path of a module whose DEFAULT export is an array of extra Astro integrations
  // (e.g. `export default [react()]`). Emitted under src/, imported by the generated astro.config.
  integrationsModule?: string;
  // site/-relative path of the css entry the theme layout imports. Must exist in the bundle.
  globalStyleEntry: string;
  // Code-block pipeline config. `themes` holds shiki theme names (one = single theme, two =
  // light/dark pair). `transformers` entries are site/-relative modules whose default export is an
  // ARRAY of shiki transformers; the kernel imports and spreads them into markdown.shikiConfig.
  shiki?: { themes: string[]; transformers?: string[] };
};

export type ThemeManifest = {
  // Builtins use bare names; plugin themes later reserve the 'plugin/name' namespace.
  name: string;
  description: string;
  // Exact pins merged into the emitted site package.json on top of the kernel base deps. The same
  // package pinned to a different version than the kernel's is a hard error.
  dependencies: Record<string, string>;
  build: ThemeBuild;
  // Component contract name -> renderer location, as '<site-relative module>[#ExportName]' with
  // the export name defaulting to the contract name (e.g. 'components/theme-components.tsx').
  // The kernel generates the MDX component imports from this map.
  renderers: Record<string, string>;
  // Token defaults; config theme.tokens overrides the semantic set (and theme-scoped extras).
  tokens: ThemeTokens;
  // Theme-scoped knobs (validated by the theme itself).
  options?: Record<string, unknown>;
};

// Bundle file paths are emitted-site-relative ('src/layouts/DocLayout.astro',
// 'public/fonts/x.woff2'). The bundle compiler maps themes/<name>/site/** -> src/** (text,
// LF-normalized) and themes/<name>/assets/** -> public/** (base64). Every theme MUST ship
// 'src/layouts/DocLayout.astro' — the kernel references that path from generated page frontmatter.
export type ThemeBundleFile = { path: string; content: string } | { path: string; base64: string };

export type ThemeBundle = {
  manifest: ThemeManifest;
  files: ThemeBundleFile[];
};

export type ThemeErrorCode = 'theme-unknown' | 'theme-bundle-invalid' | 'theme-dependency-conflict';

export class ThemeError extends Error {
  readonly code: ThemeErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ThemeErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ThemeError';
    this.code = code;
    this.details = details;
  }
}

// Token defaults shared by the basic theme and mirrored by core's theme-token extraction
// vocabulary (packages/core/src/pipeline/extract-theme-tokens.ts — copied, not imported).
export const defaultThemeTokens: Record<string, string> = {
  surface: '#ffffff',
  'surface-muted': '#f4f7f8',
  'surface-raised': '#eef4f3',
  text: '#192122',
  'text-muted': '#526061',
  border: '#d5dfdf',
  accent: '#087f7b',
  'accent-strong': '#075f63',
  success: '#1a7f37',
  warning: '#8f5d00',
  danger: '#b42318',
  'font-family': 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
};

// Built-in theme registry. Lazy dynamic imports keep every bundle's embedded file contents out of
// memory (and out of the CLI startup path) until a theme is actually selected — the emitter never
// performs a hidden lookup; the CLI resolves here and passes the bundle in. Plugin-provided themes
// join through the plugin host later; this map stays the offline-guaranteed set.
export const builtinThemes: Record<string, () => Promise<ThemeBundle>> = {
  basic: async () => (await import('./themes/basic/bundle.generated.ts')).themeBundle,
  // The docstube brand look (light default + dark) — the marketing site's sample docs made real.
  docstube: async () => (await import('./themes/docstube/bundle.generated.ts')).themeBundle,
  // Faithful dark-only port of the stacktape docs theme (Tailwind 4 + shiki + React islands).
  stacktape: async () => (await import('./themes/stacktape/bundle.generated.ts')).themeBundle
};

export const builtinThemeNames = (): string[] => Object.keys(builtinThemes);
