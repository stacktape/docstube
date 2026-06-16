import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { z } from 'zod';
import { glossarySchema, layouts, registrySchema, reservedComponentNames } from '@docstube/contracts';
import type { PagefindServiceConfig } from 'pagefind';
import type { CompileOptions } from '@terrastruct/d2';
import type { ComponentRegistry, Glossary, Ia, IaNode, Layout, RegistryComponent } from '@docstube/contracts';

export type BuiltInComponentName =
  | 'ApiReference'
  | 'Badge'
  | 'Callout'
  | 'Card'
  | 'CardGrid'
  | 'CodeBlock'
  | 'CodeGroup'
  | 'ComparisonTable'
  | 'DecisionTree'
  | 'Diagram'
  | 'Divider'
  | 'FileTree'
  | 'ParamTable'
  | 'PreviousNext'
  | 'Screenshot'
  | 'Steps'
  | 'Tabs'
  | 'Term'
  | 'Terminal';

export const builtInComponentNames = [
  'Callout',
  'CodeBlock',
  'CodeGroup',
  'Terminal',
  'Card',
  'CardGrid',
  'Steps',
  'Tabs',
  'FileTree',
  'PreviousNext',
  'Divider',
  'ComparisonTable',
  'ParamTable',
  'DecisionTree',
  'Badge',
  'ApiReference',
  'Diagram',
  'Term',
  'Screenshot'
] as const satisfies readonly BuiltInComponentName[];

export type ThemeLayout = Layout;

export const themeLayouts = layouts;

export const defaultThemeLayout = 'single-tree' satisfies ThemeLayout;

export const themeLayoutLabels = {
  'single-tree': 'Single tree',
  sectioned: 'Sectioned'
} as const satisfies Record<ThemeLayout, string>;

export type ThemeComponentCategory = 'api' | 'callout' | 'code' | 'content' | 'diagram' | 'navigation' | 'reserved';

type ThemeComponentDefinition = {
  category: ThemeComponentCategory;
  description: string;
};

const themeComponentDefinitions = {
  Callout: {
    category: 'callout',
    description: 'Highlighted note, warning, success, or danger block.'
  },
  CodeBlock: {
    category: 'code',
    description: 'Single code sample with optional language and title.'
  },
  CodeGroup: {
    category: 'code',
    description: 'Grouped code samples for alternate languages or package managers.'
  },
  Terminal: {
    category: 'code',
    description: 'Terminal command and output block.'
  },
  Card: {
    category: 'content',
    description: 'Compact link or summary card.'
  },
  CardGrid: {
    category: 'content',
    description: 'Responsive grid for cards.'
  },
  Steps: {
    category: 'content',
    description: 'Ordered implementation or setup steps.'
  },
  Tabs: {
    category: 'content',
    description: 'Small mutually exclusive content panels.'
  },
  FileTree: {
    category: 'code',
    description: 'Repository file tree.'
  },
  PreviousNext: {
    category: 'navigation',
    description: 'Previous and next page navigation.'
  },
  Divider: {
    category: 'content',
    description: 'Thematic section divider.'
  },
  ComparisonTable: {
    category: 'content',
    description: 'Feature or behavior comparison matrix.'
  },
  ParamTable: {
    category: 'api',
    description: 'Parameter, option, or field table.'
  },
  DecisionTree: {
    category: 'content',
    description: 'Decision points with recommended next steps.'
  },
  Badge: {
    category: 'content',
    description: 'Inline status or category badge.'
  },
  ApiReference: {
    category: 'api',
    description: 'Extractor-backed API symbol reference.'
  },
  Diagram: {
    category: 'diagram',
    description: 'D2 diagram source rendered by the generated site.'
  },
  Term: {
    category: 'content',
    description: 'Glossary term reference.'
  },
  Screenshot: {
    category: 'reserved',
    description: 'Reserved screenshot placeholder. Capture is not implemented yet.'
  }
} as const satisfies Record<BuiltInComponentName, ThemeComponentDefinition>;

const reservedComponentNameSet = new Set<string>(reservedComponentNames);

const componentPropRef = (name: BuiltInComponentName): string =>
  `${name.replaceAll(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase()}-props`;

export const themeRegistryComponents = builtInComponentNames.map((name): RegistryComponent => {
  const definition = themeComponentDefinitions[name];
  return {
    name,
    description: definition.description,
    category: definition.category,
    status: reservedComponentNameSet.has(name) ? 'reserved' : 'stable',
    props: { ref: componentPropRef(name) }
  };
});

export const docstubeThemeRegistry: ComponentRegistry = registrySchema.parse({
  version: 1,
  components: themeRegistryComponents
});

const childrenProps = {
  children: z.unknown().optional()
} as const;

