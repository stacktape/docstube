import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { emitSite } from '../../emit-site.ts';
import { buildFixtureInput } from '../../emit-site-fixture.ts';
import { guaranteeLabels } from '../../proof-source.ts';
import { themeBundle } from './bundle.generated.ts';

// Proof rendering is a conformance contract, not a theme choice (knowledge/design/theming.md):
// the fixture site emitted with the stacktape bundle must carry the kernel primitives, all three
// guarantee levels' visible labels, and the stable data attributes — same shape as the basic
// theme's proof-conformance.spec.ts. String-level assertions; building the site is CI's job.

describe('proof conformance (stacktape theme)', () => {
  let siteRoot: string;

  beforeAll(async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-stacktape-'));
    await emitSite({
      ...buildFixtureInput(repoRoot, { repoUrl: 'https://github.com/acme/fixture' }),
      theme: themeBundle
    });
    siteRoot = join(repoRoot, 'docs-site');
  });

  it('emits the kernel proof primitives under src/docstube/', async () => {
    for (const file of [
      'DocstubeGuarantee.astro',
      'DocstubeSources.astro',
      'DocstubeEntity.astro',
      'DocstubeSectionChips.astro',
      'DocstubeSearch.astro'
    ]) {
      expect(await readFile(join(siteRoot, 'src/docstube', file), 'utf8')).toContain('kernel-owned');
    }
  });

  it('renders all three guarantee levels with visible accessible labels', async () => {
    const badge = await readFile(join(siteRoot, 'src/docstube/DocstubeGuarantee.astro'), 'utf8');
    const chips = await readFile(join(siteRoot, 'src/docstube/DocstubeSectionChips.astro'), 'utf8');
    expect(Object.keys(guaranteeLabels).toSorted()).toEqual(['out-of-domain', 'proven', 'scored']);
    for (const label of Object.values(guaranteeLabels)) {
      expect(badge).toContain(`"${label}"`);
      expect(chips).toContain(`"${label}"`);
    }
  });

  it('stamps the stable data attributes on badge, chips, sources, and entity wrapper', async () => {
    const badge = await readFile(join(siteRoot, 'src/docstube/DocstubeGuarantee.astro'), 'utf8');
    expect(badge).toContain('data-docstube-guarantee={guarantee}');
    const entity = await readFile(join(siteRoot, 'src/docstube/DocstubeEntity.astro'), 'utf8');
    expect(entity).toContain('data-docstube-entity-id={entityId}');
    expect(entity).toContain('data-docstube-guarantee={guarantee}');
    const chips = await readFile(join(siteRoot, 'src/docstube/DocstubeSectionChips.astro'), 'utf8');
    expect(chips).toContain('chip.dataset.docstubeGuarantee = section.guarantee;');
    const sources = await readFile(join(siteRoot, 'src/docstube/DocstubeSources.astro'), 'utf8');
    expect(sources).toContain('data-docstube-sources');
  });

  it('links source citations in the sources primitive', async () => {
    const sources = await readFile(join(siteRoot, 'src/docstube/DocstubeSources.astro'), 'utf8');
    expect(sources).toContain('<h2>Sources</h2>');
    expect(sources).toContain('/blob/${source.commit}/${source.file}');
  });

  it('mounts every mandatory primitive in the theme layout', async () => {
    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    for (const mount of [
      '<DocstubeGuarantee',
      '<DocstubeSources',
      '<DocstubeSectionChips',
      '<DocstubeEntity',
      '<DocstubeSearch'
    ]) {
      expect(layout).toContain(mount);
    }
    // The entity wrapper receives the page identity injected by the kernel.
    expect(layout).toContain('entityId={frontmatter.docstubePageId}');
  });

  it('injects the page entity id and guarantee data into every generated route', async () => {
    const page = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(page).toMatch(/docstubePageId: "pg[_A-Za-z0-9-]+"/u);
    expect(page).toContain('docstubeGuarantee: "scored"');
    // Section chips cover the remaining level so all three appear in the emitted site data.
    expect(page).toContain('"guarantee":"proven"');
  });

  it('imports the kernel token sheet and honors the semantic tokens in the emitted styles', async () => {
    const css = await readFile(join(siteRoot, 'src/styles/global.css'), 'utf8');
    expect(css).toContain("@import '../docstube/tokens.css';");
    expect(css).toContain('var(--accent');
    expect(css).toContain('var(--font-body');
    expect(css).toContain('var(--font-code');
    const tokens = await readFile(join(siteRoot, 'src/docstube/tokens.css'), 'utf8');
    // The fixture config overrides accent; the theme's font tokens pass through.
    expect(tokens).toContain('--accent: #123456;');
    expect(tokens).toContain('--font-code: "Geist Mono"');
  });

  it('merges the theme dependency pins into the emitted package.json without kernel conflicts', async () => {
    const packageJson = JSON.parse(await readFile(join(siteRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies).toMatchObject({
      astro: '6.4.6',
      '@astrojs/mdx': '6.0.3',
      pagefind: '1.4.0',
      shiki: '4.3.1',
      '@shikijs/transformers': '4.3.1',
      tailwindcss: '4.3.1',
      '@tailwindcss/postcss': '4.3.1'
    });
  });

  it('wires the theme build hooks into the kernel-generated astro.config.mjs', async () => {
    const astroConfig = await readFile(join(siteRoot, 'astro.config.mjs'), 'utf8');
    expect(astroConfig).toContain("import themeIntegrations from './src/integrations.mjs';");
    expect(astroConfig).toContain("import themeShikiTransformers0 from './src/code/shiki-transformers.mjs';");
    expect(astroConfig).toContain('theme: "catppuccin-mocha",');
    expect(astroConfig).toContain('transformers: [...themeShikiTransformers0],');
  });
});

describe('stacktape theme bundle', () => {
  const paths = new Set(themeBundle.files.map((file) => file.path));

  it('is dark-only with the spec tokens', () => {
    expect(themeBundle.manifest.name).toBe('stacktape');
    expect(themeBundle.manifest.tokens.accent).toBe('#36BEBE');
    expect(themeBundle.manifest.tokens.accentDark).toBeUndefined();
    expect(themeBundle.manifest.tokens.fontBody).toContain('Geist');
    expect(themeBundle.manifest.tokens.fontCode).toContain('Geist Mono');
  });

  it('ships the mandatory layout, global styles, and layout islands', () => {
    expect(paths.has('src/layouts/DocLayout.astro')).toBe(true);
    expect(paths.has('src/styles/global.css')).toBe(true);
    expect(paths.has('src/components/Sidebar.tsx')).toBe(true);
    expect(paths.has('src/components/TableOfContents.tsx')).toBe(true);
  });

  it('resolves every manifest build hook and renderer to a real bundle path', () => {
    const build = themeBundle.manifest.build;
    expect(paths.has(`src/${build.globalStyleEntry}`)).toBe(true);
    expect(build.integrationsModule).toBeDefined();
    expect(paths.has(`src/${build.integrationsModule}`)).toBe(true);
    expect(build.shiki?.themes).toEqual(['catppuccin-mocha']);
    for (const transformer of build.shiki?.transformers ?? []) {
      expect(paths.has(`src/${transformer}`)).toBe(true);
    }
    for (const target of Object.values(themeBundle.manifest.renderers)) {
      const modulePath = target.includes('#') ? target.slice(0, target.indexOf('#')) : target;
      expect(paths.has(`src/${modulePath}`), `renderer module ${modulePath}`).toBe(true);
    }
  });

  it('embeds the Geist font files as valid base64 woff2 under public/fonts/', () => {
    const fontFiles = themeBundle.files.filter((file) => file.path.startsWith('public/fonts/'));
    expect(fontFiles.length).toBe(16);
    for (const family of ['geist', 'geist-mono']) {
      for (const weight of [400, 500, 600, 700]) {
        for (const subset of ['latin', 'latin-ext']) {
          expect(paths.has(`public/fonts/${family}-${weight}-${subset}.woff2`)).toBe(true);
        }
      }
    }
    for (const file of fontFiles) {
      expect('base64' in file, `${file.path} must be a base64 asset entry`).toBe(true);
      const bytes = Buffer.from((file as { base64: string }).base64, 'base64');
      expect(bytes.subarray(0, 4).toString('latin1'), `${file.path} woff2 magic`).toBe('wOF2');
    }
  });

  it('declares every font face in the global stylesheet', () => {
    const css = themeBundle.files.find((file) => file.path === 'src/styles/global.css');
    expect(css !== undefined && 'content' in css).toBe(true);
    const content = (css as { content: string }).content;
    for (const family of ['geist', 'geist-mono']) {
      for (const weight of [400, 500, 600, 700]) {
        expect(content).toContain(`/fonts/${family}-${weight}-latin.woff2`);
      }
    }
  });
});
