import type { z } from 'zod';
import { cacheKeyInputSchema } from './cache-key';
import { checkResultSchema } from './check-result-schema';
import { criteriaChecklistSchema } from './criteria-schema';
import { feedbackRecordSchema } from './feedback-schema';
import { findingSchema } from './findings-schema';
import type { InvalidCase, IssuePath } from './fixtures';
import { manifestSchema } from './manifest-schema';
import { generatedPageFrontmatterSchema, pageIdSchema, sectionIdSchema } from './page-schema';
import { registrySchema } from './registry-schema';

// Reusable valid/invalid fixtures for the non-config S0 contracts, mirroring `config-fixtures.ts`.
// Valid cases are typed by each schema's input shape so fixtures may omit default-bearing fields.
// Invalid cases assert the issue paths a failure must report.

export type S0Fixtures<S extends z.ZodType> = {
  schema: S;
  valid: ReadonlyArray<{ name: string; value: z.input<S> }>;
  invalid: ReadonlyArray<InvalidCase>;
};

const root: ReadonlyArray<IssuePath> = [[]];

const hash = (char: string): string => char.repeat(64);

const pageIdFixtures: S0Fixtures<typeof pageIdSchema> = {
  schema: pageIdSchema,
  valid: [
    { name: 'single segment', value: 'overview' },
    { name: 'nested segments', value: 'guides/install' }
  ],
  invalid: [
    { name: 'empty', value: '', expectedPaths: root },
    { name: 'uppercase', value: 'Overview', expectedPaths: root },
    { name: 'leading slash', value: '/overview', expectedPaths: root },
    { name: 'trailing slash', value: 'guides/', expectedPaths: root },
    { name: 'underscore', value: 'getting_started', expectedPaths: root }
  ]
};

const sectionIdFixtures: S0Fixtures<typeof sectionIdSchema> = {
  schema: sectionIdSchema,
  valid: [
    { name: 'single word', value: 'install' },
    { name: 'kebab', value: 'quick-start' }
  ],
  invalid: [
    { name: 'empty', value: '', expectedPaths: root },
    { name: 'slash not allowed', value: 'guides/install', expectedPaths: root },
    { name: 'uppercase', value: 'Install', expectedPaths: root }
  ]
};

const generatedStamp = {
  by: 'docstube',
  version: '0.0.2',
  at: '2026-06-16T12:00:00Z'
} as const;

const generatedPageFrontmatterFixtures: S0Fixtures<typeof generatedPageFrontmatterSchema> = {
  schema: generatedPageFrontmatterSchema,
  valid: [
    {
      name: 'minimal page',
      value: { id: 'overview', title: 'Overview', generated: generatedStamp }
    },
    {
      name: 'full page with sections and personas',
      value: {
        id: 'guides/install',
        title: 'Install',
        description: 'How to install the toolkit',
        layout: 'sectioned',
        personas: ['developer', 'maintainer'],
        sections: ['requirements', 'quick-start'],
        generated: generatedStamp
      }
    }
  ],
  invalid: [
    {
      name: 'missing title',
      value: { id: 'overview', generated: generatedStamp },
      expectedPaths: [['title']]
    },
    {
      name: 'invalid page id',
      value: { id: 'Overview', title: 'Overview', generated: generatedStamp },
      expectedPaths: [['id']]
    },
    {
      name: 'invalid section id',
      value: { id: 'overview', title: 'Overview', sections: ['Quick-Start'], generated: generatedStamp },
      expectedPaths: [['sections', 0]]
    },
    {
      name: 'missing generated stamp',
      value: { id: 'overview', title: 'Overview' },
      expectedPaths: [['generated']]
    }
  ]
};

const findingFixtures: S0Fixtures<typeof findingSchema> = {
  schema: findingSchema,
  valid: [
    {
      name: 'verifier blocker with location',
      value: {
        code: 'mdx-compile',
        severity: 'blocker',
        origin: 'verifier',
        message: 'MDX failed to compile',
        pageId: 'guides/install',
        location: { path: 'docs/guides/install.mdx', line: 12, column: 3 }
      }
    },
    {
      name: 'reviewer minor',
      value: { code: 'audience-fit', severity: 'minor', origin: 'reviewer', message: 'Too much jargon for beginners' }
    }
  ],
  invalid: [
    {
      name: 'unknown severity',
      value: { code: 'mdx-compile', severity: 'critical', origin: 'verifier', message: 'boom' },
      expectedPaths: [['severity']]
    },
    {
      name: 'empty message',
      value: { code: 'mdx-compile', severity: 'major', origin: 'verifier', message: '' },
      expectedPaths: [['message']]
    },
    {
      name: 'invalid code',
      value: { code: 'MDX_Compile', severity: 'major', origin: 'verifier', message: 'boom' },
      expectedPaths: [['code']]
    }
  ]
};

