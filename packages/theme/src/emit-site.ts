import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DocstubeConfig, ManifestIndex, PageEntity, PageShard, SourceRef } from '@docstube/contracts';
import { builtinComponentNames } from './components.ts';
import { docsMcpReadmeMd, docsMcpServerMjs } from './mcp-server-source.ts';

// Emits a fully self-contained Astro site: generated sites vendor everything they need and never
// depend on a @docstube/* package at runtime (ARCHITECTURE.md §2). The site builds with plain
// `npm install && npm run build`.

export type EmitSitePage = {
  shard: PageShard;
  mdx: string;
};

export type EmitSiteInput = {
  repoRoot: string;
  // Repo-relative output directory for the generated site, e.g. 'docs-site'.
  outDir: string;
  config: DocstubeConfig;
  index: ManifestIndex;
  // Source-locale pages, routed at /<slug>.
  pages: EmitSitePage[];
  // Target-locale shards (same page ids/slugs, different locale), routed at /<locale>/<slug>.
  translations?: EmitSitePage[];
  // Labels of frozen versions (ManifestIndex.versions with status 'frozen'). Renders the version
  // switcher only; emitting the frozen snapshots' content under /versions/<label>/ is a later
  // wave — the manifest shards exist but their MDX may not have been generated yet.
  frozenVersions?: string[];
  // Public URL of the source repository (e.g. https://github.com/acme/widget). When set, source
  // citations link to <repoUrl>/blob/<commit>/<file>#L<line>; plain text otherwise.
  repoUrl?: string;
};

// Design-token defaults; config.theme.tokens entries override or extend these.
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

const generatedSiteDependencies = {
  '@astrojs/mdx': '^6.0.3',
  '@astrojs/react': '^5.0.7',
  astro: '^6.4.6',
  // Baseline static search (PRODUCT §4.1); indexes dist/ in the postbuild step.
  pagefind: '^1.4.0',
  react: '^19.2.7',
  'react-dom': '^19.2.7'
} as const;

type NavEntry = { label: string; href: string };
type NavGroup = { label: string | null; entries: NavEntry[] };
type LocaleAlternate = { locale: string; href: string };

const slugToHref = (slug: string): string => (slug === 'index' ? '/' : `/${slug}/`);

const localeHref = (slug: string, locale: string, sourceLocale: string): string =>
  locale === sourceLocale ? slugToHref(slug) : `/${locale}${slugToHref(slug)}`;

const humanizeSegment = (segment: string): string =>
  segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const buildNav = (index: ManifestIndex, hrefPrefix: string, titleBySlug?: Map<string, string>): NavGroup[] => {
  const groups: NavGroup[] = [];
  const byLabel = new Map<string | null, NavGroup>();
  const groupFor = (label: string | null): NavGroup => {
    const existing = byLabel.get(label);
    if (existing) {
      return existing;
    }
    const group: NavGroup = { label, entries: [] };
    byLabel.set(label, group);
    groups.push(group);
    return group;
  };
  for (const page of index.pages) {
    const segments = page.slug.split('/');
    const first = segments[0];
    const label = segments.length > 1 && first !== undefined ? humanizeSegment(first) : null;
    groupFor(label).entries.push({
      label: titleBySlug?.get(page.slug) ?? page.title,
      href: `${hrefPrefix}${slugToHref(page.slug)}`
    });
  }
  return groups;
};

// One nav per locale so translated routes link within their own locale, using translated page
// titles where the translation shard provides them.
const buildNavByLocale = (
  index: ManifestIndex,
  sourceLocale: string,
  translations: EmitSitePage[]
): Record<string, NavGroup[]> => {
  const navByLocale: Record<string, NavGroup[]> = { [sourceLocale]: buildNav(index, '') };
  const titlesByLocale = new Map<string, Map<string, string>>();
  for (const translation of translations) {
    const locale = translation.shard.locale;
    const titles = titlesByLocale.get(locale) ?? new Map<string, string>();
    titles.set(translation.shard.page.slug, translation.shard.page.title);
    titlesByLocale.set(locale, titles);
  }
  for (const [locale, titles] of titlesByLocale) {
    navByLocale[locale] = buildNav(index, `/${locale}`, titles);
  }
  return navByLocale;
};

// slug -> alternates across locales, source locale first. Only slugs with at least one
// translation get target entries; single-locale pages render no switcher.
const buildAlternatesBySlug = (
  pages: EmitSitePage[],
  translations: EmitSitePage[],
  sourceLocale: string
): Map<string, LocaleAlternate[]> => {
  const alternates = new Map<string, LocaleAlternate[]>();
  for (const page of pages) {
    const slug = page.shard.page.slug;
    alternates.set(slug, [{ locale: sourceLocale, href: slugToHref(slug) }]);
  }
  for (const translation of translations) {
    const slug = translation.shard.page.slug;
    const locale = translation.shard.locale;
    const existing = alternates.get(slug) ?? [{ locale: sourceLocale, href: slugToHref(slug) }];
    if (!existing.some((alternate) => alternate.locale === locale)) {
      existing.push({ locale, href: localeHref(slug, locale, sourceLocale) });
    }
    alternates.set(slug, existing);
  }
  return alternates;
};

