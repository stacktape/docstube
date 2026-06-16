import { readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { glossarySchema, layouts, registrySchema, reservedComponentNames } from '@docstube/contracts';
import type { PagefindServiceConfig } from 'pagefind';
import type { CompileOptions } from '@terrastruct/d2';
import type { ComponentRegistry, Glossary, Layout, RegistryComponent } from '@docstube/contracts';

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
