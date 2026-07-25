import {
  buildFixturePage,
  buildFixturePageShard,
  buildFixtureProvenanceV2,
  contentHash,
  contentHashSchema,
  docstubeConfigSchema,
  entityRevisionSchema,
  fixtureConfigInput,
  gitCommitSchema,
  idPrefixes,
  manifestIndexSchema,
  mintId
} from '@docstube/contracts';
import type { ClaimLedger, PageEntity, PageShard } from '@docstube/contracts';
import type { EmitSiteInput } from './emit-site.ts';
import { themeBundle as basicThemeBundle } from './themes/basic/bundle.generated.ts';

// Test-only fixture shared by the emit-site and docs-mcp-server specs. Not exported from
// theme.ts, so it never ships in the built package.

export type FixtureInputOptions = {
  baseUrl?: string;
  repoUrl?: string;
  frozenVersions?: string[];
  withTranslation?: boolean;
  // Adds a CONTRADICTED value claim to the install page's trust spine — the loud-rendering path
  // (impl-07 finding 4).
  withContradiction?: boolean;
  // Writes the setup page's frontmatter the tolerant way (BOM + a blank line above the delimiter),
  // which strict stripping leaks into whatever consumes the page's text.
  withUntidyFrontmatter?: boolean;
};

// A shard carrying the v2 trust spine: one CHECKED claim anchored in the "Requirements" section
// and one unchecked claim on the preamble — 1/2 claims checked, honest literal partial state.
// With `contradicted`, a third claim is a caught lie (failed value-predicate deciding evidence).
const withTrustSpine = (shard: PageShard, contradicted = false): PageShard => {
  const page = shard.page;
  const checkedBlock = page.sections[0]?.blocks[0] ?? page.preamble[0]!;
  const uncheckedBlock = page.preamble[0] ?? checkedBlock;
  const checkedBlockId = checkedBlock.id;
  const uncheckedBlockId = uncheckedBlock.id;
  // Scope revision is the scoped block's content hash — the shard schema rejects anything else.
  const checkedRevision = entityRevisionSchema.parse(checkedBlock.contentHash);
  const uncheckedRevision = entityRevisionSchema.parse(uncheckedBlock.contentHash);
  const decidingEvidenceId = mintId(idPrefixes.evidence);
  const contradictionEvidenceId = mintId(idPrefixes.evidence);
  const ledger: ClaimLedger = {
    schemaVersion: 1,
    pageId: page.id,
    sourceRevision: gitCommitSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'),
    claims: [
      {
        claimId: mintId(idPrefixes.claim),
        class: 'code-structure',
        predicate: 'docstube installs globally via npm',
        anchor: { blockId: checkedBlockId, markerId: 'c1' },
        quote: 'docstube installs globally via npm',
        scope: { entityId: checkedBlockId, revision: checkedRevision },
        subscriptions: [],
        evidence: [decidingEvidenceId],
        correctness: 'checked',
        disposition: null,
        decidingEvidenceId
      },
      {
        claimId: mintId(idPrefixes.claim),
        class: 'intent-history',
        predicate: 'the installer exists for no-Node environments',
        anchor: { blockId: uncheckedBlockId, markerId: 'c2' },
        quote: 'The installer exists for no-Node environments.',
        scope: { entityId: uncheckedBlockId, revision: uncheckedRevision },
        subscriptions: [],
        evidence: [],
        correctness: 'unchecked',
        disposition: 'maintainer-input-needed'
      },
      ...(contradicted
        ? [
            {
              claimId: mintId(idPrefixes.claim),
              class: 'value',
              predicate: 'attempts defaults to 5',
              anchor: { blockId: checkedBlockId, markerId: 'c3' },
              quote: '`attempts` defaults to 5.',
              scope: { entityId: checkedBlockId, revision: checkedRevision },
              subscriptions: [],
              evidence: [contradictionEvidenceId],
              correctness: 'contradicted' as const,
              disposition: null,
              decidingEvidenceId: contradictionEvidenceId
            }
          ]
        : [])
    ],
    coverageLint: { uncovered: [] }
  };
  return { ...shard, ledger, provenance: buildFixtureProvenanceV2(ledger) };
};

