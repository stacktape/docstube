import type { z } from 'zod';
import { contentHash } from './hashing.ts';
import { mintId, idPrefixes } from './primitives.ts';
import type { docstubeConfigSchema } from './config-schema.ts';
import type { PageEntity } from './entity-schema.ts';
import type { PageShard } from './manifest-schema.ts';

// Shared test fixtures. Deterministic where determinism matters (hashes), minted where it does
// not (ids). Used by contracts tests and by downstream packages' tests.

const commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const now = '2026-07-12T00:00:00.000Z';

export const buildFixturePage = (): PageEntity => ({
  id: mintId(idPrefixes.page),
  kind: 'page',
  slug: 'getting-started/installation',
  title: 'Installation',
  preamble: [
    {
      id: mintId(idPrefixes.block),
      kind: 'block',
      blockType: 'paragraph',
      contentHash: contentHash('Install docstube with your package manager of choice.'),
      variants: [],
      claims: [],
      guarantee: 'scored',
      provenance: { sources: [], seedContext: [], observedReads: [], verifications: [], reviews: [] }
    }
  ],
  sections: [
    {
      id: mintId(idPrefixes.section),
      kind: 'section',
      title: 'Requirements',
      level: 2,
      anchor: 'requirements',
      guarantee: 'proven',
      blocks: [
        {
          id: mintId(idPrefixes.block),
          kind: 'block',
          blockType: 'code-example',
          language: 'bash',
          contentHash: contentHash('npm install -g docstube'),
          variants: [],
          guarantee: 'proven',
          provenance: {
            sources: [
              {
                symbol: `ts:${'0'.repeat(64)}`,
                file: 'src/cli.ts',
                span: [1, 12],
                commit
              }
            ],
            seedContext: [],
            observedReads: [{ file: 'src/cli.ts', contentHash: '1'.repeat(64) }],
            verifications: [
              {
                verifier: 'snippet-exec-bash',
                plugin: '@docstube/verifiers',
                pluginVersion: '0.0.2',
                result: 'pass',
                at: now
              }
            ],
            reviews: []
          },
          claims: [
            {
              id: mintId(idPrefixes.claim),
              kind: 'claim',
              text: 'docstube installs globally via npm',
              anchor: { quote: 'npm install -g docstube', prefix: '', suffix: '' },
              claimClass: 'code-sample',
              guarantee: 'proven'
            }
          ]
        }
      ]
    }
  ],
  guarantee: 'scored',
  provenance: { sources: [], seedContext: [], observedReads: [], verifications: [], reviews: [] }
});

export const buildFixturePageShard = (page: PageEntity): PageShard => ({
  schemaVersion: 1,
  locale: 'en',
  version: 'latest',
  sourceCommit: commit,
  generatedAt: now,
  page,
  flags: []
});

export const fixtureConfigInput: z.input<typeof docstubeConfigSchema> = {
  schemaVersion: 1,
  docType: 'external-library',
  personas: [{ id: 'app-developer', description: 'Builds apps on top of the library' }],
  site: { title: 'Fixture Docs' }
};