const toneSchema = z.enum(['info', 'note', 'success', 'warning', 'danger']);

const linkTargetSchema = z.strictObject({
  title: z.string().min(1),
  href: z.string().min(1).optional(),
  description: z.string().min(1).optional()
});

const tableCellSchema = z.union([z.string(), z.number(), z.boolean()]);

export const themeComponentPropSchemas = {
  'api-reference-props': z.strictObject({
    symbol: z.string().min(1),
    sourcePath: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
    signature: z.string().min(1).optional(),
    ...childrenProps
  }),
  'badge-props': z.strictObject({
    tone: toneSchema.default('info'),
    label: z.string().min(1).optional(),
    ...childrenProps
  }),
  'callout-props': z.strictObject({
    tone: toneSchema.default('info'),
    title: z.string().min(1).optional(),
    ...childrenProps
  }),
  'card-props': z.strictObject({
    title: z.string().min(1),
    href: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    ...childrenProps
  }),
  'card-grid-props': z.strictObject({
    columns: z.int().min(1).max(4).default(2),
    ...childrenProps
  }),
  'code-block-props': z.strictObject({
    code: z.string().optional(),
    language: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    ...childrenProps
  }),
  'code-group-props': z.strictObject({
    title: z.string().min(1).optional(),
    ...childrenProps
  }),
  'comparison-table-props': z.strictObject({
    columns: z.array(z.string().min(1)).min(2),
    rows: z.array(z.array(tableCellSchema).min(2)).min(1)
  }),
  'decision-tree-props': z.strictObject({
    title: z.string().min(1).optional(),
    decisions: z.array(linkTargetSchema).min(1)
  }),
  'diagram-props': z
    .strictObject({
      source: z.string().min(1).optional(),
      svg: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      kind: z.literal('d2').default('d2')
    })
    .refine((props) => props.source !== undefined || props.svg !== undefined, {
      message: 'Diagram requires source or svg',
      path: ['source']
    }),
  'divider-props': z.strictObject({
    label: z.string().min(1).optional()
  }),
  'file-tree-props': z.strictObject({
    entries: z
      .array(
        z.strictObject({
          path: z.string().min(1),
          kind: z.enum(['file', 'directory']).default('file')
        })
      )
      .min(1)
  }),
  'param-table-props': z.strictObject({
    params: z
      .array(
        z.strictObject({
          name: z.string().min(1),
          type: z.string().min(1).optional(),
          required: z.boolean().optional(),
          description: z.string().min(1)
        })
      )
      .min(1)
  }),
  'previous-next-props': z.strictObject({
    previous: linkTargetSchema.optional(),
    next: linkTargetSchema.optional()
  }),
  'steps-props': z.strictObject({
    items: z.array(z.string().min(1)).optional(),
    ...childrenProps
  }),
  'tabs-props': z.strictObject({
    tabs: z
      .array(
        z.strictObject({
          label: z.string().min(1),
          value: z.string().min(1)
        })
      )
      .min(1),
    defaultValue: z.string().min(1).optional(),
    ...childrenProps
  }),
  'term-props': z.strictObject({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    ...childrenProps
  }),
  'terminal-props': z.strictObject({
    command: z.string().min(1).optional(),
    output: z.string().optional(),
    title: z.string().min(1).optional(),
    ...childrenProps
  })
} as const satisfies Record<string, z.ZodType>;

export const stableThemeComponentNames = docstubeThemeRegistry.components
  .filter((component) => component.status === 'stable')
  .map((component) => component.name);

const normalizePath = (path: string): string => path.replaceAll('\\', '/');

const collectRelativeFiles = async (rootDir: string, currentDir = rootDir): Promise<string[]> => {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        return collectRelativeFiles(rootDir, entryPath);
      }
      if (entry.isFile()) {
        return [normalizePath(relative(rootDir, entryPath))];
      }
      return [];
    })
  );

  return files.flat().toSorted((left, right) => left.localeCompare(right));
};

export type GeneratedSiteNavItem = {
  href: string;
  label: string;
};

export type GeneratedSiteAssetsInput = {
  credit?: boolean;
  glossary: Glossary;
  ia: Ia;
  siteDescription?: string;
  siteName: string;
  siteUrl?: string;
};

export type GeneratedSiteAsset = {
  content: string;
  path: string;
};

const slugToHref = (slug: string): string => {
  if (slug === 'index.mdx') {
    return '/';
  }
  const withoutExtension = slug.replace(/\.mdx$/u, '');
  return `/${withoutExtension}/`;
};

