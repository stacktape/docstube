import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DocstubeConfig, ManifestIndex, PageEntity, PageShard, SourceRef } from '@docstube/contracts';
import { applyThemeBundle } from './apply-theme-bundle.ts';
import { projectShardProof } from './proof-projection.ts';
import type { ThemeConflict } from './apply-theme-bundle.ts';
import { docsMcpReadmeMd, docsMcpServerMjs } from './mcp-server-source.ts';
import {
  docstubeEntityAstro,
  docstubeGuaranteeAstro,
  docstubeSearchAstro,
  docstubeSectionChipsAstro,
  docstubeSourcesAstro
} from './proof-source.ts';
import { ThemeError } from './theme-manifest.ts';
import type { ThemeBuild, ThemeBundle } from './theme-manifest.ts';

// Emits a fully self-contained Astro site: generated sites vendor everything they need and never
// depend on a @docstube/* package at runtime (ARCHITECTURE.md §2). The site builds with plain
// `npm install && npm run build`.
//
// Ownership (knowledge/design/theming.md): content MDX, public/*.md mirrors, llms.txt,
// site-data.mjs, the MCP server, Pagefind wiring, and src/docstube/** proof primitives are
// kernel/content-owned. src/layouts/**, src/components/**, src/styles/** come from the resolved
// theme bundle. astro.config.mjs and package.json are kernel-generated from invariants plus the
// theme's typed build hooks.

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
  // The resolved theme bundle. The CLI resolves it (builtinThemes[config.theme.name]) — emitSite
  // never performs a hidden registry lookup.
  theme: ThemeBundle;
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
  // Overwrite user-modified theme-owned files instead of reporting conflicts.
  forceTheme?: boolean;
};

export type EmitSiteResult = {
  // Theme-owned files that were NOT touched because the user modified them (reported, never
  // silently destroyed). The CLI prints these.
  themeConflicts: ThemeConflict[];
};

// Kernel invariants pinned exactly (no ranges): a generated site must build identically whenever
// it is rebuilt, and a docstube release is only ever validated against these versions.
// `docstube refresh` updates them. Theme dependencies merge on top; a conflicting pin is an error.
const kernelBaseDependencies: Record<string, string> = {
  '@astrojs/mdx': '6.0.3',
  astro: '6.4.6',
  // Baseline static search (PRODUCT §4.1); indexes dist/ in the postbuild step.
  pagefind: '1.4.0'
};

const mergeDependencies = (theme: ThemeBundle): Record<string, string> => {
  const merged: Record<string, string> = { ...kernelBaseDependencies };
  for (const [name, version] of Object.entries(theme.manifest.dependencies)) {
    const existing = merged[name];
    if (existing !== undefined && existing !== version) {
      throw new ThemeError(
        'theme-dependency-conflict',
        `theme "${theme.manifest.name}" pins ${name}@${version} but the kernel requires ${name}@${existing}`,
        { package: name, themeVersion: version, kernelVersion: existing }
      );
    }
    merged[name] = version;
  }
  return Object.fromEntries(Object.entries(merged).toSorted(([left], [right]) => left.localeCompare(right)));
};

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

// The component imports injected into every page route, generated from the theme's renderer map:
// contract name -> '<site-relative module>[#ExportName]' (export defaults to the contract name).
// Writer MDX must not import theme components itself — these lines put them all in scope.
const rendererImportLines = (renderers: Record<string, string>, up: string): string[] => {
  const byModule = new Map<string, string[]>();
  for (const [contractName, target] of Object.entries(renderers)) {
    const hashIndex = target.indexOf('#');
    const modulePath = hashIndex === -1 ? target : target.slice(0, hashIndex);
    const exportName = hashIndex === -1 ? contractName : target.slice(hashIndex + 1);
    const specifier = exportName === contractName ? contractName : `${exportName} as ${contractName}`;
    const list = byModule.get(modulePath) ?? [];
    list.push(specifier);
    byModule.set(modulePath, list);
  }
  return [...byModule].map(
    ([modulePath, specifiers]) => `import { ${specifiers.join(', ')} } from '${up}${modulePath}';`
  );
};

type PageRouteContext = {
  sourceLocale: string;
  alternatesBySlug: Map<string, LocaleAlternate[]>;
  renderers: Record<string, string>;
};

