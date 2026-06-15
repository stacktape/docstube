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