const navItemsFromNode = (node: IaNode, parentIds: readonly string[] = []): GeneratedSiteNavItem[] => {
  const children = node.children ?? [];
  const pageId = [...parentIds, node.id].join('/');
  const shouldRenderPage = node.path !== undefined || children.length === 0;
  const current = shouldRenderPage
    ? [
        {
          href: slugToHref(node.path ?? (pageId === 'overview' ? 'index.mdx' : `${pageId}.mdx`)),
          label: node.title
        }
      ]
    : [];

  return [...current, ...children.flatMap((child) => navItemsFromNode(child, [...parentIds, node.id]))];
};

export const createGeneratedSiteNavItems = (ia: Ia): GeneratedSiteNavItem[] =>
  ia.nav.flatMap((node) => navItemsFromNode(node));

const generatedSitePackageJson = () =>
  `${JSON.stringify(
    {
      name: 'docstube-generated-site',
      private: true,
      type: 'module',
      scripts: {
        build: 'astro build'
      },
      dependencies: {
        '@astrojs/mdx': '^6.0.3',
        '@astrojs/react': '^5.0.7',
        '@terrastruct/d2': '^0.1.33',
        astro: '^6.4.6',
        pagefind: '^1.5.2',
        react: '^19.2.7',
        'react-dom': '^19.2.7'
      }
    },
    null,
    2
  )}\n`;

const astroConfigMjs = () =>
  [
    "import mdx from '@astrojs/mdx';",
    "import react from '@astrojs/react';",
    "import { defineConfig } from 'astro/config';",
    "import glossary from './src/theme-build/glossary-data.mjs';",
    "import { siteUrl } from './src/theme-build/site-data.mjs';",
    "import { createGlossaryRemarkPlugin } from './src/theme-build/glossary-remark.mjs';",
    '',
    'export default defineConfig({',
    '  integrations: [mdx({ remarkPlugins: [createGlossaryRemarkPlugin(glossary)] }), react()],',
    "  output: 'static',",
    '  site: siteUrl',
    '});',
    ''
  ].join('\n');

const glossaryDataMjs = (glossary: Glossary) =>
  [`const glossary = ${JSON.stringify(glossary, null, 2)};`, '', 'export default glossary;', ''].join('\n');

const siteDataMjs = (input: GeneratedSiteAssetsInput) =>
  [
    `export const siteName = ${JSON.stringify(input.siteName)};`,
    `export const siteDescription = ${JSON.stringify(input.siteDescription ?? '')};`,
    `export const siteUrl = ${JSON.stringify(input.siteUrl ?? 'https://docs.example.test')};`,
    `export const credit = ${JSON.stringify(input.credit ?? true)};`,
    `export const navItems = ${JSON.stringify(createGeneratedSiteNavItems(input.ia), null, 2)};`,
    ''
  ].join('\n');

const glossaryRemarkMjs = () =>
  [
    "const skippedParentTypes = new Set(['code', 'definition', 'inlineCode', 'link', 'linkReference', 'mdxJsxFlowElement', 'mdxJsxTextElement']);",
    '',
    "const escapeRegExp = (value) => value.replaceAll(/[\\\\^$.*+?()[\\]{}|]/gu, '\\\\$&');",
    '',
    'const glossaryMatches = (glossary) =>',
    '  glossary.terms',
    '    .flatMap((term) => [term.term, ...(term.aliases ?? [])].map((label) => ({ ...term, label })))',
    '    .toSorted((left, right) => right.label.length - left.label.length || left.label.localeCompare(right.label));',
    '',
    'const linkedGlossaryNodes = (value, matchesByLabel, pattern) => {',
    '  const nodes = [];',
    '  let cursor = 0;',
    '',
    '  for (const match of value.matchAll(pattern)) {',
    '    const matchText = match[0];',
    '    const index = match.index;',
    '    const glossaryMatch = matchesByLabel.get(matchText.toLowerCase());',
    '    if (!glossaryMatch) continue;',
    '    if (index > cursor) nodes.push({ type: "text", value: value.slice(cursor, index) });',
    '    nodes.push({',
    '      type: "link",',
    '      url: `/glossary/#${glossaryMatch.id}`,',
    '      title: glossaryMatch.definition,',
    '      children: [{ type: "text", value: matchText }]',
    '    });',
    '    cursor = index + matchText.length;',
    '  }',
    '',
    '  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });',
    '  return nodes.length > 0 ? nodes : [{ type: "text", value }];',
    '};',
    '',
    'const linkGlossaryChildren = (node, matchesByLabel, pattern) => {',
    '  if (!node.children || skippedParentTypes.has(node.type ?? "")) return;',
    '  const nextChildren = [];',
    '  for (const child of node.children) {',
    '    if (child.type === "text" && child.value) {',
    '      nextChildren.push(...linkedGlossaryNodes(child.value, matchesByLabel, pattern));',
    '    } else {',
    '      linkGlossaryChildren(child, matchesByLabel, pattern);',
    '      nextChildren.push(child);',
    '    }',
    '  }',
    '  node.children = nextChildren;',
    '};',
    '',
    'export const createGlossaryRemarkPlugin = (glossary) => {',
    '  const matches = glossaryMatches(glossary);',
    '  const pattern = matches.length > 0',
    '    ? new RegExp(`(?<![\\\\p{L}\\\\p{N}_])(${matches.map((match) => escapeRegExp(match.label)).join("|")})(?![\\\\p{L}\\\\p{N}_])`, "giu")',
    '    : undefined;',
    '  const matchesByLabel = new Map(matches.map((match) => [match.label.toLowerCase(), match]));',
    '  return () => (tree) => {',
    '    if (pattern) linkGlossaryChildren(tree, matchesByLabel, pattern);',
    '  };',
    '};',
    ''
  ].join('\n');

