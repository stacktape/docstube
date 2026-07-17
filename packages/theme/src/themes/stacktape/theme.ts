import type { ThemeManifest } from '../../theme-manifest.ts';

// The 'stacktape' theme: a faithful port of the founder's ../stacktape/docs site
// (knowledge/design/theme-spec-stacktape.md). Dark-only by design — the source has no light
// palette, so this theme renders the dark tokens unconditionally and accentDark is omitted.
// Its site/ directory is compiled into bundle.generated.ts by scripts/build-theme-bundles.ts.

const rendererModule = 'components/theme-components.tsx';

export const manifest: ThemeManifest = {
  name: 'stacktape',
  description: 'Dark engineering look ported from docs.stacktape.com: teal accent, raised pills, Geist type.',
  // Exact pins on top of the kernel base deps (astro, @astrojs/mdx, pagefind). React powers the
  // layout islands (sidebar, table of contents) and the vendored registry components. Shiki pins
  // stay inside astro 6.4.6's own shiki ^4 range so the markdown pipeline and the theme
  // transformers resolve to one version. Tailwind 4 wires through the postcss plugin in
  // integrations.mjs (@tailwindcss/vite breaks on rolldown-based astro).
  dependencies: {
    '@astrojs/react': '5.0.7',
    '@shikijs/transformers': '4.3.1',
    '@tailwindcss/postcss': '4.3.1',
    react: '19.2.7',
    'react-dom': '19.2.7',
    shiki: '4.3.1',
    tailwindcss: '4.3.1'
  },
  build: {
    integrationsModule: 'integrations.mjs',
    globalStyleEntry: 'styles/global.css',
    // The source site highlights with shiki `catppuccin-mocha` (single theme — dark-only). The
    // transformers module ports the spec's [!code highlight]/[!code focus] comment markers.
    shiki: { themes: ['catppuccin-mocha'], transformers: ['code/shiki-transformers.mjs'] }
  },
  // Declared in registry order so the generated MDX import line stays stable.
  renderers: {
    Callout: rendererModule,
    CodeBlock: rendererModule,
    CodeGroup: rendererModule,
    Terminal: rendererModule,
    Card: rendererModule,
    CardGrid: rendererModule,
    Steps: rendererModule,
    Tabs: rendererModule,
    FileTree: rendererModule,
    Badge: rendererModule,
    ParamTable: rendererModule,
    ComparisonTable: rendererModule
  },
  // Semantic tokens (accent/fontBody/fontCode) are honored by styles/global.css via var()
  // indirection; the stp-* extras are the theme-internal surface palette from the spec §1.1.
  tokens: {
    accent: '#36BEBE',
    fontBody: 'Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontCode: '"Geist Mono", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'stp-page': '#161C1C',
    'stp-header': '#1C2121',
    'stp-element': '#222828',
    'stp-input': '#141A1A',
    'stp-border-light': '#2F3434',
    'stp-text': 'rgba(255, 255, 255, 0.87)',
    'stp-text-muted': '#A0A0A0'
  }
};
