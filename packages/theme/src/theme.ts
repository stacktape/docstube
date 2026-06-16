import { z } from 'zod';
import { layouts, registrySchema, reservedComponentNames } from '@docstube/contracts';
import type { ComponentRegistry, Layout, RegistryComponent } from '@docstube/contracts';

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
  'diagram-props': z.strictObject({
    source: z.string().min(1),
    title: z.string().min(1).optional(),
    kind: z.literal('d2').default('d2')
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
