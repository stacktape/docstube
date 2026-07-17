import {
  codemapSchema,
  contentHash,
  docstubeConfigSchema,
  glossarySchema,
  idPrefixes,
  mintId
} from '@docstube/contracts';
import type { BlockEntity, ClaimEntity, PageEntity, Provenance, SectionEntity } from '@docstube/contracts';
import type { BlockTypeRegistry, PageArtifact, VerifierContext } from '@docstube/plugin-sdk';

// Test-only builders: small, hand-rolled pages whose entity tree stays consistent with the MDX
// the specs pair them with. Not exported from the package entry.

const emptyProvenance = (): Provenance => ({
  sources: [],
  seedContext: [],
  observedReads: [],
  verifications: [],
  reviews: []
});

export const makeClaim = (text: string): ClaimEntity => ({
  id: mintId(idPrefixes.claim),
  kind: 'claim',
  text,
  anchor: { quote: text, prefix: '', suffix: '' },
  claimClass: 'code-sample',
  guarantee: 'scored'
});

export const makeBlock = (input: {
  content: string;
  blockType?: string;
  language?: string;
  metadata?: unknown;
  claims?: ClaimEntity[];
  id?: string;
}): BlockEntity => ({
  id: input.id ?? mintId(idPrefixes.block),
  kind: 'block',
  blockType: input.blockType ?? 'paragraph',
  metadata: input.metadata,
  contentHash: contentHash(input.content),
  language: input.language,
  variants: [],
  claims: input.claims ?? [],
  guarantee: 'scored',
  provenance: emptyProvenance()
});

export const makeSection = (input: {
  anchor: string;
  title?: string;
  blocks?: BlockEntity[];
  id?: string;
}): SectionEntity => ({
  id: input.id ?? mintId(idPrefixes.section),
  kind: 'section',
  title: input.title ?? input.anchor,
  level: 2,
  anchor: input.anchor,
  blocks: input.blocks ?? [],
  guarantee: 'scored'
});

export const makePage = (input: {
  slug: string;
  title?: string;
  preamble?: BlockEntity[];
  sections?: SectionEntity[];
  id?: string;
}): PageEntity => ({
  id: input.id ?? mintId(idPrefixes.page),
  kind: 'page',
  slug: input.slug,
  title: input.title ?? input.slug,
  preamble: input.preamble ?? [],
  sections: input.sections ?? [],
  guarantee: 'scored',
  provenance: emptyProvenance()
});

export const makeArtifact = (page: PageEntity, mdx: string): PageArtifact => ({
  page,
  mdx,
  mdxPath: `docs/${page.slug}.mdx`,
  locale: 'en',
  version: 'latest'
});

const emptyRegistry: BlockTypeRegistry = { get: () => undefined, list: () => [] };

export const makeContext = (registry: BlockTypeRegistry = emptyRegistry): VerifierContext => ({
  repoRoot: '/repo',
  config: docstubeConfigSchema.parse({
    schemaVersion: 1,
    docType: 'external-library',
    personas: [{ id: 'app-developer', description: 'Builds apps on top of the library' }],
    site: { title: 'Test Docs' }
  }),
  codemap: codemapSchema.parse({ schemaVersion: 1, commit: 'a'.repeat(40), symbols: [] }),
  glossary: glossarySchema.parse({ schemaVersion: 1, terms: [] }),
  registry,
  fs: {
    readFile: async () => '',
    exists: async () => false,
    writeFile: async () => {}
  },
  exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  logger: { info: () => {}, warn: () => {} }
});