const splitFrontmatter = (mdx: string): { frontmatter: string; body: string } => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(mdx);
  const frontmatter = match?.[1];
  if (!match || frontmatter === undefined) {
    return { frontmatter: '', body: mdx };
  }
  return { frontmatter, body: mdx.slice(match[0].length) };
};

const frontmatterHasKey = (frontmatter: string, key: string): boolean =>
  new RegExp(`^${key}\\s*:`, 'mu').test(frontmatter);

const blockGuaranteeCounts = (page: PageEntity): { proven: number; total: number } => {
  const blocks = [...page.preamble, ...page.sections.flatMap((section) => section.blocks)];
  return {
    proven: blocks.filter((block) => block.guarantee === 'proven').length,
    total: blocks.length
  };
};

// Visible per-entity citations (PRODUCT §3.2): page-level sources plus every block- and
// claim-level source on the page, deduplicated, rendered by the layout as the Sources footer.
const collectPageSources = (page: PageEntity): SourceRef[] => {
  const seen = new Set<string>();
  const sources: SourceRef[] = [];
  const add = (refs: SourceRef[]) => {
    for (const ref of refs) {
      const key = `${ref.file}:${ref.span?.join('-') ?? ''}:${ref.commit}`;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push(ref);
      }
    }
  };
  add(page.provenance.sources);
  const blocks = [...page.preamble, ...page.sections.flatMap((section) => section.blocks)];
  for (const block of blocks) {
    add(block.provenance.sources);
    for (const claim of block.claims) {
      add(claim.provenance?.sources ?? []);
    }
  }
  return sources;
};

type SectionChip = { anchor: string; title: string; guarantee: string };

const sectionChips = (page: PageEntity): SectionChip[] =>
  page.sections.map((section) => ({ anchor: section.anchor, title: section.title, guarantee: section.guarantee }));

type PageRouteContext = {
  sourceLocale: string;
  alternatesBySlug: Map<string, LocaleAlternate[]>;
};

const pageRouteMdx = (page: EmitSitePage, context: PageRouteContext): string => {
  const { frontmatter, body } = splitFrontmatter(page.mdx);
  const locale = page.shard.locale;
  const isSourceLocale = locale === context.sourceLocale;
  const slug = page.shard.page.slug;
  const depth = slug.split('/').length + (isSourceLocale ? 0 : 1);
  const up = '../'.repeat(depth);
  const counts = blockGuaranteeCounts(page.shard.page);
  const alternates = context.alternatesBySlug.get(slug) ?? [];
  const sources = collectPageSources(page.shard.page).map((ref) => ({
    file: ref.file,
    ...(ref.span === undefined ? {} : { line: ref.span[0], endLine: ref.span[1] }),
    commit: ref.commit
  }));
  const chips = sectionChips(page.shard.page);
  const injected = [
    `layout: ${JSON.stringify(`${up}layouts/DocLayout.astro`)}`,
    ...(frontmatterHasKey(frontmatter, 'title') ? [] : [`title: ${JSON.stringify(page.shard.page.title)}`]),
    ...(page.shard.page.description !== undefined && !frontmatterHasKey(frontmatter, 'description')
      ? [`description: ${JSON.stringify(page.shard.page.description)}`]
      : []),
    `docstubeLocale: ${JSON.stringify(locale)}`,
    `docstubeGuarantee: ${JSON.stringify(page.shard.page.guarantee)}`,
    `docstubeBlocksProven: ${counts.proven}`,
    `docstubeBlocksTotal: ${counts.total}`,
    // JSON is valid YAML flow syntax, so these round-trip through Astro's frontmatter parser.
    ...(alternates.length > 1 ? [`docstubeAlternates: ${JSON.stringify(alternates)}`] : []),
    ...(sources.length > 0 ? [`docstubeSources: ${JSON.stringify(sources)}`] : []),
    ...(chips.length > 0 ? [`docstubeSections: ${JSON.stringify(chips)}`] : [])
  ];
  return [
    '---',
    ...(frontmatter === '' ? [] : [frontmatter.trimEnd()]),
    ...injected,
    '---',
    '',
    // Writer MDX must not import theme components itself — this line puts them all in scope.
    `import { ${builtinComponentNames.join(', ')} } from '${up}components/theme-components.tsx';`,
    '',
    body.trimEnd(),
    ''
  ].join('\n');
};

