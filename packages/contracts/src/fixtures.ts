import type { z } from 'zod';
import { contentHash } from './hashing.ts';
import { mintId, idPrefixes } from './primitives.ts';
import type { ClaimLedger } from './claim-ledger-schema.ts';
import type { docstubeConfigSchema } from './config-schema.ts';
import type { PageEntity } from './entity-schema.ts';
import type { KnowledgeFact, KnowledgeNeed } from './knowledge-schema.ts';
import type { PageShard } from './manifest-schema.ts';
import type { PublicationDecision } from './publication-schema.ts';
import type { StructuralFinding } from './structural-finding-schema.ts';

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

const fixtureSymbolHash = `ts:${'2'.repeat(64)}`;

export const buildFixtureClaimLedger = (pageId: string = mintId(idPrefixes.page)): ClaimLedger => {
  const blockId = mintId(idPrefixes.block);
  return {
    schemaVersion: 1,
    pageId,
    sourceRevision: commit,
    claims: [
      {
        claimId: mintId(idPrefixes.claim),
        class: 'shape',
        predicate: 'there is a function retry(options)',
        anchor: { blockId, markerId: 'c1' },
        scope: { entityId: blockId, revision: commit },
        subscriptions: [{ kind: 'signature', symbolHash: fixtureSymbolHash }],
        evidence: [{ kind: 'codemap-grounding', symbol: fixtureSymbolHash, file: 'src/retry.ts', commit }],
        disposition: {
          status: 'checked',
          evidence: { kind: 'codemap-grounding', symbol: fixtureSymbolHash, file: 'src/retry.ts', commit }
        }
      },
      {
        claimId: mintId(idPrefixes.claim),
        class: 'value',
        predicate: 'retry attempts default to 3',
        anchor: { blockId, markerId: 'c2' },
        scope: { entityId: blockId, revision: commit },
        subscriptions: [{ kind: 'value', symbolHash: fixtureSymbolHash, valueName: 'attempts', citedValue: '3' }],
        evidence: [{ kind: 'source-linked', symbol: fixtureSymbolHash, file: 'src/retry.ts', commit }],
        disposition: { status: 'unchecked', reason: 'no-checker-available' }
      }
    ],
    coverageLint: { uncovered: [] }
  };
};

export const buildFixtureKnowledgeNeed = (): KnowledgeNeed => ({
  needId: mintId(idPrefixes.knowledgeNeed),
  kind: 'intent-policy',
  subject: { entityThreadId: mintId(idPrefixes.block), symbolHash: fixtureSymbolHash },
  missingFact: { kind: 'design-rationale', field: 'why-default-3' },
  requestingPages: [mintId(idPrefixes.page)],
  question: 'Why does retry default to 3 attempts?',
  status: 'open',
  createdAt: now
});

export const buildFixtureKnowledgeFact = (): KnowledgeFact => ({
  factId: mintId(idPrefixes.knowledgeFact),
  statement: 'Retry defaults to 3 attempts to stay under the upstream 10s gateway timeout.',
  origin: 'human',
  author: 'github:someuser',
  evidence: [],
  answeredAtRevision: commit,
  scope: { kind: 'entity', entityThreadId: mintId(idPrefixes.block) },
  status: 'active'
});

export const buildFixtureStructuralFinding = (pageIds?: [string, string]): StructuralFinding => {
  const [withSection, missingSection] = pageIds ?? [mintId(idPrefixes.page), mintId(idPrefixes.page)];
  return {
    key: 'sibling-facet-asymmetry:compute-resources:pricing',
    code: 'structure.sibling-facet-asymmetry',
    scope: { kind: 'nav-group', groupId: 'compute-resources', pageIds: [withSection, missingSection] },
    detector: { kind: 'ai-assessed', id: 'sibling-facet-asymmetry', version: '1', model: 'fixture-model' },
    impact: 'medium',
    status: { state: 'open' },
    evidence: [{ pageId: missingSection, detail: 'Sibling pages have a "Pricing" section; this page does not.' }],
    repairTargets: [missingSection],
    message: '1 of 2 compute-resources pages is missing the shared "Pricing" section.',
    scopeFingerprint: '3'.repeat(64)
  };
};

export const buildFixturePublicationDecision = (): PublicationDecision => ({
  schemaVersion: 1,
  toolVersion: '0.1.0',
  baseSha: commit,
  sourceSha: commit,
  candidateArtifactHash: '4'.repeat(64),
  execution: 'completed',
  plan: { planned: 3, completed: 3, deferred: 0 },
  deterministicGate: 'clean',
  regressions: [],
  newBlockingDispositions: [],
  coverageDelta: { before: 10, after: 12 },
  publishable: true,
  autoMergeEligible: true,
  reasonCodes: []
});