const docLayoutAstro = () =>
  [
    '---',
    "import { credit, navItems, siteDescription, siteName, siteUrl as configuredSiteUrl } from '../theme-build/site-data.mjs';",
    'const { frontmatter } = Astro.props;',
    "const layoutMode = frontmatter.layoutMode === 'sectioned' ? 'sectioned' : 'single-tree';",
    'const siteUrl = Astro.site ?? new URL(configuredSiteUrl);',
    'const canonicalUrl = new URL(Astro.url.pathname, siteUrl).href;',
    'const title = `${frontmatter.title} | ${siteName}`;',
    'const description = frontmatter.description ?? siteDescription;',
    'const showCredit = credit !== false && frontmatter.credit !== false;',
    'const articleStructuredData = {',
    "  '@context': 'https://schema.org',",
    "  '@type': 'TechArticle',",
    '  headline: frontmatter.title,',
    '  description,',
    '  url: canonicalUrl,',
    '  mainEntityOfPage: canonicalUrl,',
    "  publisher: { '@type': 'Organization', name: siteName }",
    '};',
    '---',
    '',
    '<!doctype html>',
    '<html lang="en" data-layout={layoutMode}>',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <title>{title}</title>',
    '    <meta name="description" content={description} />',
    '    <link rel="canonical" href={canonicalUrl} />',
    '    <meta property="og:title" content={title} />',
    '    <meta property="og:description" content={description} />',
    '    <meta property="og:url" content={canonicalUrl} />',
    '    <meta property="og:type" content="article" />',
    '    <script type="application/ld+json" set:html={JSON.stringify(articleStructuredData)} />',
    '  </head>',
    '  <body>',
    '    <a class="skip-link" href="#content">Skip to content</a>',
    '    <div class={`site-shell site-shell--${layoutMode}`}>',
    '      <aside class="site-nav" aria-label="Documentation">',
    '        <strong>{siteName}</strong>',
    '        <nav>',
    '          {navItems.map((item) => <a href={item.href} aria-current={Astro.url.pathname === item.href ? "page" : undefined}>{item.label}</a>)}',
    '        </nav>',
    '      </aside>',
    '      <main id="content" class="content" data-pagefind-body>',
    '        <slot />',
    '        {showCredit ? <footer class="site-footer">Generated by <a href="https://docstube.dev">docstube</a></footer> : null}',
    '      </main>',
    '    </div>',
    '  </body>',
    '</html>',
    '',
    '<style is:global>',
    '  :root { color-scheme: light; --surface: #ffffff; --surface-muted: #f4f7f8; --surface-raised: #eef4f3; --text: #192122; --text-muted: #526061; --border: #d5dfdf; --accent: #087f7b; --accent-strong: #075f63; --warning: #8f5d00; --danger: #b42318; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }',
    '  * { box-sizing: border-box; }',
    '  body { margin: 0; background: var(--surface); color: var(--text); }',
    '  a { color: var(--accent-strong); }',
    '  .skip-link { left: 16px; padding: 8px 12px; position: fixed; top: -48px; }',
    '  .skip-link:focus { background: var(--surface); border: 1px solid var(--border); top: 16px; z-index: 2; }',
    '  .site-shell { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }',
    '  .site-shell--sectioned .content { max-width: 1040px; }',
    '  .site-nav { background: var(--surface-muted); border-right: 1px solid var(--border); padding: 24px; }',
    '  .site-nav strong { display: block; margin-bottom: 20px; }',
    '  .site-nav nav { display: grid; gap: 8px; }',
    '  .site-nav a { border-radius: 8px; color: var(--text); padding: 8px 10px; text-decoration: none; }',
    '  .site-nav a[aria-current="page"] { background: var(--surface-raised); color: var(--accent-strong); }',
    '  .content { max-width: 860px; padding: 48px; width: 100%; }',
    '  .site-footer { border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.9rem; margin-top: 48px; padding-top: 20px; }',
    '  h1, h2, h3 { letter-spacing: 0; line-height: 1.15; }',
    '  h1 { font-size: 2.6rem; margin: 0 0 20px; }',
    '  h2 { border-top: 1px solid var(--border); font-size: 1.6rem; margin: 36px 0 16px; padding-top: 28px; }',
    '  p, li { color: var(--text-muted); line-height: 1.65; }',
    '  code { background: var(--surface-muted); border-radius: 4px; padding: 2px 5px; }',
    '  .dt-callout, .dt-card, .dt-code-block, .dt-diagram, .dt-terminal { border: 1px solid var(--border); border-radius: 8px; margin: 20px 0; }',
    '  .dt-callout { background: var(--surface-muted); border-left: 4px solid var(--accent); padding: 16px 18px; }',
    '  .dt-card-grid { display: grid; gap: 14px; margin: 20px 0; }',
    '  .dt-card { color: var(--text); display: grid; gap: 8px; padding: 16px; text-decoration: none; }',
    '  .dt-code-block, .dt-terminal { background: #101718; color: #eef4f3; overflow: hidden; }',
    '  .dt-code-block pre, .dt-terminal pre { margin: 0; overflow-x: auto; padding: 16px; }',
    '  .dt-steps { counter-reset: steps; display: grid; gap: 10px; list-style: none; padding: 0; }',
    '  .dt-steps li { background: var(--surface-muted); border-radius: 8px; counter-increment: steps; padding: 12px 14px; }',
    '  .dt-steps li::before { color: var(--accent-strong); content: counter(steps) ". "; font-weight: 700; }',
    '  .dt-tab-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0; }',
    '  .dt-tab-list button { background: var(--surface-muted); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px 12px; }',
    '  .dt-tab-list button[aria-selected="true"] { background: var(--accent); color: #ffffff; }',
    '  @media (max-width: 760px) { .site-shell { grid-template-columns: 1fr; } .site-nav { border-bottom: 1px solid var(--border); border-right: 0; } .content { padding: 28px 20px 40px; } .dt-card-grid { grid-template-columns: 1fr !important; } }',
    '</style>',
    ''
  ].join('\n');

