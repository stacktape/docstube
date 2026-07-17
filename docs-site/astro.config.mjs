import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';

// TODO(review-ui): rehype plugin slot — a `markdown.processor` rehype plugin will inject
// data-entity-id attributes on arbitrary blocks from the manifest sidecar (ARCHITECTURE.md
// §3.4). Section-level guarantee chips already ship (injected by the layout by anchor);
// block-level addressing is deliberately not faked in v1.
export default defineConfig({
  integrations: [mdx()],
  output: 'static',
  markdown: {
    shikiConfig: {
      themes: { light: "vitesse-light", dark: "dark-plus" },
    }
  },
});
