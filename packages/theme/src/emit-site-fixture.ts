import {
  buildFixturePage,
  buildFixturePageShard,
  buildFixtureProvenanceV2,
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
};

// A shard carrying the v2 trust spine: one CHECKED claim anchored in the "Requirements" section
// (its chip projects 'proven') and one unchecked claim on the preamble (so the page-level
// projection stays 'scored' — 1/2 claims checked, honest partial state).
const withTrustSpine = (shard: PageShard): PageShard => {
  const page = shard.page;
  const revision = entityRevisionSchema.parse('5'.repeat(64));
  const checkedBlockId = page.sections[0]?.blocks[0]?.id ?? page.preamble[0]!.id;
  const uncheckedBlockId = page.preamble[0]?.id ?? checkedBlockId;
  const decidingEvidenceId = mintId(idPrefixes.evidence);
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
        scope: { entityId: checkedBlockId, revision },
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
        scope: { entityId: uncheckedBlockId, revision },
        subscriptions: [],
        evidence: [],
        correctness: 'unchecked',
        disposition: 'maintainer-input-needed'
      }
    ],
    coverageLint: { uncovered: [] }
  };
  return { ...shard, ledger, provenance: buildFixtureProvenanceV2(ledger) };
};

export const setupMdx = '---\ndescription: Fixture setup page.\n---\n\n# Setup guide\n\nSome setup prose.\n';
export const installMdx = '# Installation\n\n<Callout tone="info">Install with npm.</Callout>\n';
export const installDeMdx = '# Installation (DE)\n\n<Callout tone="info">Installiere mit npm.</Callout>\n';

export const buildFixtureInput = (repoRoot: string, options?: FixtureInputOptions): EmitSiteInput => {
  const installPage = buildFixturePage();
  const setupPage: PageEntity = { ...buildFixturePage(), slug: 'guides/setup', title: 'Setup guide' };
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
  const installPageDe: PageEntity = { ...installPage, title: 'Installation (DE)' };
  return {
    repoRoot,
    outDir: 'docs-site',
    config,
    index,
    theme: basicThemeBundle,
    pages: [
      { shard: withTrustSpine(buildFixturePageShard(installPage)), mdx: installMdx },
      { shard: buildFixturePageShard(setupPage), mdx: setupMdx }
    ],
    ...(options?.withTranslation === true
      ? { translations: [{ shard: { ...buildFixturePageShard(installPageDe), locale: 'de' }, mdx: installDeMdx }] }
      : {}),
    ...(options?.frozenVersions === undefined ? {} : { frozenVersions: options.frozenVersions }),
    ...(options?.repoUrl === undefined ? {} : { repoUrl: options.repoUrl })
  };
};
