import type { ThemeManifest } from '../../theme-manifest.ts';

// The 'docstube' brand theme: the marketing site's generated-docs mockup made real
// (knowledge/design/theme-spec-docstube.md). Light-default with the charcoal-green dark mode,
// teal-tinted surfaces, Outfit/Inter/JetBrains Mono, a three-pane shell with the bent TOC rail,
// and guarantee badges styled as the signature verified chips. Zero npm dependencies beyond the
// kernel pins: plain CSS custom properties + Astro components + small vanilla scripts.

export const manifest: ThemeManifest = {
  name: 'docstube',
  description:
    'docstube brand default: teal light/dark three-pane docs shell with the bent TOC rail and verified-chip proof styling.',
  dependencies: {},
  build: {
    globalStyleEntry: 'styles/global.css',
    // dark-plus reproduces the spec's dark syntax palette verbatim (#569cd6 keywords, #ce9178
    // strings, #dcdcaa functions, #9cdcfe variables); vitesse-light is the closest built-in to the
    // light palette's teal keywords + warm strings. Backgrounds are overridden to the dp code
    // surfaces in styles/global.css.
    shiki: { themes: ['vitesse-light', 'dark-plus'] }
  },
  // Astro components expose their component as the module default export, so every renderer maps
  // through '#default' (the kernel emits `import { default as Name }` lines).
  renderers: {
    Callout: 'components/Callout.astro#default',
    CodeBlock: 'components/CodeBlock.astro#default',
    CodeGroup: 'components/CodeGroup.astro#default',
    Terminal: 'components/Terminal.astro#default',
    Card: 'components/Card.astro#default',
    CardGrid: 'components/CardGrid.astro#default',
    Steps: 'components/Steps.astro#default',
    Tabs: 'components/Tabs.astro#default',
    FileTree: 'components/FileTree.astro#default',
    Badge: 'components/Badge.astro#default',
    ParamTable: 'components/ParamTable.astro#default',
    ComparisonTable: 'components/ComparisonTable.astro#default'
  },
  // Semantic tokens (accent/accentDark/fontBody/fontCode) are the config-overridable brand knobs;
  // fontDisplay is a theme-scoped extra exposed the same way (--font-display in tokens.css).
  //
  // DOCUMENTED ADAPTATIONS — production scaling of the mock (theme-spec-docstube.md), recorded
  // here because styles/global.css intentionally deviates from the exact mock/production values:
  // - Code: 13.5px/1.75 (the §4.6 production code row) instead of the mock's 12px/1.85 (§2.4);
  //   fence padding 14px 16px 16px and component-pre padding 10px 16px 16px instead of the
  //   mock's 12px 16px 16px, because the floating chrome row supplies the extra top spacing.
  // - Titles/article: H1 34px and H2 25px against §4.6's suggested 36px/26px, with main padding
  //   32px 40px 64px rather than 24px/28px — tuned to the widened 760px production measure so
  //   headings do not overpower the longer line length.
  // - Sidebar type: 13.5px nav rows and 11px group labels instead of the mock's 12.5px/10px
  //   (§1.4/§2.3), matching the production-widened 248px rail (§4.2) and 16px body size.
  tokens: {
    accent: '#0a818b',
    accentDark: '#36bebe',
    fontBody: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
    fontCode: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace",
    fontDisplay: "'Outfit', ui-sans-serif, system-ui, sans-serif"
  }
};