const generatedSitePackageJson = (): string =>
  `${JSON.stringify(
    {
      name: 'docstube-generated-site',
      private: true,
      type: 'module',
      scripts: {
        dev: 'astro dev',
        build: 'astro build',
        // Pagefind indexes the built site; the search UI degrades gracefully when it never ran.
        postbuild: 'pagefind --site dist',
        preview: 'astro preview'
      },
      dependencies: generatedSiteDependencies
    },
    null,
    2
  )}\n`;

const astroConfigMjs = (config: DocstubeConfig): string =>
  [
    "import mdx from '@astrojs/mdx';",
    "import react from '@astrojs/react';",
    "import { defineConfig } from 'astro/config';",
    '',
    '// TODO(review-ui): rehype plugin slot — a `markdown.processor` rehype plugin will inject',
    '// data-entity-id attributes on arbitrary blocks from the manifest sidecar (ARCHITECTURE.md',
    '// §3.4). Section-level guarantee chips already ship (injected by the layout by anchor);',
    '// block-level addressing is deliberately not faked in v1.',
    'export default defineConfig({',
    '  integrations: [mdx(), react()],',
    "  output: 'static',",
    ...(config.site.baseUrl === undefined ? [] : [`  site: ${JSON.stringify(config.site.baseUrl)},`]),
    '});',
    ''
  ].join('\n');

type SiteDataInput = {
  config: DocstubeConfig;
  navByLocale: Record<string, NavGroup[]>;
  currentVersion: string;
  frozenVersions: string[];
  repoUrl: string | undefined;
};

const siteDataMjs = (input: SiteDataInput): string =>
  [
    `export const siteTitle = ${JSON.stringify(input.config.site.title)};`,
    `export const siteDescription = ${JSON.stringify(input.config.site.description)};`,
    `export const siteUrl = ${JSON.stringify(input.config.site.baseUrl ?? null)};`,
    `export const layoutMode = ${JSON.stringify(input.config.site.layout)};`,
    `export const footerCredit = ${JSON.stringify(input.config.site.footerCredit)};`,
    `export const sourceLocale = ${JSON.stringify(input.config.locales.source)};`,
    `export const repoUrl = ${JSON.stringify(input.repoUrl ?? null)};`,
    // Frozen labels link to /versions/<label>/; emitting frozen snapshot content is pending.
    `export const versions = ${JSON.stringify({ current: input.currentVersion, frozen: input.frozenVersions })};`,
    `export const navByLocale = ${JSON.stringify(input.navByLocale, null, 2)};`,
    ''
  ].join('\n');

const tokenCssLines = (config: DocstubeConfig): string[] => {
  const tokens = { ...defaultThemeTokens, ...config.theme.tokens };
  return Object.entries(tokens).map(([name, value]) => `    --${name}: ${value};`);
};