const themeComponentsTsx = () =>
  [
    "import type { ReactNode } from 'react';",
    '',
    "type Tone = 'info' | 'note' | 'success' | 'warning' | 'danger';",
    '',
    'export function Callout({ children, title, tone = "info" }: { children?: ReactNode; title?: string; tone?: Tone }) {',
    '  return <aside className={`dt-callout dt-callout--${tone}`} data-component="Callout">{title ? <strong>{title}</strong> : null}<div>{children}</div></aside>;',
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
    'export function CodeBlock({ code, language, title }: { code?: string; language?: string; title?: string }) {',
    '  return <figure className="dt-code-block" data-component="CodeBlock">{title ? <figcaption>{title}</figcaption> : null}<pre><code data-language={language}>{code}</code></pre></figure>;',
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
    'export function Terminal({ command, output, title }: { command?: string; output?: string; title?: string }) {',
    '  return <figure className="dt-terminal" data-component="Terminal">{title ? <figcaption>{title}</figcaption> : null}<pre>{command ? <code>$ {command}</code> : null}{output ? <code>{output}</code> : null}</pre></figure>;',
    '}',
    '',
    'export function Divider({ label }: { label?: string }) {',
    '  return <div className="dt-divider" data-component="Divider">{label ? <span>{label}</span> : null}</div>;',
    '}',
    '',
    'export function Diagram({ svg, title }: { svg: string; title?: string }) {',
    '  return <figure className="dt-diagram" data-component="Diagram">{title ? <figcaption>{title}</figcaption> : null}<div dangerouslySetInnerHTML={{ __html: svg }} /></figure>;',
    '}',
    ''
  ].join('\n');

export const createGeneratedSiteAssets = (input: GeneratedSiteAssetsInput): GeneratedSiteAsset[] => [
  { path: 'package.json', content: generatedSitePackageJson() },
  { path: 'astro.config.mjs', content: astroConfigMjs() },
  { path: 'src/theme-build/glossary-data.mjs', content: glossaryDataMjs(input.glossary) },
  { path: 'src/theme-build/site-data.mjs', content: siteDataMjs(input) },
  { path: 'src/theme-build/glossary-remark.mjs', content: glossaryRemarkMjs() },
  { path: 'src/layouts/DocLayout.astro', content: docLayoutAstro() },
  { path: 'src/components/theme-components.tsx', content: themeComponentsTsx() }
];

