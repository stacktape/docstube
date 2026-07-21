import type { z } from 'zod';
import { contentHash } from './hashing.ts';
import {
  contentHashSchema,
  entityRevisionSchema,
  gitCommitSchema,
  idPrefixes,
  mintId,
  symbolSourceKeySchema
} from './primitives.ts';
import type { ClaimLedger, WriterClaimLedger } from './claim-ledger-schema.ts';
import type { docstubeConfigSchema } from './config-schema.ts';
import type { PageEntity } from './entity-schema.ts';
import type { KnowledgeFact, KnowledgeNeed } from './knowledge-schema.ts';
import type { PageShard } from './manifest-schema.ts';
import type { ProvenanceV2 } from './provenance-v2-schema.ts';
import type { PublicationDecision } from './publication-schema.ts';
import type { StructuralFinding } from './structural-finding-schema.ts';

// Shared test fixtures. Deterministic where determinism matters (hashes), minted where it does
// not (ids). Used by contracts tests and by downstream packages' tests.

const commit = gitCommitSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678');
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
  schemaVersion: 2,
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

const fixtureSymbolHash = symbolSourceKeySchema.parse(`ts:${'2'.repeat(64)}`);
const fixtureEntityRevision = entityRevisionSchema.parse('5'.repeat(64));
const fixtureContentHash = contentHashSchema.parse('3'.repeat(64));

// The writer-side artifact: proposed claims keyed by marker id only — nothing kernel-minted.
export const buildFixtureWriterClaimLedger = (): WriterClaimLedger => ({
  schemaVersion: 1,
  claims: [
    {
      markerId: 'c1',
      class: 'code-structure',
      predicate: 'there is a function retry(options)',
      proposedEvidence: [{ kind: 'symbol', symbol: fixtureSymbolHash, file: 'src/retry.ts' }],
      proposedSubscriptions: [{ kind: 'signature', symbolHash: fixtureSymbolHash }]
    },
    {
      markerId: 'c2',
      class: 'value',
      predicate: 'retry attempts default to 3',
      proposedEvidence: [{ kind: 'symbol', symbol: fixtureSymbolHash, file: 'src/retry.ts' }],
      proposedSubscriptions: [
        { kind: 'cited-value', symbolHash: fixtureSymbolHash, valueName: 'attempts', citedValue: '3' }
      ]
    }
  ]
});

// The kernel-side committed ledger: minted ids, anchors, computed correctness×disposition, and
// evidence handles referencing the canonical evidence records in provenance. Pass the page so
// claim anchors land on one of its REAL blocks (the shard enforces anchor existence).
export const buildFixtureClaimLedger = (page?: Pick<PageEntity, 'id' | 'preamble' | 'sections'>): ClaimLedger => {
  const pageId = page?.id ?? mintId(idPrefixes.page);
  const blockId = page?.preamble[0]?.id ?? page?.sections[0]?.blocks[0]?.id ?? mintId(idPrefixes.block);
  const groundingEvidenceId = mintId(idPrefixes.evidence);
  const sourceLinkEvidenceId = mintId(idPrefixes.evidence);
  return {
    schemaVersion: 1,
    pageId,
    sourceRevision: commit,
    claims: [
      {
        claimId: mintId(idPrefixes.claim),
        class: 'code-structure',
        predicate: 'there is a function retry(options)',
        anchor: { blockId, markerId: 'c1' },
        quote: 'The library exposes a `retry(options)` function.',
        scope: { entityId: blockId, revision: fixtureEntityRevision },
        subscriptions: [{ kind: 'signature', symbolHash: fixtureSymbolHash }],
        evidence: [groundingEvidenceId],
        correctness: 'checked',
        disposition: null,
        decidingEvidenceId: groundingEvidenceId
      },
      {
        claimId: mintId(idPrefixes.claim),
        class: 'value',
        predicate: 'retry attempts default to 3',
        anchor: { blockId, markerId: 'c2' },
        quote: 'Retry attempts default to 3.',
        scope: { entityId: blockId, revision: fixtureEntityRevision },
        subscriptions: [{ kind: 'cited-value', symbolHash: fixtureSymbolHash, valueName: 'attempts', citedValue: '3' }],
        evidence: [sourceLinkEvidenceId],
        correctness: 'unchecked',
        disposition: 'no-checker-available'
      }
    ],
    coverageLint: { uncovered: [] }
  };
};

