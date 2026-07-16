import { z } from 'zod';
import type { ComponentDefinition } from '@docstube/plugin-sdk';

// Built-in registry components. Each one contributes the block type `component:<Name>` to the
// open enum (ARCHITECTURE.md §3.2); props are validated against these schemas at extraction and
// verification time. Built-ins have no `source` — emit-site vendors their implementations.

const childrenProps = {
  children: z.unknown().optional()
} as const;

const toneSchema = z.enum(['info', 'note', 'success', 'warning', 'danger']);

const tableCellSchema = z.union([z.string(), z.number(), z.boolean()]);

export const builtinComponents: ComponentDefinition[] = [
  {
    name: 'Callout',
    description: 'Highlighted note, warning, success, or danger block.',
    category: 'callout',
    propsSchema: z.strictObject({
      tone: toneSchema.default('info'),
      title: z.string().min(1).optional(),
      ...childrenProps
    })
  },
  {
    name: 'CodeBlock',
    description: 'Single code sample with optional language and title.',
    category: 'code',
    propsSchema: z.strictObject({
      code: z.string().optional(),
      language: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      ...childrenProps
    })
  },
  {
    name: 'CodeGroup',
    description: 'Grouped code samples for alternate languages or package managers.',
    category: 'code',
    propsSchema: z.strictObject({
      title: z.string().min(1).optional(),
      ...childrenProps
    })
  },
  {
    name: 'Terminal',
    description: 'Terminal command and output block.',
    category: 'code',
    propsSchema: z.strictObject({
      command: z.string().min(1).optional(),
      output: z.string().optional(),
      title: z.string().min(1).optional(),
      ...childrenProps
    })
  },
  {
    name: 'Card',
    description: 'Compact link or summary card.',
    category: 'content',
    propsSchema: z.strictObject({
      title: z.string().min(1),
      href: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      ...childrenProps
    })
  },
  {
    name: 'CardGrid',
    description: 'Responsive grid for cards.',
    category: 'content',
    propsSchema: z.strictObject({
      columns: z.int().min(1).max(4).default(2),
      ...childrenProps
    })
  },
  {
    name: 'Steps',
    description: 'Ordered implementation or setup steps.',
    category: 'content',
    propsSchema: z.strictObject({
      items: z.array(z.string().min(1)).min(1)
    })
  },
  {
    name: 'Tabs',
    description: 'Small mutually exclusive content panels.',
    category: 'content',
    propsSchema: z.strictObject({
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
    })
  },
  {
    name: 'FileTree',
    description: 'Repository file tree.',
    category: 'code',
    propsSchema: z.strictObject({
      entries: z
        .array(
          z.strictObject({
            path: z.string().min(1),
            kind: z.enum(['file', 'directory']).default('file')
          })
        )
        .min(1)
    })
  },
  {
    name: 'Badge',
    description: 'Inline status or category badge.',
    category: 'content',
    propsSchema: z.strictObject({
      tone: toneSchema.default('info'),
      label: z.string().min(1).optional(),
      ...childrenProps
    })
  },
  {
    name: 'ParamTable',
    description: 'Parameter, option, or field table.',
    category: 'api',
    propsSchema: z.strictObject({
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
    })
  },
  {
    name: 'ComparisonTable',
    description: 'Feature or behavior comparison matrix.',
    category: 'content',
    propsSchema: z.strictObject({
      columns: z.array(z.string().min(1)).min(2),
      rows: z.array(z.array(tableCellSchema).min(2)).min(1)
    })
  }
];

export const builtinComponentNames: string[] = builtinComponents.map((component) => component.name);