const docLayoutAstro = (config: DocstubeConfig): string =>
  [
    '---',
    'import {',
    '  footerCredit,',
    '  layoutMode,',
    '  navByLocale,',
    '  repoUrl,',
    '  siteDescription,',
    '  siteTitle,',
    '  siteUrl,',
    '  sourceLocale,',
    '  versions',
    "} from '../site-data.mjs';",
    '',
    'const { frontmatter } = Astro.props;',
    'const title = frontmatter.title ? `${frontmatter.title} | ${siteTitle}` : siteTitle;',
    'const description = frontmatter.description || siteDescription;',
    'const canonicalUrl = siteUrl ? new URL(Astro.url.pathname, siteUrl).href : undefined;',
    'const guarantee = frontmatter.docstubeGuarantee;',
    "const guaranteeLabels = { proven: 'verified', scored: 'reviewed', 'out-of-domain': 'unverified' };",
    'const guaranteeTitle = `${frontmatter.docstubeBlocksProven ?? 0} of ${frontmatter.docstubeBlocksTotal ?? 0} blocks proven`;',
    'const locale = frontmatter.docstubeLocale ?? sourceLocale;',
    'const alternates = frontmatter.docstubeAlternates ?? [];',
    'const sourceAlternate = alternates.find((alternate) => alternate.locale === sourceLocale);',
    'const sources = frontmatter.docstubeSources ?? [];',
    'const sections = frontmatter.docstubeSections ?? [];',
    'const nav = navByLocale[locale] ?? navByLocale[sourceLocale] ?? [];',
    'const sourceHref = (source) =>',
    '  repoUrl',
    "    ? `${repoUrl.replace(/\\/$/, '')}/blob/${source.commit}/${source.file}${source.line ? `#L${source.line}` : ''}`",
    '    : undefined;',
    '---',
    '',
    '<!doctype html>',
    '<html lang={locale} data-layout={layoutMode}>',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <title>{title}</title>',
    '    {description ? <meta name="description" content={description} /> : null}',
    '    {canonicalUrl ? <link rel="canonical" href={canonicalUrl} /> : null}',
    '    {',
    '      siteUrl && alternates.length > 1',
    '        ? alternates.map((alternate) => (',
    '            <link rel="alternate" hreflang={alternate.locale} href={new URL(alternate.href, siteUrl).href} />',
    '          ))',
    '        : null',
    '    }',
    '    {',
    '      siteUrl && alternates.length > 1 && sourceAlternate ? (',
    '        <link rel="alternate" hreflang="x-default" href={new URL(sourceAlternate.href, siteUrl).href} />',
    '      ) : null',
    '    }',
    '    <meta property="og:title" content={title} />',
    '    {description ? <meta property="og:description" content={description} /> : null}',
    '    {canonicalUrl ? <meta property="og:url" content={canonicalUrl} /> : null}',
    '    <meta property="og:type" content="article" />',
    '  </head>',
    '  <body>',
    '    <a class="skip-link" href="#content">Skip to content</a>',
    '    <div class="site-shell">',
    '      <aside class="site-nav" aria-label="Documentation">',
    '        <strong>{siteTitle}</strong>',
    "        {/* TODO(sectioned): the 'sectioned' layout renders top-level groups as sidebar section",
    '            headers for now; the per-section tab bar is a follow-up. */}',
    '        {nav.map((group) => (',
    '          <section class="nav-group">',
    '            {group.label ? <p class="nav-group-label">{group.label}</p> : null}',
    '            <nav>',
    '              {group.entries.map((entry) => (',
    "                <a href={entry.href} aria-current={Astro.url.pathname === entry.href ? 'page' : undefined}>",
    '                  {entry.label}',
    '                </a>',
    '              ))}',
    '            </nav>',
    '          </section>',
    '        ))}',
    '      </aside>',
    '      <main id="content" class="content">',
    '        <header class="site-toolbar">',
    '          <div id="dt-search" class="dt-search"></div>',
    '          {versions.frozen.length > 0 ? (',
    '            <details class="dt-version-switcher">',
    '              <summary>{versions.current}</summary>',
    '              <nav aria-label="Versions">',
    '                <a href="/">{versions.current}</a>',
    '                {/* Frozen snapshot content emission is pending; these routes land in a later wave. */}',
    '                {versions.frozen.map((label) => (',
    '                  <a href={`/versions/${label}/`}>{label}</a>',
    '                ))}',
    '              </nav>',
    '            </details>',
    '          ) : null}',
    '          {alternates.length > 1 ? (',
    '            <nav class="dt-locale-switcher" aria-label="Language">',
    '              {alternates.map((alternate) => (',
    "                <a href={alternate.href} aria-current={alternate.locale === locale ? 'true' : undefined}>",
    '                  {alternate.locale}',
    '                </a>',
    '              ))}',
    '            </nav>',
    '          ) : null}',
    '          {guarantee ? (',
    '            <span class={`dt-guarantee dt-guarantee--${guarantee}`} title={guaranteeTitle}>',
    '              {guaranteeLabels[guarantee] ?? guarantee}',
    '            </span>',
    '          ) : null}',
    '        </header>',
    '        <slot />',
    '        {sources.length > 0 ? (',
    '          <footer class="dt-sources">',
    '            <h2>Sources</h2>',
    '            <ul>',
    '              {sources.map((source) => {',
    '                const label = source.line ? `${source.file}:${source.line}` : source.file;',
    '                const href = sourceHref(source);',
    '                return (',
    '                  <li>',
    '                    {href ? (',
    '                      <a href={href}>',
    '                        <code>{label}</code>',
    '                      </a>',
    '                    ) : (',
    '                      <code>{label}</code>',
    '                    )}',
    '                    <span class="dt-source-commit">@{source.commit.slice(0, 7)}</span>',
    '                  </li>',
    '                );',
    '              })}',
    '            </ul>',
    '          </footer>',
    '        ) : null}',
    '        {footerCredit ? (',
    '          <footer class="site-footer">Docs by <a href="https://docstube.dev">docstube</a></footer>',
    '        ) : null}',
    '      </main>',
    '    </div>',
    '    {sections.length > 0 ? (',
    '      <script type="application/json" id="dt-section-guarantees" set:html={JSON.stringify(sections)} />',
    '    ) : null}',
    '    <script is:inline>',
    '      // Section guarantee chips: headings get github-slugger ids from Astro, matching the',
    '      // section anchors in the manifest. Progressive enhancement — missing anchors no-op.',
    '      (() => {',
    "        const data = document.getElementById('dt-section-guarantees');",
    '        if (!data) return;',
    "        const labels = { proven: 'verified', scored: 'reviewed', 'out-of-domain': 'unverified' };",
    '        for (const section of JSON.parse(data.textContent)) {',
    '          const heading = document.getElementById(section.anchor);',
    '          if (!heading) continue;',
    "          const chip = document.createElement('span');",
    "          chip.className = 'dt-guarantee dt-section-chip dt-guarantee--' + section.guarantee;",
    '          chip.textContent = labels[section.guarantee] ?? section.guarantee;',
    "          heading.append(' ', chip);",
    '        }',
    '      })();',
    '    </script>',
    '    <script is:inline>',
    '      // Pagefind search: progressive enhancement. The UI assets exist only after the pagefind',
    '      // postbuild step ran; when absent (astro dev, or postbuild skipped) the site still works.',
    '      (() => {',
    "        const container = document.getElementById('dt-search');",
    '        if (!container) return;',
    "        const stylesheet = document.createElement('link');",
    "        stylesheet.rel = 'stylesheet';",
    "        stylesheet.href = '/pagefind/pagefind-ui.css';",
    "        const script = document.createElement('script');",
    "        script.src = '/pagefind/pagefind-ui.js';",
    '        script.onload = () => {',
    "          new PagefindUI({ element: '#dt-search', showSubResults: true });",
    '        };',
    '        script.onerror = () => {',
    '          stylesheet.remove();',
    '          script.remove();',
    '        };',
    '        document.head.append(stylesheet, script);',
    '      })();',
    '    </script>',
    '  </body>',
    '</html>',
    '',
    '<style is:global>',
    '  :root {',
    '    color-scheme: light;',
    ...tokenCssLines(config),
    '    font-family: var(--font-family);',
    '  }',
    '  * { box-sizing: border-box; }',
    '  body { margin: 0; background: var(--surface); color: var(--text); }',
    '  a { color: var(--accent-strong); }',
    '  .skip-link { left: 16px; padding: 8px 12px; position: fixed; top: -48px; }',
    '  .skip-link:focus { background: var(--surface); border: 1px solid var(--border); top: 16px; z-index: 2; }',
    '  .site-shell { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 100vh; }',
    '  .site-nav { background: var(--surface-muted); border-right: 1px solid var(--border); padding: 24px; }',
    '  .site-nav strong { display: block; margin-bottom: 20px; }',
    '  .nav-group { margin-bottom: 18px; }',
    '  .nav-group-label { color: var(--text-muted); font-size: 0.78rem; letter-spacing: 0.06em; margin: 0 0 6px; text-transform: uppercase; }',
    '  .nav-group nav { display: grid; gap: 4px; }',
    '  .nav-group a { border-radius: 8px; color: var(--text); padding: 7px 10px; text-decoration: none; }',
    '  .nav-group a[aria-current="page"] { background: var(--surface-raised); color: var(--accent-strong); }',
    '  .content { max-width: 860px; padding: 40px 48px 56px; width: 100%; }',
    '  .site-toolbar { align-items: center; display: flex; gap: 12px; justify-content: flex-end; margin-bottom: 8px; }',
    '  .dt-search { flex: 1; }',
    '  .dt-version-switcher { position: relative; }',
    '  .dt-version-switcher summary { border: 1px solid var(--border); border-radius: 8px; cursor: pointer; font-size: 0.85rem; padding: 4px 10px; }',
    '  .dt-version-switcher nav { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; display: grid; min-width: 120px; padding: 6px; position: absolute; right: 0; z-index: 3; }',
    '  .dt-version-switcher nav a { border-radius: 6px; padding: 5px 8px; text-decoration: none; }',
    '  .dt-locale-switcher { display: flex; gap: 4px; }',
    '  .dt-locale-switcher a { border: 1px solid var(--border); border-radius: 999px; font-size: 0.8rem; padding: 3px 9px; text-decoration: none; text-transform: uppercase; }',
    '  .dt-locale-switcher a[aria-current="true"] { background: var(--surface-raised); border-color: var(--accent); }',
    '  .dt-guarantee { border: 1px solid var(--border); border-radius: 999px; font-size: 0.78rem; font-weight: 600; padding: 3px 10px; }',
    '  .dt-guarantee--proven { background: #e7f5ec; border-color: #b6dfc4; color: var(--success); }',
    '  .dt-guarantee--scored { background: #fdf3e1; border-color: #ecd9ab; color: var(--warning); }',
    '  .dt-guarantee--out-of-domain { background: var(--surface-muted); color: var(--text-muted); }',
    '  .dt-section-chip { font-size: 0.7rem; font-weight: 500; vertical-align: middle; }',
    '  .dt-sources { border-top: 1px solid var(--border); margin-top: 48px; padding-top: 20px; }',
    '  .dt-sources h2 { border-top: 0; font-size: 1rem; margin: 0 0 10px; padding-top: 0; }',
    '  .dt-sources ul { list-style: none; margin: 0; padding: 0; }',
    '  .dt-sources li { color: var(--text-muted); font-size: 0.85rem; padding: 2px 0; }',
    '  .dt-source-commit { color: var(--text-muted); font-size: 0.8rem; margin-left: 8px; }',
    '  .site-footer { border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.9rem; margin-top: 48px; padding-top: 20px; }',
    '  h1, h2, h3 { letter-spacing: 0; line-height: 1.15; }',
    '  h1 { font-size: 2.4rem; margin: 0 0 20px; }',
    '  h2 { border-top: 1px solid var(--border); font-size: 1.6rem; margin: 36px 0 16px; padding-top: 28px; }',
    '  p, li { color: var(--text-muted); line-height: 1.65; }',
    '  code { background: var(--surface-muted); border-radius: 4px; padding: 2px 5px; }',
    '  table { border-collapse: collapse; margin: 20px 0; width: 100%; }',
    '  th, td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; }',
    '  .dt-callout, .dt-card, .dt-code-block, .dt-terminal { border: 1px solid var(--border); border-radius: 8px; margin: 20px 0; }',
    '  .dt-callout { background: var(--surface-muted); border-left: 4px solid var(--accent); padding: 16px 18px; }',
    '  .dt-callout--warning { border-left-color: var(--warning); }',
    '  .dt-callout--danger { border-left-color: var(--danger); }',
    '  .dt-callout--success { border-left-color: var(--success); }',
    '  .dt-card-grid { display: grid; gap: 14px; margin: 20px 0; }',
    '  .dt-card { color: var(--text); display: grid; gap: 8px; padding: 16px; text-decoration: none; }',
    '  .dt-code-block, .dt-terminal { background: #101718; color: #eef4f3; overflow: hidden; }',
    '  .dt-code-block pre, .dt-terminal pre { margin: 0; overflow-x: auto; padding: 16px; }',
    '  .dt-code-block code, .dt-terminal code { background: transparent; color: inherit; display: block; padding: 0; }',
    '  .dt-code-block figcaption, .dt-terminal figcaption { border-bottom: 1px solid #2c3536; font-size: 0.85rem; padding: 10px 16px; }',
    '  .dt-steps { counter-reset: steps; display: grid; gap: 10px; list-style: none; margin: 20px 0; padding: 0; }',
    '  .dt-steps li { background: var(--surface-muted); border-radius: 8px; counter-increment: steps; padding: 12px 14px; }',
    '  .dt-steps li::before { color: var(--accent-strong); content: counter(steps) ". "; font-weight: 700; }',
    '  .dt-tab-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0; }',
    '  .dt-tab-list button { background: var(--surface-muted); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px 12px; }',
    '  .dt-tab-list button[aria-selected="true"] { background: var(--accent); color: #ffffff; }',
    '  .dt-file-tree { background: var(--surface-muted); border-radius: 8px; font-family: ui-monospace, monospace; list-style: none; margin: 20px 0; padding: 14px 18px; }',
    '  .dt-file-tree li[data-kind="directory"] { font-weight: 600; }',
    '  .dt-badge { border: 1px solid var(--border); border-radius: 999px; font-size: 0.8rem; padding: 2px 9px; }',
    '  .dt-badge--success { color: var(--success); }',
    '  .dt-badge--warning { color: var(--warning); }',
    '  .dt-badge--danger { color: var(--danger); }',
    '  @media (max-width: 760px) { .site-shell { grid-template-columns: 1fr; } .site-nav { border-bottom: 1px solid var(--border); border-right: 0; } .content { padding: 28px 20px 40px; } .dt-card-grid { grid-template-columns: 1fr !important; } }',
    '</style>',
    ''
  ].join('\n');