export const writeGeneratedSiteAssets = async (
  outputDir: string,
  input: GeneratedSiteAssetsInput
): Promise<{ files: string[] }> => {
  const assets = createGeneratedSiteAssets(input);
  await Promise.all(
    assets.map(async (asset) => {
      const target = join(outputDir, asset.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, asset.content, 'utf8');
    })
  );
  return { files: assets.map((asset) => asset.path).toSorted((left, right) => left.localeCompare(right)) };
};

export type PagefindSearchIndexInput = {
  config?: PagefindServiceConfig;
  outputPath?: string;
  rootSelector?: string;
  siteDir: string;
};

export type PagefindSearchIndexResult = {
  errors: string[];
  files: string[];
  outputPath: string;
  pageCount: number;
};

export const buildPagefindSearchIndex = async (input: PagefindSearchIndexInput): Promise<PagefindSearchIndexResult> => {
  const pagefind = await import('pagefind');
  const outputPath = input.outputPath ?? join(input.siteDir, 'pagefind');
  const response = await pagefind.createIndex({
    rootSelector: input.rootSelector ?? '[data-pagefind-body]',
    ...input.config
  });
  const errors = [...response.errors];

  if (!response.index) {
    await pagefind.close();
    return { errors, files: [], outputPath, pageCount: 0 };
  }

  try {
    const indexed = await response.index.addDirectory({ path: input.siteDir, glob: '**/*.html' });
    errors.push(...indexed.errors);
    const written = await response.index.writeFiles({ outputPath });
    errors.push(...written.errors);

    return {
      errors,
      files: await collectRelativeFiles(outputPath),
      outputPath,
      pageCount: indexed.page_count
    };
  } finally {
    await response.index.deleteIndex();
    await pagefind.close();
  }
};

export type D2DiagramRenderOptions = Pick<
  CompileOptions,
  'center' | 'darkThemeID' | 'layout' | 'pad' | 'salt' | 'scale' | 'sketch' | 'themeID'
>;

export type D2DiagramRenderInput = {
  options?: D2DiagramRenderOptions;
  source: string;
};

export const renderD2DiagramSvg = async (input: D2DiagramRenderInput): Promise<string> => {
  const { D2 } = await import('@terrastruct/d2');
  const d2 = new D2();
  const options = {
    noXMLTag: true,
    pad: 32,
    sketch: true,
    ...input.options
  } satisfies CompileOptions;
  const compiled = await d2.compile({
    fs: { 'index.d2': input.source },
    inputPath: 'index.d2',
    options
  });
  return d2.render(compiled.diagram, { ...compiled.renderOptions, ...options });
};

export type MarkdownAstNode = {
  children?: MarkdownAstNode[];
  title?: string | null;
  type?: string;
  url?: string;
  value?: string;
};

type GlossaryMatch = {
  definition: string;
  id: string;
  label: string;
};

const skippedGlossaryParentTypes = new Set([
  'code',
  'definition',
  'inlineCode',
  'link',
  'linkReference',
  'mdxJsxFlowElement',
  'mdxJsxTextElement'
]);

const escapeRegExp = (value: string): string => value.replaceAll(/[\\^$.*+?()[\]{}|]/gu, '\\$&');

const glossaryMatches = (glossary: Glossary): GlossaryMatch[] =>
  glossary.terms
    .flatMap((term) => [term.term, ...(term.aliases ?? [])].map((label) => ({ ...term, label })))
    .toSorted((left, right) => right.label.length - left.label.length || left.label.localeCompare(right.label));

const glossaryPattern = (matches: readonly GlossaryMatch[]): RegExp | undefined => {
  if (matches.length === 0) {
    return undefined;
  }
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])(${matches.map((match) => escapeRegExp(match.label)).join('|')})(?![\\p{L}\\p{N}_])`,
    'giu'
  );
};

const linkedGlossaryNodes = (
  value: string,
  matchesByLabel: ReadonlyMap<string, GlossaryMatch>,
  pattern: RegExp
): MarkdownAstNode[] => {
  const nodes: MarkdownAstNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(pattern)) {
    const matchText = match[0];
    const index = match.index;
    const glossaryMatch = matchesByLabel.get(matchText.toLowerCase());
    if (!glossaryMatch) {
      continue;
    }

    if (index > cursor) {
      nodes.push({ type: 'text', value: value.slice(cursor, index) });
    }

    nodes.push({
      type: 'link',
      url: `/glossary/#${glossaryMatch.id}`,
      title: glossaryMatch.definition,
      children: [{ type: 'text', value: matchText }]
    });
    cursor = index + matchText.length;
  }

  if (cursor < value.length) {
    nodes.push({ type: 'text', value: value.slice(cursor) });
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', value }];
};

