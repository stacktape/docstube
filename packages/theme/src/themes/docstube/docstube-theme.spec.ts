import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureInput } from '../../emit-site-fixture.ts';
import { emitSite } from '../../emit-site.ts';
import { themeBundle } from './bundle.generated.ts';
import { manifest } from './theme.ts';

// docstube-theme conformance: same contract as proof-conformance.spec.ts but emitted with the
// docstube bundle — the kernel primitives (literal claims chip, contradiction warning, per-claim
// marks) and the stable data attributes must survive this theme's layout. Plus bundle smoke
// checks for the theme's own contract: fonts embedded, dual shiki themes, dark-mode rail,
// semantic tokens.

const bundlePaths = new Set(themeBundle.files.map((file) => file.path));

const bundleText = (path: string): string => {
  const file = themeBundle.files.find((candidate) => candidate.path === path);
  if (!file || !('content' in file)) {
    throw new Error(`expected text bundle file at ${path}`);
  }
  return file.content;
};

describe('proof conformance (docstube theme)', () => {
  let siteRoot: string;

  beforeAll(async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-brand-theme-'));
    await emitSite({
      ...buildFixtureInput(repoRoot, { repoUrl: 'https://github.com/acme/fixture' }),
      theme: themeBundle
    });
    siteRoot = join(repoRoot, 'docs-site');
  });

  it('emits the kernel proof primitives under src/docstube/', async () => {
    for (const file of [
      'DocstubeClaims.astro',
      'DocstubeContradictions.astro',
      'DocstubeClaim.astro',
      'DocstubeSources.astro',
      'DocstubeEntity.astro',
      'DocstubeSectionChips.astro',
      'DocstubeSearch.astro'
    ]) {
      expect(await readFile(join(siteRoot, 'src/docstube', file), 'utf8')).toContain('kernel-owned');
    }
  });

  it('renders literal claim counts — the guarantee-label vocabulary is gone from the surface', async () => {
    const chip = await readFile(join(siteRoot, 'src/docstube/DocstubeClaims.astro'), 'utf8');
    const warning = await readFile(join(siteRoot, 'src/docstube/DocstubeContradictions.astro'), 'utf8');
    expect(chip).toContain('claims checked');
    expect(chip).toContain('reviewed for {reviewedFor}');
    expect(warning).toContain('contradicted by the source');
    for (const banned of ['proven', 'scored', 'out-of-domain', '"verified"', '"unverified"']) {
      expect(chip).not.toContain(banned);
      expect(warning).not.toContain(banned);
    }
  });

  it('mounts every mandatory primitive in the emitted layout', async () => {
    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    for (const mount of [
      '<DocstubeClaims',
      '<DocstubeContradictions',
      '<DocstubeSources',
      '<DocstubeSectionChips',
      '<DocstubeEntity',
      '<DocstubeSearch'
    ]) {
      expect(layout).toContain(mount);
    }
    expect(layout).toContain('entityId={frontmatter.docstubePageId}');
    // The unchecked marker list reaches the primitive alongside the contradicted one (impl-09).
    expect(layout).toContain('uncheckedMarkers={uncheckedClaims}');
  });

  it('styles the claim chips and contradiction surfaces without hiding the stable hooks', async () => {
    const css = await readFile(join(siteRoot, 'src/styles/global.css'), 'utf8');
    for (const selector of [
      '.dt-claims',
      '.dt-reviewed',
      '.dt-contradictions',
      '.dt-claim--contradicted',
      '.dt-claim--unchecked'
    ]) {
      expect(css).toContain(selector);
      expect(css).not.toMatch(new RegExp(`${selector.replaceAll('.', '\\.')}[^{]*\\{[^}]*display:\\s*none`, 'u'));
    }
  });

  it('injects the page entity id and literal claim counts into every generated route', async () => {
    const page = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(page).toMatch(/docstubePageId: "pg[_A-Za-z0-9-]+"/u);
    expect(page).not.toContain('docstubeGuarantee');
    expect(page).toContain('docstubeClaimsChecked: 1');
    expect(page).toContain('docstubeClaimsTotal: 2');
    expect(page).toContain('docstubeUncheckedClaims: ["c2"]');
    expect(page).toContain('"checked":1');
    // Astro components expose default exports, so renderer imports alias them by contract name.
    expect(page).toContain("import { default as Callout } from '../../components/Callout.astro';");
  });
});