const criteriaChecklistFixtures: S0Fixtures<typeof criteriaChecklistSchema> = {
  schema: criteriaChecklistSchema,
  valid: [
    {
      name: 'persona checklist',
      value: {
        id: 'developer-fit',
        title: 'Developer audience fit',
        scope: 'persona',
        target: 'developer',
        items: [
          { id: 'runnable-examples', statement: 'Every example is runnable as written' },
          { id: 'no-unexplained-jargon', statement: 'No unexplained jargon', severity: 'minor' }
        ]
      }
    },
    {
      name: 'global checklist without target',
      value: {
        id: 'baseline',
        title: 'Baseline quality',
        scope: 'global',
        items: [{ id: 'links-resolve', statement: 'All internal links resolve' }]
      }
    }
  ],
  invalid: [
    {
      name: 'empty items',
      value: { id: 'developer-fit', title: 'Developer fit', scope: 'global', items: [] },
      expectedPaths: [['items']]
    },
    {
      name: 'persona scope without target',
      value: {
        id: 'developer-fit',
        title: 'Developer fit',
        scope: 'persona',
        items: [{ id: 'runnable', statement: 'Examples run' }]
      },
      expectedPaths: [['target']]
    }
  ]
};

const feedbackRecordFixtures: S0Fixtures<typeof feedbackRecordSchema> = {
  schema: feedbackRecordSchema,
  valid: [
    {
      name: 'docs-scope feedback',
      value: { id: 'fb-1', createdAt: '2026-06-16T12:00:00Z', scope: 'docs', message: 'Tone is too formal' }
    },
    {
      name: 'section feedback',
      value: {
        id: 'fb-2',
        createdAt: '2026-06-16T12:00:00Z',
        scope: 'section',
        pageId: 'guides/install',
        sectionId: 'quick-start',
        message: 'Add a prerequisites note',
        category: 'instruction'
      }
    },
    {
      name: 'element feedback',
      value: {
        id: 'fb-3',
        createdAt: '2026-06-16T12:00:00Z',
        scope: 'element',
        pageId: 'overview',
        selector: '#intro > p:nth-child(2)',
        message: 'Wrong term used here'
      }
    }
  ],
  invalid: [
    {
      name: 'page scope without pageId',
      value: { id: 'fb-4', createdAt: '2026-06-16T12:00:00Z', scope: 'page', message: 'x' },
      expectedPaths: [['pageId']]
    },
    {
      name: 'section scope without sectionId',
      value: {
        id: 'fb-5',
        createdAt: '2026-06-16T12:00:00Z',
        scope: 'section',
        pageId: 'overview',
        message: 'x'
      },
      expectedPaths: [['sectionId']]
    },
    {
      name: 'element scope without selector',
      value: {
        id: 'fb-6',
        createdAt: '2026-06-16T12:00:00Z',
        scope: 'element',
        pageId: 'overview',
        message: 'x'
      },
      expectedPaths: [['selector']]
    }
  ]
};

const manifestFixtures: S0Fixtures<typeof manifestSchema> = {
  schema: manifestSchema,
  valid: [
    {
      name: 'empty manifest relies on defaults',
      value: { generatedWith: { name: 'docstube', version: '0.0.2' } }
    },
    {
      name: 'manifest with one page',
      value: {
        generatedWith: { name: 'docstube', version: '0.0.2' },
        pages: [
          {
            id: 'guides/install',
            path: 'docs/guides/install.mdx',
            title: 'Install',
            status: 'passed',
            sections: ['requirements', 'quick-start'],
            provenance: {
              seedHash: 'a'.repeat(64),
              reads: ['src/install.ts'],
              citations: [{ path: 'src/install.ts', symbol: 'install' }]
            }
          }
        ]
      }
    }
  ],
  invalid: [
    {
      name: 'missing generatedWith',
      value: { pages: [] },
      expectedPaths: [['generatedWith']]
    },
    {
      name: 'bad seed hash',
      value: {
        generatedWith: { name: 'docstube', version: '0.0.2' },
        pages: [
          {
            id: 'overview',
            path: 'docs/overview.mdx',
            status: 'passed',
            provenance: { seedHash: 'not-a-hash' }
          }
        ]
      },
      expectedPaths: [['pages', 0, 'provenance', 'seedHash']]
    },
    {
      name: 'invalid page status',
      value: {
        generatedWith: { name: 'docstube', version: '0.0.2' },
        pages: [
          {
            id: 'overview',
            path: 'docs/overview.mdx',
            status: 'approved',
            provenance: { seedHash: 'a'.repeat(64) }
          }
        ]
      },
      expectedPaths: [['pages', 0, 'status']]
    }
  ]
};