const linkGlossaryChildren = (
  node: MarkdownAstNode,
  matchesByLabel: ReadonlyMap<string, GlossaryMatch>,
  pattern: RegExp
): void => {
  if (!node.children || skippedGlossaryParentTypes.has(node.type ?? '')) {
    return;
  }

  const nextChildren: MarkdownAstNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value) {
      nextChildren.push(...linkedGlossaryNodes(child.value, matchesByLabel, pattern));
    } else {
      linkGlossaryChildren(child, matchesByLabel, pattern);
      nextChildren.push(child);
    }
  }

  node.children = nextChildren;
};

export const createGlossaryRemarkPlugin = (glossaryInput: unknown) => {
  const glossary = glossarySchema.parse(glossaryInput);
  const matches = glossaryMatches(glossary);
  const pattern = glossaryPattern(matches);
  const matchesByLabel = new Map(matches.map((match) => [match.label.toLowerCase(), match]));

  return () => (tree: MarkdownAstNode) => {
    if (pattern) {
      linkGlossaryChildren(tree, matchesByLabel, pattern);
    }
  };
};

export type LlmsPage = {
  content?: string;
  description?: string;
  title: string;
  url: string;
};

export type LlmsInput = {
  description?: string;
  pages: readonly LlmsPage[];
  siteName: string;
};

const normalizedLlmsPages = (pages: readonly LlmsPage[]): LlmsPage[] =>
  [...pages].toSorted((left, right) => left.url.localeCompare(right.url) || left.title.localeCompare(right.title));

const normalizeLlmsUrl = (url: string): string => {
  const withLeadingSlash = url.startsWith('/') ? url : `/${url}`;
  return withLeadingSlash.endsWith('/index.html') ? withLeadingSlash.slice(0, -10) : withLeadingSlash;
};

export const createLlmsText = (input: LlmsInput): string => {
  const lines = [`# ${input.siteName}`, ''];
  if (input.description) {
    lines.push(`> ${input.description}`, '');
  }
  lines.push('## Docs');

  for (const page of normalizedLlmsPages(input.pages)) {
    const description = page.description ? `: ${page.description}` : '';
    lines.push(`- [${page.title}](${normalizeLlmsUrl(page.url)})${description}`);
  }

  return `${lines.join('\n')}\n`;
};

