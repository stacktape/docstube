import type { ThemeManifest } from '../../theme-manifest.ts';
import { defaultThemeTokens } from '../../theme-manifest.ts';

// The 'basic' theme: the zero-dependency-feel default skeleton — light, clean, no CSS framework.
// Its site/ directory is compiled into bundle.generated.ts by scripts/build-theme-bundles.ts.

const rendererModule = 'components/theme-components.tsx';

export const manifest: ThemeManifest = {
  name: 'basic',
  description: 'Clean light default: sidebar navigation, plain CSS, React registry components.',
  // Exact pins on top of the kernel base deps (astro, @astrojs/mdx, pagefind). React powers the
  // vendored registry components; the react() integration comes from integrations.mjs.
  dependencies: {
    '@astrojs/react': '5.0.7',
    react: '19.2.7',
    'react-dom': '19.2.7'
  },
  build: {
    integrationsModule: 'integrations.mjs',
    globalStyleEntry: 'styles/global.css'
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
  // Semantic tokens repeat the matching defaults literally: ThemeTokens requires them as own
  // properties, and a spread of Record<string, string> cannot prove that statically.
  tokens: {
    ...defaultThemeTokens,
    accent: '#087f7b',
    fontBody: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontCode: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  }
};
