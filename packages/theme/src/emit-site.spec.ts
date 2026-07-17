import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { emitSite } from './emit-site.ts';
import { buildFixtureInput, installMdx, setupMdx } from './emit-site-fixture.ts';

describe('emitSite', () => {
  let siteRoot: string;

  beforeAll(async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-emit-'));
    await emitSite(
      buildFixtureInput(repoRoot, {
        baseUrl: 'https://docs.example.test',
        repoUrl: 'https://github.com/acme/fixture',
        frozenVersions: ['1.0'],
        withTranslation: true
      })
    );
    siteRoot = join(repoRoot, 'docs-site');
  });

  it('writes a self-contained package.json without @docstube dependencies', async () => {
    const packageJson = JSON.parse(await readFile(join(siteRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(packageJson.dependencies.astro).toBeDefined();
    expect(packageJson.dependencies['@astrojs/mdx']).toBeDefined();
    expect(packageJson.dependencies['@astrojs/react']).toBeDefined();
    expect(packageJson.dependencies.react).toBeDefined();
    expect(Object.keys(packageJson.dependencies).some((name) => name.startsWith('@docstube/'))).toBe(false);
    expect(packageJson.scripts.build).toBe('astro build');
  });

  it('pins every generated-site dependency to an exact version', async () => {
    const packageJson = JSON.parse(await readFile(join(siteRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const [name, version] of Object.entries(packageJson.dependencies)) {
      expect(version, `${name} must be an exact pin`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('wires pagefind as an emitted-site dependency with a postbuild index step', async () => {
    const packageJson = JSON.parse(await readFile(join(siteRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(packageJson.dependencies.pagefind).toBeDefined();
    expect(packageJson.scripts.postbuild).toBe('pagefind --site dist');
    // Pagefind wiring is kernel-owned: the loader ships as a src/docstube primitive the theme mounts.
    const search = await readFile(join(siteRoot, 'src/docstube/DocstubeSearch.astro'), 'utf8');
    // Progressive enhancement: the UI loads /pagefind/pagefind-ui.js only when present.
    expect(search).toContain("script.src = '/pagefind/pagefind-ui.js';");
    expect(search).toContain('id="dt-search"');
    expect(search).toContain('script.onerror');
    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    expect(layout).toContain('<DocstubeSearch />');
  });

  it('applies design tokens (with defaults) in the kernel tokens.css and the footer credit in the layout', async () => {
    const tokens = await readFile(join(siteRoot, 'src/docstube/tokens.css'), 'utf8');
    expect(tokens).toContain('--accent: #123456;');
    expect(tokens).toContain('--surface: #ffffff;');
    expect(tokens).toContain('--text: #192122;');
    // Semantic tokens land as kebab-cased custom properties every theme maps onto.
    expect(tokens).toContain('--font-body: ');
    expect(tokens).toContain('--font-code: ');
    const styles = await readFile(join(siteRoot, 'src/styles/global.css'), 'utf8');
    expect(styles).toContain("@import '../docstube/tokens.css';");
    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    expect(layout).toContain('Docs by <a href="https://docstube.dev">docstube</a>');
  });

  it('generates astro.config.mjs from kernel invariants plus the theme build hooks', async () => {
    const astroConfig = await readFile(join(siteRoot, 'astro.config.mjs'), 'utf8');
    expect(astroConfig).toContain("import mdx from '@astrojs/mdx';");
    expect(astroConfig).toContain("import themeIntegrations from './src/integrations.mjs';");
    expect(astroConfig).toContain('integrations: [mdx(), ...themeIntegrations],');
    expect(astroConfig).toContain("output: 'static',");
  });

  it('writes the .docstube/theme-files.json ownership manifest over theme + kernel-config paths only', async () => {
    const manifest = JSON.parse(await readFile(join(siteRoot, '..', '.docstube/theme-files.json'), 'utf8')) as {
      theme: string;
      themeVersion: string;
      files: Array<{ path: string; hash: string }>;
    };
    expect(manifest.theme).toBe('basic');
    expect(manifest.themeVersion).toBe('0.0.2');
    const paths = manifest.files.map((file) => file.path);
    expect(paths).toContain('src/layouts/DocLayout.astro');
    expect(paths).toContain('src/components/theme-components.tsx');
    expect(paths).toContain('astro.config.mjs');
    expect(paths).toContain('package.json');
    // Content/kernel emissions are never theme-owned.
    expect(paths.some((path) => path.startsWith('src/pages/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('src/docstube/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('public/'))).toBe(false);
    expect(paths).not.toContain('src/site-data.mjs');
    for (const file of manifest.files) {
      expect(file.hash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('renders the guarantee badge as the kernel DocstubeGuarantee primitive with a blocks-proven title', async () => {
    const badge = await readFile(join(siteRoot, 'src/docstube/DocstubeGuarantee.astro'), 'utf8');
    expect(badge).toContain('dt-guarantee--${guarantee}');
    expect(badge).toContain('data-docstube-guarantee={guarantee}');
    expect(badge).toContain('"proven":"verified"');
    expect(badge).toContain('"scored":"reviewed"');
    expect(badge).toContain('"out-of-domain":"unverified"');
    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    expect(layout).toContain('<DocstubeGuarantee guarantee={guarantee} title={guaranteeTitle} />');
    expect(layout).toContain('blocks proven');
  });

  it('writes one route per page at its nested slug path with injected frontmatter', async () => {
    const install = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(install).toContain('layout: "../../layouts/DocLayout.astro"');
    expect(install).toContain('title: "Installation"');
    // The fixture page has 1 proven block out of 2 and rolls up to scored.
    expect(install).toContain('docstubeGuarantee: "scored"');
    expect(install).toContain('docstubeBlocksProven: 1');
    expect(install).toContain('docstubeBlocksTotal: 2');
    expect(install).toContain("from '../../components/theme-components.tsx'");
    expect(install).toContain('<Callout tone="info">');

    const setup = await readFile(join(siteRoot, 'src/pages/guides/setup.mdx'), 'utf8');
    // Original frontmatter is passed through, not duplicated.
    expect(setup).toContain('description: Fixture setup page.');
    expect(setup.match(/description/gu)?.length).toBe(1);
    expect(setup).toContain('title: "Setup guide"');
  });

  it('routes translations under /<locale>/<slug> with locale-aware layout paths', async () => {
    const installDe = await readFile(join(siteRoot, 'src/pages/de/getting-started/installation.mdx'), 'utf8');
    expect(installDe).toContain('layout: "../../../layouts/DocLayout.astro"');
    expect(installDe).toContain('title: "Installation (DE)"');
    expect(installDe).toContain('docstubeLocale: "de"');
    expect(installDe).toContain('Installiere mit npm.');
    // Raw markdown mirror for the translated route too.
    expect(await readFile(join(siteRoot, 'public/de/getting-started/installation.md'), 'utf8')).toContain(
      'Installiere mit npm.'
    );
  });

  it('injects locale alternates for translated pages only and renders the switcher + hreflang', async () => {
    const install = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(install).toContain('docstubeAlternates: ');
    expect(install).toContain('"locale":"en","href":"/getting-started/installation/"');
    expect(install).toContain('"locale":"de","href":"/de/getting-started/installation/"');
    // The setup page has no translation, so no alternates and no switcher.
    const setup = await readFile(join(siteRoot, 'src/pages/guides/setup.mdx'), 'utf8');
    expect(setup).not.toContain('docstubeAlternates');

    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    expect(layout).toContain('dt-locale-switcher');
    expect(layout).toContain('hreflang={alternate.locale}');
    expect(layout).toContain('hreflang="x-default"');
    // Translated routes navigate within their own locale.
    const siteData = await readFile(join(siteRoot, 'src/site-data.mjs'), 'utf8');
    expect(siteData).toContain('navByLocale');
    expect(siteData).toContain('"/de/getting-started/installation/"');
    expect(siteData).toContain('Installation (DE)');
  });

  it('renders the version switcher only when frozen versions are passed', async () => {
    const siteData = await readFile(join(siteRoot, 'src/site-data.mjs'), 'utf8');
    expect(siteData).toContain('"current":"latest"');
    expect(siteData).toContain('"frozen":["1.0"]');
    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    expect(layout).toContain('dt-version-switcher');
    expect(layout).toContain('versions.frozen.length > 0');
    expect(layout).toContain('/versions/${label}/');

    const bareRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-nofrozen-'));
    await emitSite(buildFixtureInput(bareRoot));
    const bareData = await readFile(join(bareRoot, 'docs-site/src/site-data.mjs'), 'utf8');
    expect(bareData).toContain('"frozen":[]');
  });

  it('injects per-page source citations and per-section guarantee chips', async () => {
    const install = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    // Block-level sources roll up into the page Sources footer (fixture page-level list is empty).
    expect(install).toContain('docstubeSources: ');
    expect(install).toContain('"file":"src/cli.ts","line":1,"endLine":12');
    expect(install).toContain('docstubeSections: ');
    expect(install).toContain('"anchor":"requirements","title":"Requirements","guarantee":"proven"');

    const sourcesFooter = await readFile(join(siteRoot, 'src/docstube/DocstubeSources.astro'), 'utf8');
    expect(sourcesFooter).toContain('class="dt-sources"');
    expect(sourcesFooter).toContain('<h2>Sources</h2>');
    // Linkified only when repoUrl is set; plain text otherwise.
    expect(sourcesFooter).toContain('/blob/${source.commit}/${source.file}');
    const chipInjector = await readFile(join(siteRoot, 'src/docstube/DocstubeSectionChips.astro'), 'utf8');
    expect(chipInjector).toContain('dt-section-guarantees');
    expect(chipInjector).toContain('dt-section-chip');
    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    expect(layout).toContain('<DocstubeSources sources={sources} repoUrl={repoUrl} />');
    expect(layout).toContain('<DocstubeSectionChips sections={sections} />');
    const siteData = await readFile(join(siteRoot, 'src/site-data.mjs'), 'utf8');
    expect(siteData).toContain('export const repoUrl = "https://github.com/acme/fixture";');
  });

  it('vendors the theme components module', async () => {
    const components = await readFile(join(siteRoot, 'src/components/theme-components.tsx'), 'utf8');
    for (const name of ['Callout', 'CodeBlock', 'Tabs', 'FileTree', 'Badge', 'ParamTable']) {
      expect(components).toContain(`export function ${name}(`);
    }
  });

  it('emits llms.txt and llms-full.txt from the source locale only', async () => {
    const llms = await readFile(join(siteRoot, 'public/llms.txt'), 'utf8');
    expect(llms).toContain('# Fixture Docs');
    expect(llms).toContain('- [Installation](/getting-started/installation/)');
    expect(llms).toContain('- [Setup guide](/guides/setup/)');
    expect(llms).not.toContain('/de/');

    const llmsFull = await readFile(join(siteRoot, 'public/llms-full.txt'), 'utf8');
    expect(llmsFull).toContain('## Setup guide');
    expect(llmsFull).toContain('Some setup prose.');
    expect(llmsFull).toContain('Install with npm.');
    expect(llmsFull).not.toContain('Installiere mit npm.');
    // Frontmatter is stripped from concatenated bodies.
    expect(llmsFull).not.toContain('description: Fixture setup page.');
  });

  it('mirrors raw markdown at every doc URL', async () => {
    expect(await readFile(join(siteRoot, 'public/getting-started/installation.md'), 'utf8')).toBe(installMdx);
    expect(await readFile(join(siteRoot, 'public/guides/setup.md'), 'utf8')).toBe(setupMdx);
  });

  it('emits the docs MCP server with its site index and README', async () => {
    const server = await readFile(join(siteRoot, 'mcp/docs-mcp-server.mjs'), 'utf8');
    expect(server).toContain("name: 'read_wiki_structure'");
    expect(server).toContain("name: 'read_wiki_contents'");
    expect(server).toContain("name: 'ask_question'");
    // Self-contained: node builtins only.
    expect(server).not.toMatch(/from '(?!node:)/u);

    const siteIndex = JSON.parse(await readFile(join(siteRoot, 'mcp/site-index.json'), 'utf8')) as {
      site: string;
      pages: Array<{ slug: string; url: string }>;
    };
    expect(siteIndex.site).toBe('Fixture Docs');
    expect(siteIndex.pages.map((page) => page.slug)).toEqual(['getting-started/installation', 'guides/setup']);

    const readme = await readFile(join(siteRoot, 'mcp/README.md'), 'utf8');
    expect(readme).toContain('node mcp/docs-mcp-server.mjs --port 3333');
  });

  it('writes sitemap.xml (including translated routes) and robots.txt when baseUrl is set', async () => {
    const sitemap = await readFile(join(siteRoot, 'public/sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://docs.example.test/guides/setup/</loc>');
    expect(sitemap).toContain('<loc>https://docs.example.test/de/getting-started/installation/</loc>');
    const robots = await readFile(join(siteRoot, 'public/robots.txt'), 'utf8');
    expect(robots).toContain('Sitemap: https://docs.example.test/sitemap.xml');
  });

  it('omits sitemap.xml and robots.txt without a baseUrl', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-nobase-'));
    await emitSite(buildFixtureInput(repoRoot));
    const bareRoot = join(repoRoot, 'docs-site');
    await expect(stat(join(bareRoot, 'public/sitemap.xml'))).rejects.toThrow(/ENOENT/u);
    await expect(stat(join(bareRoot, 'public/robots.txt'))).rejects.toThrow(/ENOENT/u);
    const astroConfig = await readFile(join(bareRoot, 'astro.config.mjs'), 'utf8');
    expect(astroConfig).not.toContain('site:');
  });
});