const themeComponentsTsx = (): string =>
  [
    "import type { ReactNode } from 'react';",
    '',
    "type Tone = 'info' | 'note' | 'success' | 'warning' | 'danger';",
    '',
    "export function Callout({ children, title, tone = 'info' }: { children?: ReactNode; title?: string; tone?: Tone }) {",
    '  return <aside className={`dt-callout dt-callout--${tone}`} data-component="Callout">{title ? <strong>{title}</strong> : null}<div>{children}</div></aside>;',
    '}',
    '',
    'export function CodeBlock({ code, language, title }: { code?: string; language?: string; title?: string }) {',
    '  return <figure className="dt-code-block" data-component="CodeBlock">{title ? <figcaption>{title}</figcaption> : null}<pre><code data-language={language}>{code}</code></pre></figure>;',
    '}',
    '',
    'export function CodeGroup({ children, title }: { children?: ReactNode; title?: string }) {',
    '  return <section className="dt-code-group" data-component="CodeGroup">{title ? <h3>{title}</h3> : null}{children}</section>;',
    '}',
    '',
    'export function Terminal({ command, output, title }: { command?: string; output?: string; title?: string }) {',
    '  return <figure className="dt-terminal" data-component="Terminal">{title ? <figcaption>{title}</figcaption> : null}<pre>{command ? <code>$ {command}</code> : null}{output ? <code>{output}</code> : null}</pre></figure>;',
    '}',
    '',
    'export function Card({ description, href, title }: { description?: string; href?: string; title: string }) {',
    '  const content = <><strong>{title}</strong>{description ? <span>{description}</span> : null}</>;',
    '  return href ? <a className="dt-card" data-component="Card" href={href}>{content}</a> : <section className="dt-card" data-component="Card">{content}</section>;',
    '}',
    '',
    'export function CardGrid({ children, columns = 2 }: { children?: ReactNode; columns?: number }) {',
    '  const columnCount = Math.min(Math.max(columns, 1), 4);',
    '  return <div className="dt-card-grid" data-component="CardGrid" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>{children}</div>;',
    '}',
    '',
    'export function Steps({ items = [] }: { items?: string[] }) {',
    '  return <ol className="dt-steps" data-component="Steps">{items.map((item) => <li key={item}>{item}</li>)}</ol>;',
    '}',
    '',
    'export function Tabs({ defaultValue, tabs }: { defaultValue?: string; tabs: { label: string; value: string }[] }) {',
    '  const activeValue = defaultValue ?? tabs[0]?.value;',
    '  return <div className="dt-tabs" data-component="Tabs"><div className="dt-tab-list" role="tablist">{tabs.map((tab) => <button aria-selected={tab.value === activeValue} key={tab.value} role="tab" type="button">{tab.label}</button>)}</div></div>;',
    '}',
    '',
    'export function FileTree({ entries }: { entries: { path: string; kind?: "file" | "directory" }[] }) {',
    '  return <ul className="dt-file-tree" data-component="FileTree">{entries.map((entry) => <li data-kind={entry.kind ?? "file"} key={`${entry.kind ?? "file"}:${entry.path}`}>{entry.path}</li>)}</ul>;',
    '}',
    '',
    'export function Badge({ children, label, tone = "info" }: { children?: ReactNode; label?: string; tone?: Tone }) {',
    '  return <span className={`dt-badge dt-badge--${tone}`} data-component="Badge">{label ?? children}</span>;',
    '}',
    '',
    'export function ParamTable({ params }: { params: { name: string; type?: string; required?: boolean; description: string }[] }) {',
    '  return <table className="dt-param-table" data-component="ParamTable"><tbody>{params.map((param) => <tr key={param.name}><th>{param.name}{param.required ? " *" : ""}</th><td>{param.type ? <code>{param.type}</code> : null}</td><td>{param.description}</td></tr>)}</tbody></table>;',
    '}',
    '',
    'export function ComparisonTable({ columns, rows }: { columns: string[]; rows: (string | number | boolean)[][] }) {',
    '  return <table className="dt-comparison-table" data-component="ComparisonTable"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{String(cell)}</td>)}</tr>)}</tbody></table>;',
    '}',
    ''
  ].join('\n');