// A ProvenanceV2 record in exact bijection with the given kernel ledger (the shard commit
// invariant): one ClaimEvidence per ledger claim, agreeing on class/correctness/disposition/
// deciding id, with every ledger evidence handle resolving to a canonical record.
export const buildFixtureProvenanceV2 = (ledger: ClaimLedger): ProvenanceV2 => ({
  schemaVersion: 1,
  lineage: { models: [], prompts: [], transcripts: [], seedContext: [], observedReads: [] },
  dependencies: { subscriptions: [], consumed: [] },
  claimEvidence: ledger.claims.map((claim) => ({
    schemaVersion: 1,
    claimId: claim.claimId,
    class: claim.class,
    correctness: claim.correctness,
    disposition: claim.disposition,
    evidence: claim.evidence.map((evidenceId) => ({
      evidenceId,
      ref:
        claim.correctness === 'checked' && claim.decidingEvidenceId === evidenceId
          ? { kind: 'codemap-grounding' as const, symbol: fixtureSymbolHash }
          : { kind: 'source-linked' as const, symbol: fixtureSymbolHash },
      checkedAt: now,
      sourceRevision: commit,
      outcome: 'pass' as const
    })),
    ...(claim.decidingEvidenceId === undefined ? {} : { decidingEvidenceId: claim.decidingEvidenceId })
  })),
  assessments: { reviews: [], translationFidelity: [], structural: [] }
});

export const buildFixtureKnowledgeNeed = (): KnowledgeNeed => ({
  schemaVersion: 1,
  needId: mintId(idPrefixes.knowledgeNeed),
  kind: 'intent-policy',
  subject: {
    kind: 'entity-thread',
    entityThreadId: mintId(idPrefixes.entityThread),
    symbolHash: fixtureSymbolHash
  },
  missingFact: { kind: 'design-rationale', field: 'why-default-3' },
  requestingPages: [mintId(idPrefixes.page)],
  question: 'Why does retry default to 3 attempts?',
  status: 'open',
  researchTrail: [],
  createdAt: now
});

export const buildFixtureKnowledgeFact = (): KnowledgeFact => ({
  schemaVersion: 1,
  factId: mintId(idPrefixes.knowledgeFact),
  needId: mintId(idPrefixes.knowledgeNeed),
  statement: 'Retry defaults to 3 attempts to stay under the upstream 10s gateway timeout.',
  origin: 'user',
  author: 'github:someuser',
  evidence: [],
  answeredAt: now,
  subjectFingerprint: fixtureContentHash,
  scope: { kind: 'entity', entityThreadId: mintId(idPrefixes.entityThread) },
  status: 'active',
  propagation: 'answered'
});

export const buildFixtureStructuralFinding = (pageIds?: [string, string]): StructuralFinding => {
  const [withSection, missingSection] = pageIds ?? [mintId(idPrefixes.page), mintId(idPrefixes.page)];
  return {
    schemaVersion: 1,
    key: 'sibling-facet-asymmetry:compute-resources:pricing',
    code: 'structure.sibling-facet-asymmetry',
    scope: { kind: 'nav-group', groupId: 'compute-resources', pageIds: [withSection, missingSection] },
    detector: { kind: 'ai-assessed', id: 'sibling-facet-asymmetry', version: '1', model: 'fixture-model' },
    authority: { kind: 'inferred-convention', cohortSize: 4, prevalence: 0.75 },
    impact: 'medium',
    status: { state: 'open' },
    evidence: [{ pageId: missingSection, detail: 'Sibling pages have a "Pricing" section; this page does not.' }],
    repairTargets: [missingSection],
    message: '1 of 4 compute-resources pages is missing the shared "Pricing" section.',
    scopeFingerprint: fixtureContentHash
  };
};

export const buildFixturePublicationDecision = (): PublicationDecision => ({
  schemaVersion: 1,
  toolVersion: '0.1.0',
  baseSha: commit,
  sourceSha: commit,
  candidateArtifactHash: contentHashSchema.parse('4'.repeat(64)),
  execution: 'completed',
  plan: { planned: 3, completed: 3, deferred: 0 },
  deterministicGate: 'clean',
  regressions: [],
  newBlockingDispositions: [],
  coverageDelta: [
    {
      obligationId: 'ob-retry',
      scope: 'src/retry.ts',
      beforeStatus: 'unassigned',
      afterStatus: 'documented'
    }
  ],
  publishable: true,
  autoMergeEligible: true,
  reasonCodes: []
});
