// @ts-check
import { defineConfig } from 'astro/config';

// Static marketing site for docstube. Homepage copy variants live at /v1../v10,
// with a gallery index at /. Kept intentionally framework-light: plain .astro +
// Tailwind (v4 via PostCSS), no client framework, so pages ship as fast static HTML.
export default defineConfig({
  site: 'https://docstube.dev',
  trailingSlash: 'ignore',
  build: { format: 'directory' }
});