const checkResultFixtures: S0Fixtures<typeof checkResultSchema> = {
  schema: checkResultSchema,
  valid: [
    { name: 'passed', value: { checkId: 'mdx-compile', status: 'passed' } },
    {
      name: 'failed with finding',
      value: {
        checkId: 'mdx-compile',
        status: 'failed',
        findings: [{ code: 'mdx-compile', severity: 'blocker', origin: 'verifier', message: 'compile error' }]
      }
    },
    { name: 'skipped', value: { checkId: 'python-snippet', status: 'skipped', reason: 'pyright not installed' } },
    { name: 'errored', value: { checkId: 'link-check', status: 'errored', error: 'network unavailable' } }
  ],
  invalid: [
    {
      name: 'failed without findings',
      value: { checkId: 'mdx-compile', status: 'failed', findings: [] },
      expectedPaths: [['findings']]
    },
    {
      name: 'skipped without reason',
      value: { checkId: 'python-snippet', status: 'skipped' },
      expectedPaths: [['reason']]
    },
    {
      name: 'unknown status',
      value: { checkId: 'mdx-compile', status: 'warned' },
      expectedPaths: [['status']]
    }
  ]
};

const cacheKeyInputFixtures: S0Fixtures<typeof cacheKeyInputSchema> = {
  schema: cacheKeyInputSchema,
  valid: [
    {
      name: 'agent step cache input',
      value: {
        promptHash: hash('a'),
        inputHashes: [hash('b'), hash('c')],
        model: 'gpt-5-codex',
        adapterId: 'codex',
        adapterVersion: '1.2.3'
      }
    }
  ],
  invalid: [
    {
      name: 'bad prompt hash',
      value: {
        promptHash: 'not-a-hash',
        inputHashes: [hash('b')],
        model: 'gpt-5-codex',
        adapterId: 'codex',
        adapterVersion: '1.2.3'
      },
      expectedPaths: [['promptHash']]
    },
    {
      name: 'empty model id',
      value: {
        promptHash: hash('a'),
        inputHashes: [hash('b')],
        model: '',
        adapterId: 'codex',
        adapterVersion: '1.2.3'
      },
      expectedPaths: [['model']]
    },
    {
      name: 'bad adapter version',
      value: {
        promptHash: hash('a'),
        inputHashes: [hash('b')],
        model: 'gpt-5-codex',
        adapterId: 'codex',
        adapterVersion: 'latest'
      },
      expectedPaths: [['adapterVersion']]
    }
  ]
};

const registryFixtures: S0Fixtures<typeof registrySchema> = {
  schema: registrySchema,
  valid: [
    {
      name: 'registry with stable and reserved components',
      value: {
        components: [
          { name: 'Callout', description: 'Highlighted aside', category: 'content', props: { ref: 'callout-props' } },
          { name: 'Screenshot', status: 'reserved', props: { ref: 'screenshot-props' } }
        ]
      }
    }
  ],
  invalid: [
    {
      name: 'empty components',
      value: { components: [] },
      expectedPaths: [['components']]
    },
    {
      name: 'non-pascal component name',
      value: { components: [{ name: 'callout', props: { ref: 'callout-props' } }] },
      expectedPaths: [['components', 0, 'name']]
    },
    {
      name: 'invalid prop schema ref',
      value: { components: [{ name: 'Callout', props: { ref: 'Callout_Props' } }] },
      expectedPaths: [['components', 0, 'props', 'ref']]
    },
    {
      name: 'reserved component name without reserved status',
      value: { components: [{ name: 'Screenshot', props: { ref: 'screenshot-props' } }] },
      expectedPaths: [['components', 0, 'status']]
    },
    {
      name: 'reserved status on non-reserved component',
      value: { components: [{ name: 'Callout', status: 'reserved', props: { ref: 'callout-props' } }] },
      expectedPaths: [['components', 0, 'status']]
    }
  ]
};

export const s0Fixtures = {
  pageId: pageIdFixtures,
  sectionId: sectionIdFixtures,
  generatedPageFrontmatter: generatedPageFrontmatterFixtures,
  finding: findingFixtures,
  criteriaChecklist: criteriaChecklistFixtures,
  feedbackRecord: feedbackRecordFixtures,
  manifest: manifestFixtures,
  checkResult: checkResultFixtures,
  cacheKeyInput: cacheKeyInputFixtures,
  registry: registryFixtures
} as const;

export type S0FixtureName = keyof typeof s0Fixtures;