// Fixture shards bind to their fixture MDX the way real persistence does — the emission binding
// check would otherwise (correctly) force every fixture page into the unverified state.
const bindMdx = (shard: PageShard, mdx: string): PageShard => ({
  ...shard,
  mdxContentHash: contentHashSchema.parse(contentHash(mdx))
});

export const setupMdx = '---\ndescription: Fixture setup page.\n---\n\n# Setup guide\n\nSome setup prose.\n';
// The same page as a Windows editor writes it: a UTF-8 BOM and a blank line above the delimiter.
// "zzyzx" appears ONLY in the frontmatter, so a search hit on it is proof that frontmatter leaked
// into indexed text.
export const untidySetupMdx =
  '\uFEFF\n---\ndescription: Zzyzx fixture setup page.\n---\n\n# Setup guide\n\nSome setup prose.\n';
export const installMdx = '# Installation\n\n<Callout tone="info">Install with npm.</Callout>\n';
export const installDeMdx = '# Installation (DE)\n\n<Callout tone="info">Installiere mit npm.</Callout>\n';

export const buildFixtureInput = (repoRoot: string, options?: FixtureInputOptions): EmitSiteInput => {
  const installPage = buildFixturePage();
  const setupPage: PageEntity = { ...buildFixturePage(), slug: 'guides/setup', title: 'Setup guide' };
  const setupPageMdx = options?.withUntidyFrontmatter === true ? untidySetupMdx : setupMdx;
  const config = docstubeConfigSchema.parse({
    ...fixtureConfigInput,
    site: {
      title: 'Fixture Docs',
      description: 'Verified fixture documentation.',
      footerCredit: true,
      ...(options?.baseUrl === undefined ? {} : { baseUrl: options.baseUrl })
    },
    ...(options?.withTranslation === true ? { locales: { source: 'en', targets: ['de'] } } : {}),
    theme: { tokens: { accent: '#123456' } }
  });
  const index = manifestIndexSchema.parse({
    schemaVersion: 1,
    docstubeVersion: '0.0.2',
    sourceLocale: 'en',
    locales: options?.withTranslation === true ? ['en', 'de'] : ['en'],
    versions: [
      { label: 'latest', status: 'current' },
      ...(options?.frozenVersions ?? []).map((label) => ({ label, status: 'frozen' as const }))
    ],
    pages: [
      { id: installPage.id, slug: installPage.slug, title: installPage.title, path: `docs/${installPage.slug}.mdx` },
      { id: setupPage.id, slug: setupPage.slug, title: setupPage.title, path: `docs/${setupPage.slug}.mdx` }
    ],
    configHash: 'a'.repeat(64),
    iaHash: 'b'.repeat(64)
  });
  // The de rendition the alignment step produces: SAME entity ids and blocks, localized section
  // titles — and therefore localized anchors, derived from the translated headings by the same
  // extraction slugger that derives source anchors.
  const installPageDe: PageEntity = {
    ...installPage,
    title: 'Installation (DE)',
    sections: installPage.sections.map((section) => ({ ...section, title: 'Anforderungen', anchor: 'anforderungen' }))
  };
  return {
    repoRoot,
    outDir: 'docs-site',
    config,
    index,
    theme: basicThemeBundle,
    pages: [
      {
        shard: bindMdx(
          withTrustSpine(buildFixturePageShard(installPage), options?.withContradiction === true),
          installMdx
        ),
        mdx: installMdx
      },
      { shard: bindMdx(buildFixturePageShard(setupPage), setupPageMdx), mdx: setupPageMdx }
    ],
    ...(options?.withTranslation === true
      ? {
          translations: [
            {
              shard: bindMdx({ ...buildFixturePageShard(installPageDe), locale: 'de' }, installDeMdx),
              mdx: installDeMdx
            }
          ]
        }
      : {}),
    ...(options?.frozenVersions === undefined ? {} : { frozenVersions: options.frozenVersions }),
    ...(options?.repoUrl === undefined ? {} : { repoUrl: options.repoUrl })
  };
};