const pageRouteMdx = (page: EmitSitePage, context: PageRouteContext): string => {
  const { frontmatter, body } = splitFrontmatter(page.mdx);
  const locale = page.shard.locale;
  const isSourceLocale = locale === context.sourceLocale;
  const slug = page.shard.page.slug;
  const depth = slug.split('/').length + (isSourceLocale ? 0 : 1);
  const up = '../'.repeat(depth);
  // INTERIM (until the trust-chip wave): verified/reviewed chips derive from claim counts +
  // assessments via the shard proof projection — never from the removed guarantee ladder.
  const proof = projectShardProof(page.shard);
  const alternates = context.alternatesBySlug.get(slug) ?? [];
  const sources = collectPageSources(page.shard.page).map((ref) => ({
    file: ref.file,
    ...(ref.span === undefined ? {} : { line: ref.span[0], endLine: ref.span[1] }),
    commit: ref.commit
  }));
  const injected = [
    // Every theme bundle ships this exact layout path (validated by applyThemeBundle).
    `layout: ${JSON.stringify(`${up}layouts/DocLayout.astro`)}`,
    ...(frontmatterHasKey(frontmatter, 'title') ? [] : [`title: ${JSON.stringify(page.shard.page.title)}`]),
    ...(page.shard.page.description !== undefined && !frontmatterHasKey(frontmatter, 'description')
      ? [`description: ${JSON.stringify(page.shard.page.description)}`]
      : []),
    `docstubeLocale: ${JSON.stringify(locale)}`,
    `docstubePageId: ${JSON.stringify(page.shard.page.id)}`,
    `docstubeGuarantee: ${JSON.stringify(proof.guarantee)}`,
    `docstubeClaimsChecked: ${proof.checkedClaims}`,
    `docstubeClaimsTotal: ${proof.totalClaims}`,
    `docstubeClaimsContradicted: ${proof.contradictedClaims}`,
    ...(proof.reviewedFor === undefined ? [] : [`docstubeReviewedFor: ${JSON.stringify(proof.reviewedFor)}`]),
    // JSON is valid YAML flow syntax, so these round-trip through Astro's frontmatter parser.
    ...(alternates.length > 1 ? [`docstubeAlternates: ${JSON.stringify(alternates)}`] : []),
    ...(sources.length > 0 ? [`docstubeSources: ${JSON.stringify(sources)}`] : []),
    ...(proof.sections.length > 0 ? [`docstubeSections: ${JSON.stringify(proof.sections)}`] : [])
  ];
  return [
    '---',
    ...(frontmatter === '' ? [] : [frontmatter.trimEnd()]),
    ...injected,
    '---',
    '',
    ...rendererImportLines(context.renderers, up),
    '',
    body.trimEnd(),
    ''
  ].join('\n');
};

