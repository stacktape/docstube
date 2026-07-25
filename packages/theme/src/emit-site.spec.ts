import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { contentHash, contentHashSchema } from '@docstube/contracts';
import { emitSite } from './emit-site.ts';
import { buildFixtureInput, installMdx, setupMdx } from './emit-site-fixture.ts';

// The emitted frontmatter block, for tests that assert on it as YAML rather than as text.
const frontmatterOf = (route: string): string => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(route);
  if (match?.[1] === undefined) {
    throw new Error('route has no frontmatter block');
  }
  return match[1];
};

// Emits the fixture site with the install page carrying `frontmatter` as its authored block,
// rebinding the shard hash the way real persistence does so the route is not forced unverified.
const emitWithFrontmatter = async (frontmatter: string, label: string) => {
  const repoRoot = await mkdtemp(join(tmpdir(), `docstube-theme-fm-${label}-`));
  const input = buildFixtureInput(repoRoot);
  const install = input.pages[0]!;
  const mdx = `---\n${frontmatter}\n---\n\n${installMdx}`;
  input.pages[0] = {
    ...install,
    mdx,
    shard: { ...install.shard, mdxContentHash: contentHashSchema.parse(contentHash(mdx)) }
  };
  const result = await emitSite(input);
  const route = await readFile(join(repoRoot, 'docs-site/src/pages/getting-started/installation.mdx'), 'utf8');
  return { route, warnings: result.warnings };
};

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

  it('renders the literal claims chip and contradiction warning as kernel primitives', async () => {
    const chip = await readFile(join(siteRoot, 'src/docstube/DocstubeClaims.astro'), 'utf8');
    expect(chip).toContain('claims checked');
    expect(chip).toContain('data-docstube-claims-checked={checked}');
    expect(chip).not.toContain('"verified"');
    // DEFENSIVE RECOMPUTE (impl-24): the complete state is re-derived from the rendered numbers,
    // never taken on the `complete` flag's word alone.
    expect(chip).toContain(
      'const isComplete = complete === true && total > 0 && checked === total && uncovered === 0 && contradicted === 0;'
    );
    // HONEST BADGE SEMANTICS (impl-24, PRODUCT §1.2): the popover states what complete means and,
    // just as importantly, what it does not.
    expect(chip).toContain('title={chipTitle}');
    expect(chip).toContain("every claim in this page's ledger is checked");
    expect(chip).toContain('does not mean the page contains no unverified statement');
    const warning = await readFile(join(siteRoot, 'src/docstube/DocstubeContradictions.astro'), 'utf8');
    expect(warning).toContain('role="alert"');
    expect(warning).toContain('contradicted by the source');
    // Unchecked claims get their own quiet inline marks (impl-09 finding 2).
    expect(warning).toContain('dt-unchecked-claims');
    expect(warning).toContain("classList.add('dt-claim--unchecked')");
    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    expect(layout).toContain(
      '<DocstubeClaims checked={claimsChecked} total={claimsTotal} contradicted={claimsContradicted} uncovered={uncoveredAssertions} complete={claimsComplete} reviewedFor={reviewedFor} unverifiedPage={unverifiedPage} sourceFallback={sourceFallback} translationAssurance={translationAssurance} />'
    );
    expect(layout).toContain(
      '<DocstubeContradictions contradicted={claimsContradicted} markers={contradictedClaims} uncheckedMarkers={uncheckedClaims} />'
    );
  });

  it('writes one route per page at its nested slug path with injected frontmatter', async () => {
    const install = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(install).toContain('layout: "../../layouts/DocLayout.astro"');
    expect(install).toContain('title: "Installation"');
    // The fixture shard's ClaimEvidence has 1 checked claim of 2 — literal counts only; the
    // guarantee-label projection is gone (impl-07 finding 4).
    expect(install).not.toContain('docstubeGuarantee');
    expect(install).toContain('docstubeClaimsChecked: 1');
    expect(install).toContain('docstubeClaimsTotal: 2');
    expect(install).toContain('docstubeClaimsContradicted: 0');
    // The unchecked claim (c2) is individually marked inline (impl-09 finding 2).
    expect(install).toContain('docstubeUncheckedClaims: ["c2"]');
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

  it('locale routes inherit the CANONICAL proof: source shard counts/marks, never a 0/0-unverified locale projection', async () => {
    // The de shard carries no ledger of its own (renditions never do — i18n-lifecycle-v2 decision
    // 4): its proof derives from the SOURCE shard (1/2 checked, c2 unchecked), marker ids being
    // identical across renditions by strict isomorphism.
    const installDe = await readFile(join(siteRoot, 'src/pages/de/getting-started/installation.mdx'), 'utf8');
    expect(installDe).toContain('docstubeClaimsChecked: 1');
    expect(installDe).toContain('docstubeClaimsTotal: 2');
    expect(installDe).toContain('docstubeUncheckedClaims: ["c2"]');
    expect(installDe).not.toContain('docstubeUnverified');
    expect(installDe).not.toContain('docstubeSourceFallback');
  });

  it('contradicted markers mark the SAME ids in both locales — the canonical evidence decides everywhere', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-contra-locale-'));
    await emitSite(buildFixtureInput(repoRoot, { withTranslation: true, withContradiction: true }));
    const en = await readFile(join(repoRoot, 'docs-site/src/pages/getting-started/installation.mdx'), 'utf8');
    const de = await readFile(join(repoRoot, 'docs-site/src/pages/de/getting-started/installation.mdx'), 'utf8');
    for (const route of [en, de]) {
      expect(route).toContain('docstubeClaimsContradicted: 1');
      expect(route).toContain('docstubeContradictedClaims: ["c3"]');
      expect(route).toContain('docstubeClaimsTotal: 3');
    }
  });

  it('a source-fallback rendition serves the SOURCE bytes with the canonical proof and the fallback marker', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-fallback-'));
    const input = buildFixtureInput(repoRoot, { withTranslation: true });
    const translation = input.translations?.[0];
    if (translation === undefined) {
      throw new Error('fixture translation missing');
    }
    // A failed (re)translation: the locale shard persists HASHLESS and the caller passes the
    // SOURCE MDX as the fallback content (emit never reads a stale locale file).
    const { mdxContentHash: _dropped, ...hashlessShard } = translation.shard;
    input.translations = [{ shard: hashlessShard, mdx: installMdx, sourceFallback: true }];
    const result = await emitSite(input);
    expect(result.warnings).toEqual([]);
    const route = await readFile(join(repoRoot, 'docs-site/src/pages/de/getting-started/installation.mdx'), 'utf8');
    expect(route).toContain('docstubeSourceFallback: true');
    expect(route).toContain('docstubeLocale: "de"');
    expect(route).toContain('Install with npm.');
    expect(route).not.toContain('Installiere mit npm.');
    // Canonical proof rides along: the source shard's 1/2 checked state, not loud-unverified.
    expect(route).toContain('docstubeClaimsChecked: 1');
    expect(route).toContain('docstubeClaimsTotal: 2');
    expect(route).not.toContain('docstubeUnverified');
    // The chip primitive renders the visible not-yet-translated notice from the marker.
    const chip = await readFile(join(repoRoot, 'docs-site/src/docstube/DocstubeClaims.astro'), 'utf8');
    expect(chip).toContain('dt-source-fallback');
    expect(chip).toContain('Not yet translated');
    const layout = await readFile(join(repoRoot, 'docs-site/src/layouts/DocLayout.astro'), 'utf8');
    expect(layout).toContain('frontmatter.docstubeSourceFallback === true');
    expect(layout).toContain('sourceFallback={sourceFallback}');
  });

  it('locale section chips carry the LOCALE anchors positionally, with the canonical counts (impl-21 fix 3)', async () => {
    // The de shard's sections are the aligned rendition: same ids, translated titles, anchors
    // derived from the translated headings. The route's docstubeSections must reference THOSE
    // anchors (the ids that exist in the rendered locale HTML), while the claim counts stay the
    // canonical shard's — proof is language-independent, anchors are not.
    const installDe = await readFile(join(siteRoot, 'src/pages/de/getting-started/installation.mdx'), 'utf8');
    expect(installDe).toContain(
      '{anchor: "anforderungen", title: "Anforderungen", checked: 1, total: 1, contradicted: 0}'
    );
    expect(installDe).not.toContain('anchor: "requirements"');
    // The source route is unchanged: canonical anchors, canonical counts.
    const install = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(install).toContain('{anchor: "requirements", title: "Requirements", checked: 1, total: 1, contradicted: 0}');
  });

  it('a source-fallback rendition keeps the CANONICAL section anchors — it renders the source headings', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-fallback-anchors-'));
    const input = buildFixtureInput(repoRoot, { withTranslation: true });
    const translation = input.translations?.[0];
    if (translation === undefined) {
      throw new Error('fixture translation missing');
    }
    const { mdxContentHash: _dropped, ...hashlessShard } = translation.shard;
    input.translations = [{ shard: hashlessShard, mdx: installMdx, sourceFallback: true }];
    await emitSite(input);
    const route = await readFile(join(repoRoot, 'docs-site/src/pages/de/getting-started/installation.mdx'), 'utf8');
    // The fallback serves the SOURCE bytes, so the source anchors are the ones in the HTML.
    expect(route).toContain('anchor: "requirements"');
    expect(route).not.toContain('anchor: "anforderungen"');
  });

  it('injects locale alternates for translated pages only and renders the switcher + hreflang', async () => {
    const install = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(install).toContain('docstubeAlternates: ');
    expect(install).toContain('{locale: "en", href: "/getting-started/installation/"}');
    expect(install).toContain('{locale: "de", href: "/de/getting-started/installation/"}');
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

  it('injects per-page source citations and per-section claim-count chips', async () => {
    const install = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    // Block-level sources roll up into the page Sources footer (fixture page-level list is empty).
    expect(install).toContain('docstubeSources: ');
    expect(install).toContain('{file: "src/cli.ts", line: 1, endLine: 12');
    expect(install).toContain('docstubeSections: ');
    expect(install).toContain('{anchor: "requirements", title: "Requirements", checked: 1, total: 1, contradicted: 0}');

    const sourcesFooter = await readFile(join(siteRoot, 'src/docstube/DocstubeSources.astro'), 'utf8');
    expect(sourcesFooter).toContain('class="dt-sources"');
    expect(sourcesFooter).toContain('<h2>Sources</h2>');
    // Linkified only when repoUrl is set; plain text otherwise.
    expect(sourcesFooter).toContain('/blob/${source.commit}/${source.file}');
    const chipInjector = await readFile(join(siteRoot, 'src/docstube/DocstubeSectionChips.astro'), 'utf8');
    expect(chipInjector).toContain('dt-section-claims');
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

  it('MDX↔shard binding (matched pair): pages whose MDX matches the recorded hash render their trust state, no warnings', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-binding-ok-'));
    const result = await emitSite(buildFixtureInput(repoRoot));
    expect(result.warnings).toEqual([]);
    const route = await readFile(join(repoRoot, 'docs-site/src/pages/getting-started/installation.mdx'), 'utf8');
    expect(route).toContain('docstubeClaimsChecked: 1');
    expect(route).toContain('docstubeClaimsTotal: 2');
    expect(route).not.toContain('docstubeUnverified');
  });

  it('MDX↔shard binding (tampered): MDX edited after persistence renders the loud UNVERIFIED state — never stale counts', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-binding-tamper-'));
    const input = buildFixtureInput(repoRoot);
    const install = input.pages[0]!;
    input.pages[0] = { shard: install.shard, mdx: `${install.mdx}\nEdited after persistence.\n` };
    const result = await emitSite(input);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('does not match');
    expect(result.warnings[0]).toContain('getting-started/installation');
    const route = await readFile(join(repoRoot, 'docs-site/src/pages/getting-started/installation.mdx'), 'utf8');
    expect(route).toContain('docstubeUnverified: true');
    // Stale trust state must never accompany changed prose: counts zero, no inline marks.
    expect(route).toContain('docstubeClaimsChecked: 0');
    expect(route).toContain('docstubeClaimsTotal: 0');
    expect(route).not.toContain('docstubeUncheckedClaims');
    expect(route).not.toContain('docstubeContradictedClaims');
    // The untampered sibling page is unaffected.
    const setup = await readFile(join(repoRoot, 'docs-site/src/pages/guides/setup.mdx'), 'utf8');
    expect(result.warnings.some((warning) => warning.includes('guides/setup'))).toBe(false);
    expect(setup).toBeDefined();
  });

  it('MDX↔shard binding (missing hash): an old shard without mdxContentHash renders UNVERIFIED with a warning', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-binding-nohash-'));
    const input = buildFixtureInput(repoRoot);
    const install = input.pages[0]!;
    const { mdxContentHash: _dropped, ...bareShard } = install.shard;
    input.pages[0] = { shard: bareShard, mdx: install.mdx };
    const result = await emitSite(input);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('no mdxContentHash');
    const route = await readFile(join(repoRoot, 'docs-site/src/pages/getting-started/installation.mdx'), 'utf8');
    expect(route).toContain('docstubeUnverified: true');
    expect(route).toContain('docstubeClaimsChecked: 0');
  });

  // EMISSION IS A RECONCILER (impl-23 finding 2): writing the desired routes without removing the
  // ones that disappeared leaves deleted pages and old slugs fully renderable, serving prose and
  // proof that no current shard describes.
  it('prunes the route and the .md twin of a page that left the manifest', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-prune-removed-'));
    await emitSite(buildFixtureInput(repoRoot));
    const emitted = join(repoRoot, 'docs-site');
    await expect(stat(join(emitted, 'src/pages/guides/setup.mdx'))).resolves.toBeDefined();
    await expect(stat(join(emitted, 'public/guides/setup.md'))).resolves.toBeDefined();

    // The setup page is removed from the manifest; only installation remains.
    const second = buildFixtureInput(repoRoot);
    second.pages = second.pages.slice(0, 1);
    second.index = { ...second.index, pages: second.index.pages.slice(0, 1) };
    const result = await emitSite(second);

    await expect(stat(join(emitted, 'src/pages/guides/setup.mdx'))).rejects.toThrow(/ENOENT/u);
    await expect(stat(join(emitted, 'public/guides/setup.md'))).rejects.toThrow(/ENOENT/u);
    expect(result.pruned).toEqual(['public/guides/setup.md', 'src/pages/guides/setup.mdx']);
    // The surviving page is untouched, and nothing outside the route namespaces is considered.
    await expect(stat(join(emitted, 'src/pages/getting-started/installation.mdx'))).resolves.toBeDefined();
    await expect(stat(join(emitted, 'public/llms.txt'))).resolves.toBeDefined();
    await expect(stat(join(emitted, 'src/layouts/DocLayout.astro'))).resolves.toBeDefined();
  });

  it('a slug change leaves ONLY the new route — the old one never keeps serving', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-prune-slug-'));
    await emitSite(buildFixtureInput(repoRoot));
    const emitted = join(repoRoot, 'docs-site');
    await expect(stat(join(emitted, 'src/pages/guides/setup.mdx'))).resolves.toBeDefined();

    const renamed = buildFixtureInput(repoRoot);
    const setup = renamed.pages[1]!;
    renamed.pages[1] = { ...setup, shard: { ...setup.shard, page: { ...setup.shard.page, slug: 'guides/install' } } };
    renamed.index = {
      ...renamed.index,
      pages: renamed.index.pages.map((entry) =>
        entry.slug === 'guides/setup' ? { ...entry, slug: 'guides/install' } : entry
      )
    };
    const result = await emitSite(renamed);

    await expect(stat(join(emitted, 'src/pages/guides/install.mdx'))).resolves.toBeDefined();
    await expect(stat(join(emitted, 'public/guides/install.md'))).resolves.toBeDefined();
    await expect(stat(join(emitted, 'src/pages/guides/setup.mdx'))).rejects.toThrow(/ENOENT/u);
    await expect(stat(join(emitted, 'public/guides/setup.md'))).rejects.toThrow(/ENOENT/u);
    expect(result.pruned).toEqual(['public/guides/setup.md', 'src/pages/guides/setup.mdx']);
  });

  it('prunes an obsolete LOCALE route when the locale stops being emitted', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-prune-locale-'));
    await emitSite(buildFixtureInput(repoRoot, { withTranslation: true }));
    const emitted = join(repoRoot, 'docs-site');
    await expect(stat(join(emitted, 'src/pages/de/getting-started/installation.mdx'))).resolves.toBeDefined();

    const result = await emitSite(buildFixtureInput(repoRoot));
    await expect(stat(join(emitted, 'src/pages/de/getting-started/installation.mdx'))).rejects.toThrow(/ENOENT/u);
    expect(result.pruned).toContain('src/pages/de/getting-started/installation.mdx');
    expect(result.pruned).toContain('public/de/getting-started/installation.md');
  });

  it('prunes nothing on a repeat emit of the same manifest — idempotent reconciliation', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-prune-idempotent-'));
    await emitSite(buildFixtureInput(repoRoot));
    const result = await emitSite(buildFixtureInput(repoRoot));
    expect(result.pruned).toEqual([]);
  });

  // KERNEL-OWNED FRONTMATTER (impl-24 finding): the `docstube*` keys are computed from the
  // persisted trust spine. An artifact that declares one — a writer, a hand edit, a stale route
  // reused as source — must never get to decide the reader's badge.
  it('strips authored docstube* frontmatter: a declared docstubeClaimsComplete never survives', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-fm-'));
    const input = buildFixtureInput(repoRoot);
    const install = input.pages[0]!;
    const claimed = `---\ndocstubeClaimsComplete: true\ndocstubeClaimsChecked: 99\nkeywords:\n  - install\n---\n\n${installMdx}`;
    input.pages[0] = {
      ...install,
      mdx: claimed,
      shard: { ...install.shard, mdxContentHash: contentHashSchema.parse(contentHash(claimed)) }
    };
    await emitSite(input);
    const route = await readFile(join(repoRoot, 'docs-site/src/pages/getting-started/installation.mdx'), 'utf8');
    // The page is genuinely partial (1 of 2 claims checked), so the computed state is NOT complete.
    expect(route).not.toContain('docstubeClaimsComplete');
    // The authored count is replaced by the true one, and appears exactly once.
    expect(route).toContain('docstubeClaimsChecked: 1');
    expect(route).not.toContain('99');
    expect(route.match(/docstubeClaimsChecked/gu)?.length).toBe(1);
    // Authored frontmatter the kernel does not own is untouched.
    expect(route).toContain('keywords:');
    expect(route).toContain('- install');
  });

  // PARSED, NOT PATTERN-MATCHED (wave 2b close finding): the old line-scoped textual stripper only
  // recognized one spelling of a key. Every other ordinary YAML spelling of the SAME key walked
  // through it and could render a false editorial trust label on an unreviewed page.
  describe('kernel-owned frontmatter stripping is YAML-aware', () => {
    it.each([
      ['quoted', '"docstubeReviewedFor": "security"'],
      ['explicit-key', '? docstubeReviewedFor\n: security'],
      ['indented', '  docstubeReviewedFor: security\n  keywords:\n    - install'],
      ['mixed-case', 'DocstubeReviewedFor: security'],
      ['single-quoted-mixed-case', "'DOCSTUBEReviewedFor': security"]
    ])('strips an authored docstube* key written in %s form', async (label, frontmatter) => {
      const { route, warnings } = await emitWithFrontmatter(frontmatter, label);
      // The fixture's trust spine records no editorial review, so no reviewedFor key is computed —
      // any occurrence in the route came from the authored block.
      expect(route).not.toContain('ReviewedFor');
      expect(route).not.toContain('security');
      expect(warnings).toEqual([]);
    });

    it('leaves ordinary authored keys, their comments, and their formatting intact', async () => {
      const { route } = await emitWithFrontmatter(
        '# hand-written note\nkeywords:\n  - install\n  - npm\ndocstubeClaimsComplete: true\nsidebarOrder: 3',
        'survivors'
      );
      expect(route).toContain('# hand-written note');
      expect(route).toContain('keywords:');
      expect(route).toContain('  - install');
      expect(route).toContain('  - npm');
      expect(route).toContain('sidebarOrder: 3');
      expect(route).not.toContain('docstubeClaimsComplete');
    });

    it('does not inject a duplicate title when the authored key is QUOTED', async () => {
      const { route } = await emitWithFrontmatter('"title": Hand-written title', 'quoted-title');
      expect(route).toContain('"title": Hand-written title');
      // Exactly one top-level title key: the textual check used to miss the quoted spelling and
      // inject a second one, which is a YAML duplicate-key error at build time.
      expect(route.match(/^"?title"?\s*:/gmu)).toHaveLength(1);
    });

    // FAIL CLOSED: frontmatter the kernel cannot parse is frontmatter whose keys it cannot vet.
    it('warns and drops the whole authored block when the frontmatter cannot be parsed', async () => {
      const { route, warnings } = await emitWithFrontmatter(
        'docstubeReviewedFor: security\nkeywords: [install, npm\n  broken: "yes',
        'malformed'
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('/getting-started/installation/');
      expect(warnings[0]).toContain('could not be parsed');
      expect(route).not.toContain('ReviewedFor');
      expect(route).not.toContain('keywords');
      // The kernel-computed frontmatter is still complete, so the route still renders.
      expect(route).toContain('title: "Installation"');
      expect(route).toContain('docstubeClaimsChecked: 1');
    });
  });

  // ONE PARSE, ONE SERIALIZE (wave 2b close 2 finding): the kernel's keys are SET on the parsed
  // authored document, so the emitted block is a single internally consistent mapping. Appending
  // them as TEXT meant an authored flow root — ordinary, valid, Astro-legal YAML — was followed by
  // block lines and the route stopped parsing at build time.
  describe('kernel frontmatter is set through the Document API', () => {
    it('emits VALID yaml when the authored root is a flow mapping, keeping authored and kernel keys', async () => {
      const { route, warnings } = await emitWithFrontmatter('{ title: Docs, keywords: [install, npm] }', 'flow-root');
      expect(warnings).toEqual([]);
      const block = frontmatterOf(route);
      const parsedBack = parse(block) as Record<string, unknown>;
      // Authored keys survive with their authored values...
      expect(parsedBack.title).toBe('Docs');
      expect(parsedBack.keywords).toEqual(['install', 'npm']);
      // ...beside the kernel-computed ones, in one mapping the YAML parser accepts.
      expect(parsedBack.layout).toBe('../../layouts/DocLayout.astro');
      expect(parsedBack.docstubeClaimsChecked).toBe(1);
      expect(parsedBack.docstubeUncheckedClaims).toEqual(['c2']);
      // The authored title wins, and is not duplicated by the injected one.
      expect(block.match(/^title\s*:/gmu)).toHaveLength(1);
    });

    it('round-trips a nested flow value authored inside a block mapping', async () => {
      const { route, warnings } = await emitWithFrontmatter('keywords: [install, npm]\nsidebarOrder: 3', 'nested-flow');
      expect(warnings).toEqual([]);
      const parsedBack = parse(frontmatterOf(route)) as Record<string, unknown>;
      expect(parsedBack.keywords).toEqual(['install', 'npm']);
      expect(parsedBack.sidebarOrder).toBe(3);
      expect(parsedBack.docstubePageId).toMatch(/^pg/u);
    });

    it('every emitted route parses as a YAML mapping', async () => {
      const routes = [
        'src/pages/getting-started/installation.mdx',
        'src/pages/guides/setup.mdx',
        'src/pages/de/getting-started/installation.mdx'
      ];
      const parsedRoutes = await Promise.all(
        routes.map(async (route) => {
          const block = frontmatterOf(await readFile(join(siteRoot, route), 'utf8'));
          return [route, typeof parse(block)];
        })
      );
      expect(parsedRoutes).toEqual(routes.map((route) => [route, 'object']));
    });

    // FAIL CLOSED on constructs the kernel cannot vet by key name: a merge key or an alias INSERTS
    // pairs, so `<<: *base` can mint `docstubeReviewedFor` on an unreviewed page.
    it.each([
      ['merge-key', 'base: &base\n  docstubeReviewedFor: security\nkeywords: [install]\n<<: *base', 'merge key'],
      ['alias', 'base: &base security\ndocstubeReviewedFor: *base', 'anchor'],
      ['anchor', 'keywords: &kw [install]\nmore: *kw', 'anchor'],
      ['custom-tag', 'keywords: !custom [install]', 'tag']
    ])('fails closed on %s frontmatter, naming the route', async (label, frontmatter, expectedReason) => {
      const { route, warnings } = await emitWithFrontmatter(frontmatter, label);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('/getting-started/installation/');
      expect(warnings[0]).toContain('cannot vet');
      expect(warnings[0]?.toLowerCase()).toContain(expectedReason);
      // Nothing authored reaches the reader — including a merged trust label.
      expect(route).not.toContain('ReviewedFor');
      expect(route).not.toContain('security');
      expect(route).not.toContain('keywords');
      // The kernel-computed frontmatter is still injected, so the route still renders.
      expect(route).toContain('title: "Installation"');
      expect(route).toContain('docstubeClaimsChecked: 1');
      expect(parse(frontmatterOf(route))).toMatchObject({ docstubeClaimsTotal: 2 });
    });

    // COMMENT MIGRATION: the author's note lives on the pair BELOW it, so deleting a kernel-owned
    // key used to delete a comment that was written about the ordinary keys underneath.
    it('moves a comment above a deleted docstube key onto the next surviving key', async () => {
      const { route } = await emitWithFrontmatter(
        '# these keywords drive the sidebar\ndocstubeClaimsComplete: true\nkeywords:\n  - install',
        'comment-migration'
      );
      expect(route).toContain('# these keywords drive the sidebar');
      expect(route).not.toContain('docstubeClaimsComplete');
      const block = frontmatterOf(route);
      const commentLine = block.split('\n').findIndex((line) => line.includes('drive the sidebar'));
      const keywordsLine = block.split('\n').findIndex((line) => line.startsWith('keywords'));
      expect(commentLine).toBeGreaterThanOrEqual(0);
      expect(keywordsLine).toBe(commentLine + 1);
    });

    it('keeps a trailing comment when the deleted key was the last one', async () => {
      const { route } = await emitWithFrontmatter(
        'keywords:\n  - install\n# authored trailing note\ndocstubeReviewedFor: security',
        'comment-trailing'
      );
      expect(route).toContain('# authored trailing note');
      expect(route).not.toContain('ReviewedFor');
      expect(parse(frontmatterOf(route))).toMatchObject({ keywords: ['install'] });
    });
  });

  // LOCALE-PREFIX SLUG COLLISION (impl-24 finding): /de/foo is both "the German rendition of foo"
  // and "the page slugged de/foo"; whichever write lands last owns the route. Emission refuses to
  // plan such a tree rather than resolving it by accident.
  it('rejects a source slug whose first segment is a configured target locale', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-locale-slug-'));
    const input = buildFixtureInput(repoRoot, { withTranslation: true });
    const setup = input.pages[1]!;
    input.pages[1] = { ...setup, shard: { ...setup.shard, page: { ...setup.shard.page, slug: 'de/foo' } } };
    await expect(emitSite(input)).rejects.toMatchObject({ code: 'route-locale-collision' });
    await expect(emitSite(input)).rejects.toThrow(/slug "de\/foo".*"de" locale route namespace/su);
  });

  it('accepts the same slug when no such locale is configured — the collision needs both halves', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-locale-slug-ok-'));
    const input = buildFixtureInput(repoRoot);
    const setup = input.pages[1]!;
    input.pages[1] = { ...setup, shard: { ...setup.shard, page: { ...setup.shard.page, slug: 'de/foo' } } };
    await emitSite(input);
    await expect(stat(join(repoRoot, 'docs-site/src/pages/de/foo.mdx'))).resolves.toBeDefined();
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
