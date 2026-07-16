import {
  buildFixturePage,
  buildFixturePageShard,
  docstubeConfigSchema,
  fixtureConfigInput,
  manifestIndexSchema
} from '@docstube/contracts';
import type { PageEntity } from '@docstube/contracts';
import type { EmitSiteInput } from './emit-site.ts';

// Test-only fixture shared by the emit-site and docs-mcp-server specs. Not exported from
// theme.ts, so it never ships in the built package.

export type FixtureInputOptions = {
  baseUrl?: string;
  repoUrl?: string;
  frozenVersions?: string[];
  withTranslation?: boolean;
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
    pages: [
      { shard: buildFixturePageShard(installPage), mdx: installMdx },
      { shard: buildFixturePageShard(setupPage), mdx: setupMdx }
    ],
    ...(options?.withTranslation === true
      ? { translations: [{ shard: { ...buildFixturePageShard(installPageDe), locale: 'de' }, mdx: installDeMdx }] }
      : {}),
    ...(options?.frozenVersions === undefined ? {} : { frozenVersions: options.frozenVersions }),
    ...(options?.repoUrl === undefined ? {} : { repoUrl: options.repoUrl })
  };
};
