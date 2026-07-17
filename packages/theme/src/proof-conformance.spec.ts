import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { emitSite } from './emit-site.ts';
import { buildFixtureInput } from './emit-site-fixture.ts';
import { guaranteeLabels } from './proof-source.ts';

// Proof rendering is a conformance contract, not a theme choice (knowledge/design/theming.md):
// the emitted site must carry the kernel primitives, all three guarantee levels' visible labels,
// and the stable data attributes review tooling keys on — regardless of the theme. String-level
// assertions over the emitted files; building the Astro site is CI's job.

describe('proof conformance (basic theme)', () => {
  let siteRoot: string;

  beforeAll(async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-proof-'));
    await emitSite(buildFixtureInput(repoRoot, { repoUrl: 'https://github.com/acme/fixture' }));
    siteRoot = join(repoRoot, 'docs-site');
  });

  it('emits the kernel proof primitives under src/docstube/', async () => {
    for (const file of [
      'DocstubeGuarantee.astro',
      'DocstubeSources.astro',
      'DocstubeEntity.astro',
      'DocstubeSectionChips.astro'
    ]) {
      expect(await readFile(join(siteRoot, 'src/docstube', file), 'utf8')).toContain('kernel-owned');
    }
  });

  it('renders all three guarantee levels with visible accessible labels', async () => {
    const badge = await readFile(join(siteRoot, 'src/docstube/DocstubeGuarantee.astro'), 'utf8');
    const chips = await readFile(join(siteRoot, 'src/docstube/DocstubeSectionChips.astro'), 'utf8');
    expect(Object.keys(guaranteeLabels).toSorted()).toEqual(['out-of-domain', 'proven', 'scored']);
    for (const label of Object.values(guaranteeLabels)) {
      expect(badge).toContain(`"${label}"`);
      expect(chips).toContain(`"${label}"`);
    }
  });

  it('stamps the stable data attributes on badge, chips, sources, and entity wrapper', async () => {
    const badge = await readFile(join(siteRoot, 'src/docstube/DocstubeGuarantee.astro'), 'utf8');
    expect(badge).toContain('data-docstube-guarantee={guarantee}');
    const entity = await readFile(join(siteRoot, 'src/docstube/DocstubeEntity.astro'), 'utf8');
    expect(entity).toContain('data-docstube-entity-id={entityId}');
    expect(entity).toContain('data-docstube-guarantee={guarantee}');
    const chips = await readFile(join(siteRoot, 'src/docstube/DocstubeSectionChips.astro'), 'utf8');
    expect(chips).toContain('chip.dataset.docstubeGuarantee = section.guarantee;');
    const sources = await readFile(join(siteRoot, 'src/docstube/DocstubeSources.astro'), 'utf8');
    expect(sources).toContain('data-docstube-sources');
  });

  it('links source citations in the sources primitive', async () => {
    const sources = await readFile(join(siteRoot, 'src/docstube/DocstubeSources.astro'), 'utf8');
    expect(sources).toContain('<h2>Sources</h2>');
    expect(sources).toContain('/blob/${source.commit}/${source.file}');
  });

  it('mounts every mandatory primitive in the theme layout', async () => {
    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    for (const mount of ['<DocstubeGuarantee', '<DocstubeSources', '<DocstubeSectionChips', '<DocstubeEntity']) {
      expect(layout).toContain(mount);
    }
    // The entity wrapper receives the page identity injected by the kernel.
    expect(layout).toContain('entityId={frontmatter.docstubePageId}');
  });

  it('injects the page entity id and guarantee data into every generated route', async () => {
    const page = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(page).toMatch(/docstubePageId: "pg[_A-Za-z0-9-]+"/u);
    expect(page).toContain('docstubeGuarantee: "scored"');
    // Section chips cover the remaining level so all three appear in the emitted site data.
    expect(page).toContain('"guarantee":"proven"');
  });
});
