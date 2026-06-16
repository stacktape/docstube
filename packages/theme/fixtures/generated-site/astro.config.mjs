import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import { createGlossaryRemarkPlugin } from './src/theme-build/glossary-remark.mjs';

const glossary = {
  terms: [
    {
      id: 'codemap',
      term: 'Codemap',
      definition: 'A structural map of the source repository.'
    },
    {
      id: 'deterministic-verifier',
      term: 'deterministic verifier',
      definition: 'A non-AI check with structured findings.',
      aliases: ['deterministic verifiers']
    }
  ]
};

export default defineConfig({
  integrations: [mdx({ remarkPlugins: [createGlossaryRemarkPlugin(glossary)] }), react()],
  output: 'static',
  site: 'https://docs.example.test'
});