describe('docstube theme bundle smoke', () => {
  it('declares the docstube manifest with kernel-compatible dependencies', () => {
    expect(manifest.name).toBe('docstube');
    expect(themeBundle.manifest).toBe(manifest);
    // No pins at all: nothing can conflict with the kernel's astro/@astrojs/mdx/pagefind pins.
    expect(manifest.dependencies).toEqual({});
  });

  it('ships the layout, global style entry, and every renderer module', () => {
    expect(bundlePaths.has('src/layouts/DocLayout.astro')).toBe(true);
    expect(bundlePaths.has(`src/${manifest.build.globalStyleEntry}`)).toBe(true);
    expect(Object.keys(manifest.renderers).toSorted()).toEqual([
      'Badge',
      'Callout',
      'Card',
      'CardGrid',
      'CodeBlock',
      'CodeGroup',
      'ComparisonTable',
      'FileTree',
      'ParamTable',
      'Steps',
      'Tabs',
      'Terminal'
    ]);
    for (const target of Object.values(manifest.renderers)) {
      expect(target.endsWith('.astro#default')).toBe(true);
      expect(bundlePaths.has(`src/${target.slice(0, target.indexOf('#'))}`)).toBe(true);
    }
  });

  it('embeds the self-hosted brand fonts as base64 assets', () => {
    const fontFiles = themeBundle.files.filter((file) => file.path.startsWith('public/fonts/'));
    expect(fontFiles.length).toBeGreaterThanOrEqual(18);
    for (const family of ['outfit-700-latin', 'inter-400-latin', 'jetbrains-mono-400-latin']) {
      const file = fontFiles.find((candidate) => candidate.path === `public/fonts/${family}.woff2`);
      expect(file?.path).toBe(`public/fonts/${family}.woff2`);
      expect(file && 'base64' in file && file.base64.length > 0).toBe(true);
    }
    const fontsCss = bundleText('src/styles/fonts.css');
    for (const family of ['Outfit', 'Inter', 'JetBrains Mono']) {
      expect(fontsCss).toContain(`font-family: '${family}'`);
    }
    expect(fontsCss).not.toContain('fonts.googleapis.com');
  });

  it('configures a light/dark shiki theme pair', () => {
    expect(manifest.build.shiki?.themes).toHaveLength(2);
    expect(manifest.build.shiki?.themes).toEqual(['vitesse-light', 'dark-plus']);
  });

  it('imports the kernel tokens and honors the semantic token contract in css', () => {
    const css = bundleText('src/styles/global.css');
    expect(css).toContain("@import '../docstube/tokens.css';");
    expect(css).toContain('var(--accent,');
    expect(css).toContain('var(--accent-dark,');
    expect(css).toContain('var(--font-body');
    expect(css).toContain('var(--font-code');
    // dp palette identity: light-default surfaces plus the charcoal-green dark island.
    expect(css).toContain('color-scheme: light');
    expect(css).toContain(":root[data-theme='dark']");
    expect(css).toContain('#161c1c');
    expect(manifest.tokens.accent).toBe('#0a818b');
    expect(manifest.tokens.accentDark).toBe('#36bebe');
  });

  it('ships the persisted theme rail and dark-mode boot script in the layout', () => {
    const layout = bundleText('src/layouts/DocLayout.astro');
    expect(layout).toContain('data-theme-rail');
    expect(layout).toContain("localStorage.getItem('docstube-theme')");
    expect(layout).toContain("localStorage.setItem('docstube-theme'");
    expect(layout).toContain('prefers-color-scheme: dark');
    // The signature bent TOC rail and the mobile drawer are part of the layout contract.
    expect(layout).toContain('data-toc-body');
    expect(layout).toContain('data-nav-toggle');
    expect(layout).toContain('data-search-modal');
  });

  it('uses AA-compliant status text variants while icons and fills keep the spec colors', () => {
    const css = bundleText('src/styles/global.css');
    for (const token of [
      '--status-proven-text: #0d7a50;',
      '--status-scored-text: #09727b;',
      '--status-flagged-text: #8f5a07;',
      '--status-danger-text: #b23a31;'
    ]) {
      expect(css).toContain(token);
    }
    expect(css).toMatch(/\.dt-reviewed \{[^}]*color: var\(--status-proven-text\)/u);
    expect(css).toMatch(/\.dt-reviewed::before \{[^}]*background: var\(--status-proven\)/u);
    expect(css).toMatch(/\.dt-badge--warning \{[^}]*color: var\(--status-flagged-text\)/u);
    expect(css).toMatch(/\.dt-badge--danger \{[^}]*color: var\(--status-danger-text\)/u);
  });

  it('traps and restores focus for the search modal and the mobile drawer', () => {
    const layout = bundleText('src/layouts/DocLayout.astro');
    expect(layout).toContain('const trapTab = (container, event) => {');
    expect(layout).toContain('if (searchReturnFocus instanceof HTMLElement) searchReturnFocus.focus();');
    expect(layout).toContain("if (event.key === 'Tab' && searchOpen && searchPanel) trapTab(searchPanel, event);");
    expect(layout).toContain("if (event.key === 'Escape' && drawerOpen()) closeDrawer();");
    expect(layout).toContain("if (event.key === 'Tab' && drawerOpen() && sidebar) trapTab(sidebar, event);");
  });

  it('renders Tabs and CodeGroup as keyboard-operable tablists', () => {
    const tabs = bundleText('src/components/Tabs.astro');
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('role="tabpanel"');
    expect(tabs).toContain('tabindex={tab.value === activeValue ? 0 : -1}');
    const layout = bundleText('src/layouts/DocLayout.astro');
    expect(layout).toContain("panel.setAttribute('role', 'tabpanel');");
    expect(layout).toContain("button.setAttribute('aria-controls', panelId);");
    expect(layout).toContain("if (event.key === 'ArrowRight' || event.key === 'ArrowDown')");
    expect(layout).toContain('other.tabIndex = other === button ? 0 : -1;');
  });

  it('builds the bent TOC rail from arbitrary h2-h6 depths', () => {
    const layout = bundleText('src/layouts/DocLayout.astro');
    expect(layout).toContain("article.querySelectorAll('h2[id], h3[id], h4[id], h5[id], h6[id]')");
    expect(layout).toContain(
      'const depths = headings.map((heading) => Number.parseInt(heading.tagName.slice(1), 10) - 2);'
    );
  });

  it('keeps header controls from colliding at intermediate widths', () => {
    const css = bundleText('src/styles/global.css');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);');
    expect(css).toMatch(/@media \(max-width: 1100px\) \{[\s\S]*?\.dt-search-trigger \{\s*width: min\(260px, 30vw\);/u);
  });
});