type LlmsPage = {
  title: string;
  url: string;
  description?: string | undefined;
  content: string;
};

// Source locale only, deliberately: the source locale is truth (PRODUCT §4.1) and llms-full.txt
// concatenates full page bodies — including translations would multiply its token cost per
// locale while adding no facts an agent could not get from the source text.
const llmsPages = (pages: EmitSitePage[]): LlmsPage[] =>
  pages
    .map((page) => ({
      title: page.shard.page.title,
      url: slugToHref(page.shard.page.slug),
      description: page.shard.page.description,
      content: splitFrontmatter(page.mdx).body.trim()
    }))
    .toSorted((left, right) => left.url.localeCompare(right.url));

const llmsText = (config: DocstubeConfig, pages: LlmsPage[]): string => {
  const lines = [`# ${config.site.title}`, ''];
  if (config.site.description !== '') {
    lines.push(`> ${config.site.description}`, '');
  }
  lines.push('## Docs');
  for (const page of pages) {
    const description = page.description === undefined ? '' : `: ${page.description}`;
    lines.push(`- [${page.title}](${page.url})${description}`);
  }
  return `${lines.join('\n')}\n`;
};

const llmsFullText = (config: DocstubeConfig, pages: LlmsPage[]): string => {
  const lines = [`# ${config.site.title}`, ''];
  if (config.site.description !== '') {
    lines.push(`> ${config.site.description}`, '');
  }
  for (const page of pages) {
    lines.push(`## ${page.title}`, '', `URL: ${page.url}`, '', page.content, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
};

const siteIndexJson = (config: DocstubeConfig, index: ManifestIndex, pages: EmitSitePage[]): string =>
  `${JSON.stringify(
    {
      site: config.site.title,
      description: config.site.description,
      generatorVersion: index.docstubeVersion,
      pages: pages
        .map((page) => ({
          title: page.shard.page.title,
          slug: page.shard.page.slug,
          url: slugToHref(page.shard.page.slug),
          ...(page.shard.page.description === undefined ? {} : { description: page.shard.page.description })
        }))
        .toSorted((left, right) => left.slug.localeCompare(right.slug))
    },
    null,
    2
  )}\n`;

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const sitemapXml = (baseUrl: string, urls: string[]): string => {
  const base = baseUrl.replace(/\/$/u, '');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.flatMap((url) => ['  <url>', `    <loc>${escapeXml(`${base}${url}`)}</loc>`, '  </url>']),
    '</urlset>',
    ''
  ].join('\n');
};

const robotsTxt = (baseUrl: string): string =>
  ['User-agent: *', 'Allow: /', '', `Sitemap: ${baseUrl.replace(/\/$/u, '')}/sitemap.xml`, ''].join('\n');

const writeTextFile = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
};

