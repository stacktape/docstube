import type { z } from 'zod';
import { docstubeConfigSchema } from './config-schema';
import type { InvalidCase } from './fixtures';
import { glossarySchema } from './glossary-schema';
import { iaSchema } from './ia-schema';

// Reusable valid/invalid fixtures for the config family, mirroring the primitive fixtures in
// `fixtures.ts`. Valid cases are typed by the schema input shape so on-disk files may omit
// fields that carry defaults. Invalid cases assert the issue paths a failure must report.

export type ConfigFamilyFixtures<S extends z.ZodType> = {
  schema: S;
  valid: ReadonlyArray<{ name: string; value: z.input<S> }>;
  invalid: ReadonlyArray<InvalidCase>;
};

const minimalConfig = {
  site: { name: 'Acme Toolkit' },
  docsType: 'library',
  personas: [{ id: 'developer', title: 'Application developer' }],
  agents: { writer: { adapter: 'codex' } }
} satisfies z.input<typeof docstubeConfigSchema>;

export const docstubeConfigFixtures: ConfigFamilyFixtures<typeof docstubeConfigSchema> = {
  schema: docstubeConfigSchema,
  valid: [
    { name: 'minimal config relies on defaults', value: minimalConfig },
    {
      name: 'full config with reserved screenshots object',
      value: {
        version: 1,
        site: {
          name: 'Acme Toolkit',
          description: 'Docs for the Acme toolkit',
          url: 'https://docs.acme.dev',
          locale: 'en'
        },
        docsType: 'library',
        output: { dir: 'docs', layout: 'sectioned' },
        theme: {
          tokens: { 'color-accent': '#3b82f6', 'radius-base': 8 },
          components: ['Callout', 'Screenshot'],
          credit: true
        },
        personas: [
          { id: 'developer', title: 'Application developer', goals: ['integrate quickly'] },
          { id: 'maintainer', title: 'Library maintainer', description: 'Owns the public API' }
        ],
        agents: {
          writer: { adapter: 'codex', model: 'gpt-5-codex' },
          reviewer: { adapter: 'claude' },
          verifier: { adapter: 'api', provider: 'openai', baseUrl: 'https://api.openai.com/v1' }
        },
        sources: [
          { kind: 'path', path: 'README.md' },
          { kind: 'git', url: 'https://github.com/acme/toolkit.git', ref: 'main' },
          { kind: 'mcp', server: 'linear' }
        ],
        caps: { maxUsd: 5, maxTokens: 2_000_000, maxPages: 40 },
        ia: 'ia.yml',
        glossary: 'glossary.yaml',
        screenshots: { enabled: false, viewport: { width: 1280, height: 720 } }
      }
    },
    {
      name: 'reserved screenshots object accepts arbitrary keys',
      value: { ...minimalConfig, screenshots: { capture: 'later', targets: ['home'] } }
    }
  ],
  invalid: [
    { name: 'missing site', value: { ...minimalConfig, site: undefined }, expectedPaths: [['site']] },
    { name: 'unknown doc type', value: { ...minimalConfig, docsType: 'novel' }, expectedPaths: [['docsType']] },
    { name: 'empty personas', value: { ...minimalConfig, personas: [] }, expectedPaths: [['personas']] },
    {
      name: 'invalid layout',
      value: { ...minimalConfig, output: { layout: 'grid' } },
      expectedPaths: [['output', 'layout']]
    },
    {
      name: 'api adapter without provider or baseUrl',
      value: { ...minimalConfig, agents: { writer: { adapter: 'api' } } },
      expectedPaths: [['agents', 'writer', 'provider']]
    },
    {
      name: 'reserved screenshots must be an object',
      value: { ...minimalConfig, screenshots: ['home'] },
      expectedPaths: [['screenshots']]
    },
    {
      name: 'unknown top-level key is rejected',
      value: { ...minimalConfig, scores: { quality: 9 } },
      expectedPaths: [[]]
    }
  ]
};

export const iaFixtures: ConfigFamilyFixtures<typeof iaSchema> = {
  schema: iaSchema,
  valid: [
    {
      name: 'nested nav tree',
      value: {
        nav: [
          { id: 'overview', title: 'Overview', brief: 'What the toolkit is' },
          {
            id: 'guides',
            title: 'Guides',
            children: [{ id: 'install', title: 'Install', path: 'guides/install.mdx' }]
          }
        ]
      }
    }
  ],
  invalid: [
    { name: 'empty nav', value: { nav: [] }, expectedPaths: [['nav']] },
    { name: 'missing node title', value: { nav: [{ id: 'overview' }] }, expectedPaths: [['nav', 0, 'title']] },
    {
      name: 'invalid child id',
      value: { nav: [{ id: 'guides', title: 'Guides', children: [{ id: 'Install', title: 'Install' }] }] },
      expectedPaths: [['nav', 0, 'children', 0, 'id']]
    }
  ]
};

export const glossaryFixtures: ConfigFamilyFixtures<typeof glossarySchema> = {
  schema: glossarySchema,
  valid: [
    {
      name: 'terms with aliases',
      value: {
        terms: [
          {
            id: 'codemap',
            term: 'Codemap',
            definition: 'A structural map of the source repo.',
            aliases: ['structural map']
          },
          { id: 'persona', term: 'Persona', definition: 'A documentation audience target.' }
        ]
      }
    }
  ],
  invalid: [
    {
      name: 'term missing definition',
      value: { terms: [{ id: 'codemap', term: 'Codemap' }] },
      expectedPaths: [['terms', 0, 'definition']]
    },
    {
      name: 'invalid term id',
      value: { terms: [{ id: 'Codemap', term: 'Codemap', definition: 'A structural map.' }] },
      expectedPaths: [['terms', 0, 'id']]
    }
  ]
};

export const configFamilyFixtures = {
  docstubeConfig: docstubeConfigFixtures,
  ia: iaFixtures,
  glossary: glossaryFixtures
} as const;

export type ConfigFamilyFixtureName = keyof typeof configFamilyFixtures;
