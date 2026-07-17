// Stacktape theme Astro integrations (ThemeBuild.integrationsModule contract: default export is
// an array of integrations the kernel spreads into the generated astro.config.mjs). Tailwind 4
// wires through the postcss plugin injected into Vite here — the dedicated @tailwindcss/vite
// plugin breaks on rolldown-based Astro 6, and themes cannot own postcss.config files.
import react from '@astrojs/react';
import tailwindPostcss from '@tailwindcss/postcss';

const tailwind = () => ({
  name: 'docstube-stacktape-tailwind',
  hooks: {
    'astro:config:setup': ({ updateConfig }) => {
      updateConfig({ vite: { css: { postcss: { plugins: [tailwindPostcss()] } } } });
    }
  }
});

export default [react(), tailwind()];