export const createLlmsFullText = (input: LlmsInput): string => {
  const lines = [`# ${input.siteName}`, ''];
  if (input.description) {
    lines.push(`> ${input.description}`, '');
  }

  for (const page of normalizedLlmsPages(input.pages)) {
    lines.push(`## ${page.title}`, '', `URL: ${normalizeLlmsUrl(page.url)}`);
    if (page.description) {
      lines.push('', page.description);
    }
    if (page.content) {
      lines.push('', page.content.trim());
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
};

export const writeLlmsFiles = async (
  outputDir: string,
  input: LlmsInput
): Promise<{ fullPath: string; path: string }> => {
  const path = join(outputDir, 'llms.txt');
  const fullPath = join(outputDir, 'llms-full.txt');
  await Promise.all([
    writeFile(path, createLlmsText(input), 'utf8'),
    writeFile(fullPath, createLlmsFullText(input), 'utf8')
  ]);
  return { path, fullPath };
};

export type DocsMcpResource = {
  mimeType: 'text/html' | 'text/markdown' | 'text/plain';
  name: string;
  text: string;
  uri: string;
};

export type DocsMcpRequest = {
  id?: number | string | null;
  jsonrpc?: '2.0';
  method: string;
  params?: unknown;
};

export type DocsMcpResponse = {
  error?: { code: number; message: string };
  id: number | string | null;
  jsonrpc: '2.0';
  result?: unknown;
};

const docsMcpRequestSchema = z.strictObject({
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  jsonrpc: z.literal('2.0').optional(),
  method: z.string().min(1),
  params: z.unknown().optional()
});

const docsMcpReadParamsSchema = z.strictObject({
  uri: z.string().min(1)
});

export const createDocsMcpResources = (
  input: LlmsInput & { llmsFullText?: string; llmsText?: string }
): DocsMcpResource[] => {
  const resources: DocsMcpResource[] = [
    {
      uri: 'docstube://docs/llms.txt',
      name: 'llms.txt',
      mimeType: 'text/plain',
      text: input.llmsText ?? createLlmsText(input)
    },
    {
      uri: 'docstube://docs/llms-full.txt',
      name: 'llms-full.txt',
      mimeType: 'text/plain',
      text: input.llmsFullText ?? createLlmsFullText(input)
    }
  ];

  for (const page of normalizedLlmsPages(input.pages)) {
    resources.push({
      uri: `docstube://docs${normalizeLlmsUrl(page.url)}`,
      name: page.title,
      mimeType: 'text/markdown',
      text: page.content ?? ''
    });
  }

  return resources;
};

export const createDocsMcpServer = (resources: readonly DocsMcpResource[]) => {
  const resourceMap = new Map(resources.map((resource) => [resource.uri, resource]));

  return {
    handleRequest: (requestInput: unknown): DocsMcpResponse => {
      const parsed = docsMcpRequestSchema.safeParse(requestInput);
      const id =
        parsed.success && parsed.data.id !== undefined
          ? parsed.data.id
          : typeof requestInput === 'object' && requestInput && 'id' in requestInput
            ? ((requestInput as { id?: number | string | null }).id ?? null)
            : null;

      if (!parsed.success) {
        return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid MCP request' } };
      }

      if (parsed.data.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { resources: {} },
            serverInfo: { name: 'docstube-docs', version: '0.0.0' }
          }
        };
      }

      if (parsed.data.method === 'resources/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resources: resources.map(({ mimeType, name, uri }) => ({ mimeType, name, uri }))
          }
        };
      }

      if (parsed.data.method === 'resources/read') {
        const params = docsMcpReadParamsSchema.safeParse(parsed.data.params);
        if (!params.success) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'resources/read requires a uri' } };
        }

        const resource = resourceMap.get(params.data.uri);
        if (!resource) {
          return { jsonrpc: '2.0', id, error: { code: -32004, message: `Unknown docs resource: ${params.data.uri}` } };
        }

        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri: resource.uri,
                mimeType: resource.mimeType,
                text: resource.text
              }
            ]
          }
        };
      }

      if (parsed.data.method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: [] } };
      }

      if (parsed.data.method === 'prompts/list') {
        return { jsonrpc: '2.0', id, result: { prompts: [] } };
      }

      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown MCP method: ${parsed.data.method}` } };
    }
  };
};

export type FaqItem = {
  answer: string;
  question: string;
};

export type SeoPage = {
  description?: string;
  faq?: readonly FaqItem[];
  title: string;
  url: string;
};

export type SeoInput = {
  pages: readonly SeoPage[];
  siteName: string;
  siteUrl: string;
};

export type SeoMetadata = {
  canonicalUrl: string;
  description?: string;
  openGraph: {
    description?: string;
    title: string;
    type: 'article';
    url: string;
  };
  structuredData: Record<string, unknown> | Record<string, unknown>[];
  title: string;
};

export const faqItemSchema = z.strictObject({
  answer: z.string().min(1),
  question: z.string().min(1)
});

export const seoPageSchema = z.strictObject({
  description: z.string().min(1).optional(),
  faq: z.array(faqItemSchema).optional(),
  title: z.string().min(1),
  url: z.string().min(1)
});

const normalizedSiteUrl = (siteUrl: string): string => (siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`);

export const createCanonicalUrl = (siteUrl: string, path: string): string =>
  new URL(normalizeLlmsUrl(path), normalizedSiteUrl(siteUrl)).href;

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export const createSitemapXml = (input: SeoInput): string => {
  const urls = normalizedLlmsPages(input.pages).map(
    (page) => `  <url>\n    <loc>${escapeXml(createCanonicalUrl(input.siteUrl, page.url))}</loc>\n  </url>`
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    ''
  ].join('\n');
};

export const createPageStructuredData = (input: SeoInput & { page: SeoPage }): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  headline: input.page.title,
  description: input.page.description,
  url: createCanonicalUrl(input.siteUrl, input.page.url),
  mainEntityOfPage: createCanonicalUrl(input.siteUrl, input.page.url),
  publisher: {
    '@type': 'Organization',
    name: input.siteName
  }
});

export const createFaqStructuredData = (faq: readonly FaqItem[]): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faq.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.answer
    }
  }))
});

export const createSeoMetadata = (input: SeoInput & { page: SeoPage }): SeoMetadata => {
  const canonicalUrl = createCanonicalUrl(input.siteUrl, input.page.url);
  const title = `${input.page.title} | ${input.siteName}`;
  const structuredData = input.page.faq?.length
    ? [createPageStructuredData(input), createFaqStructuredData(input.page.faq)]
    : createPageStructuredData(input);

  return {
    canonicalUrl,
    description: input.page.description,
    openGraph: {
      title,
      description: input.page.description,
      type: 'article',
      url: canonicalUrl
    },
    structuredData,
    title
  };
};

export const writeSeoFiles = async (outputDir: string, input: SeoInput): Promise<{ sitemapPath: string }> => {
  const sitemapPath = join(outputDir, 'sitemap.xml');
  await writeFile(sitemapPath, createSitemapXml(input), 'utf8');
  return { sitemapPath };
};