const generatedSitePackageJson = (dependencies: Record<string, string>): string =>
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
      dependencies
    },
    null,
    2
  )}\n`;

// The kernel owns astro.config.mjs: generated from invariants (MDX, static output, base URL) plus
// the theme's typed build hooks — themes never own the config file.
const astroConfigMjs = (config: DocstubeConfig, build: ThemeBuild): string => {
  const shiki = build.shiki;
  const transformerImports = (shiki?.transformers ?? []).map(
    (modulePath, index) => `import themeShikiTransformers${index} from './src/${modulePath}';`
  );
  const shikiThemeLines =
    shiki === undefined
      ? []
      : shiki.themes.length > 1
        ? [`      themes: { light: ${JSON.stringify(shiki.themes[0])}, dark: ${JSON.stringify(shiki.themes[1])} },`]
        : [`      theme: ${JSON.stringify(shiki.themes[0])},`];
  const shikiTransformerLines =
    shiki === undefined || (shiki.transformers ?? []).length === 0
      ? []
      : [
          `      transformers: [${(shiki.transformers ?? []).map((_, index) => `...themeShikiTransformers${index}`).join(', ')}],`
        ];
  return [
    "import mdx from '@astrojs/mdx';",
    "import { defineConfig } from 'astro/config';",
    ...(build.integrationsModule === undefined
      ? []
      : [`import themeIntegrations from './src/${build.integrationsModule}';`]),
    ...transformerImports,
    '',
    '// TODO(review-ui): rehype plugin slot — a `markdown.processor` rehype plugin will inject',
    '// data-entity-id attributes on arbitrary blocks from the manifest sidecar (ARCHITECTURE.md',
    '// §3.4). Section-level guarantee chips already ship (injected by the layout by anchor);',
    '// block-level addressing is deliberately not faked in v1.',
    'export default defineConfig({',
    `  integrations: [mdx()${build.integrationsModule === undefined ? '' : ', ...themeIntegrations'}],`,
    "  output: 'static',",
    ...(config.site.baseUrl === undefined ? [] : [`  site: ${JSON.stringify(config.site.baseUrl)},`]),
    ...(shiki === undefined
      ? []
      : ['  markdown: {', '    shikiConfig: {', ...shikiThemeLines, ...shikiTransformerLines, '    }', '  },']),
    '});',
    ''
  ].join('\n');
};

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

const kebabCase = (name: string): string => name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

// Kernel-emitted src/docstube/tokens.css: the theme's token defaults merged with the config
// theme.tokens overrides, exposed as CSS custom properties. The four semantic tokens
// (accent/accentDark/fontBody/fontCode) are honored by every theme; the legacy 'font-family'
// token stays an alias of the final body font so the existing token vocabulary keeps working.
export const tokensCss = (theme: ThemeBundle, config: DocstubeConfig): string => {
  const overrides = config.theme.tokens;
  const merged: Record<string, string> = { ...theme.manifest.tokens, ...overrides };
  const legacyFont = overrides['font-family'];
  if (legacyFont !== undefined && overrides.fontBody === undefined) {
    merged.fontBody = legacyFont;
  }
  if (merged.fontBody !== undefined) {
    merged['font-family'] = merged.fontBody;
  }
  const lines = Object.entries(merged).map(([name, value]) => `  --${kebabCase(name)}: ${value};`);
  return [
    '/* Generated by docstube (kernel-owned): theme token defaults + config theme.tokens. */',
    ':root {',
    ...lines,
    '}',
    ''
  ].join('\n');
};

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

export const emitSite = async (input: EmitSiteInput): Promise<EmitSiteResult> => {
  const siteRoot = join(input.repoRoot, input.outDir);
  const theme = input.theme;
  const sourceLocale = input.config.locales.source;
  const translations = input.translations ?? [];
  const navByLocale = buildNavByLocale(input.index, sourceLocale, translations);
  const alternatesBySlug = buildAlternatesBySlug(input.pages, translations, sourceLocale);
  const routeContext: PageRouteContext = { sourceLocale, alternatesBySlug, renderers: theme.manifest.renderers };
  const pages = llmsPages(input.pages);
  const baseUrl = input.config.site.baseUrl;
  const currentVersion =
    input.index.versions.find((version) => version.status === 'current')?.label ?? input.config.versions.current;

  // Theme-owned files + kernel-generated config, applied with the ownership-manifest algorithm
  // (stale theme files from a previous theme are removed; user-modified files are preserved).
  const applied = await applyThemeBundle({
    siteRoot,
    bundle: theme,
    previousManifestPath: join(input.repoRoot, '.docstube', 'theme-files.json'),
    themeVersion: input.index.docstubeVersion,
    kernelConfigFiles: [
      { path: 'package.json', content: generatedSitePackageJson(mergeDependencies(theme)) },
      { path: 'astro.config.mjs', content: astroConfigMjs(input.config, theme.manifest.build) }
    ],
    ...(input.forceTheme === undefined ? {} : { force: input.forceTheme })
  });

  const writes: Array<Promise<void>> = [
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
    // Kernel-owned proof primitives + design tokens (src/docstube/**): every theme layout mounts
    // these; rewritten on every emit, never part of the theme bundle.
    writeTextFile(join(siteRoot, 'src/docstube/tokens.css'), tokensCss(theme, input.config)),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeGuarantee.astro'), docstubeGuaranteeAstro()),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeSources.astro'), docstubeSourcesAstro()),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeEntity.astro'), docstubeEntityAstro()),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeSectionChips.astro'), docstubeSectionChipsAstro()),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeSearch.astro'), docstubeSearchAstro()),
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
  return { themeConflicts: applied.conflicts };
};