export const emitSite = async (input: EmitSiteInput): Promise<void> => {
  const siteRoot = join(input.repoRoot, input.outDir);
  const sourceLocale = input.config.locales.source;
  const translations = input.translations ?? [];
  const navByLocale = buildNavByLocale(input.index, sourceLocale, translations);
  const alternatesBySlug = buildAlternatesBySlug(input.pages, translations, sourceLocale);
  const routeContext: PageRouteContext = { sourceLocale, alternatesBySlug };
  const pages = llmsPages(input.pages);
  const baseUrl = input.config.site.baseUrl;
  const currentVersion =
    input.index.versions.find((version) => version.status === 'current')?.label ?? input.config.versions.current;

  const writes: Array<Promise<void>> = [
    writeTextFile(join(siteRoot, 'package.json'), generatedSitePackageJson()),
    writeTextFile(join(siteRoot, 'astro.config.mjs'), astroConfigMjs(input.config)),
    writeTextFile(join(siteRoot, '.gitignore'), 'dist/\nnode_modules/\n.astro/\n'),
    writeTextFile(
      join(siteRoot, 'src/site-data.mjs'),
      siteDataMjs({
        config: input.config,
        navByLocale,
        currentVersion,
        frozenVersions: input.frozenVersions ?? [],
        repoUrl: input.repoUrl
      })
    ),
    writeTextFile(join(siteRoot, 'src/layouts/DocLayout.astro'), docLayoutAstro(input.config)),
    writeTextFile(join(siteRoot, 'src/components/theme-components.tsx'), themeComponentsTsx()),
    writeTextFile(join(siteRoot, 'public/llms.txt'), llmsText(input.config, pages)),
    writeTextFile(join(siteRoot, 'public/llms-full.txt'), llmsFullText(input.config, pages)),
    writeTextFile(join(siteRoot, 'mcp/site-index.json'), siteIndexJson(input.config, input.index, input.pages)),
    writeTextFile(join(siteRoot, 'mcp/docs-mcp-server.mjs'), docsMcpServerMjs()),
    writeTextFile(join(siteRoot, 'mcp/README.md'), docsMcpReadmeMd())
  ];

  for (const page of input.pages) {
    const slug = page.shard.page.slug;
    writes.push(
      writeTextFile(join(siteRoot, 'src/pages', `${slug}.mdx`), pageRouteMdx(page, routeContext)),
      // Raw markdown mirror at every doc URL, for agents and curl users.
      writeTextFile(join(siteRoot, 'public', `${slug}.md`), page.mdx)
    );
  }
  for (const translation of translations) {
    const slug = translation.shard.page.slug;
    const locale = translation.shard.locale;
    writes.push(
      writeTextFile(join(siteRoot, 'src/pages', locale, `${slug}.mdx`), pageRouteMdx(translation, routeContext)),
      writeTextFile(join(siteRoot, 'public', locale, `${slug}.md`), translation.mdx)
    );
  }

  if (baseUrl !== undefined) {
    const urls = [
      ...pages.map((page) => page.url),
      ...translations.map((translation) =>
        localeHref(translation.shard.page.slug, translation.shard.locale, sourceLocale)
      )
    ].toSorted();
    writes.push(
      writeTextFile(join(siteRoot, 'public/sitemap.xml'), sitemapXml(baseUrl, urls)),
      writeTextFile(join(siteRoot, 'public/robots.txt'), robotsTxt(baseUrl))
    );
  }

  await Promise.all(writes);
};
