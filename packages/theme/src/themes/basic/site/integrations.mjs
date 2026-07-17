// Basic theme Astro integrations (ThemeBuild.integrationsModule contract: default export is an
// array of integrations the kernel spreads into the generated astro.config.mjs).
import react from '@astrojs/react';

export default [react()];
