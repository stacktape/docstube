import { definePlugin } from '@docstube/plugin-sdk';
import { builtinComponents, builtinComponentNames } from './components.ts';

// The built-in theme plugin. Core registers it through the same host API third-party plugins use
// (ARCHITECTURE.md §6.2), so every builtin component enters the block-type registry as
// `component:<Name>` with its Zod props schema.

export const themePlugin = definePlugin({
  apiVersion: 1,
  name: '@docstube/theme',
  version: '0.0.2',
  description:
    'Built-in docstube theme: registry components (Callout, CodeBlock, Tabs, …) and the self-contained Astro site emitter.',
  capabilities: [{ kind: 'component', ids: builtinComponentNames }],
  register: (host) => {
    for (const component of builtinComponents) {
      host.component(component);
    }
  }
});

export default themePlugin;
