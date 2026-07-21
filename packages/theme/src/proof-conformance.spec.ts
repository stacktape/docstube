import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { emitSite } from './emit-site.ts';
import { buildFixtureInput } from './emit-site-fixture.ts';

// Proof rendering is a conformance contract, not a theme choice (knowledge/design/theming.md):
// the emitted site must carry the kernel primitives — the LITERAL claims chip ("N of M claims
// checked"), the contradiction warning banner, per-claim contradicted marks, and the stable data
// attributes review tooling keys on — regardless of the theme. The guarantee-label ladder
// ('proven'/'scored'/'verified') left the public surface (impl-07 finding 4). String-level
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
      'DocstubeClaims.astro',
      'DocstubeContradictions.astro',
      'DocstubeClaim.astro',
      'DocstubeSources.astro',
      'DocstubeEntity.astro',
      'DocstubeSectionChips.astro'
    ]) {
      expect(await readFile(join(siteRoot, 'src/docstube', file), 'utf8')).toContain('kernel-owned');
    }
  });

  it('renders literal claim counts and the honestly-earned review label — never a guarantee ladder', async () => {
    const chip = await readFile(join(siteRoot, 'src/docstube/DocstubeClaims.astro'), 'utf8');
    expect(chip).toContain('claims checked');
    // "reviewed for <persona>" renders ONLY from a genuinely completed primary review prop —
    // there is no fallback-to-reviewed branch anywhere in the primitive.
    expect(chip).toContain('reviewedFor ? (');
    expect(chip).toContain('reviewed for {reviewedFor}');
    for (const banned of ['proven', 'scored', 'out-of-domain', '"verified"', '"unverified"', 'guarantee']) {
      expect(chip).not.toContain(banned);
    }
  });

  it('renders the contradiction warning banner and per-claim contradicted marks', async () => {
    const warning = await readFile(join(siteRoot, 'src/docstube/DocstubeContradictions.astro'), 'utf8');
    expect(warning).toContain('contradicted > 0 ? (');
    expect(warning).toContain('role="alert"');
    expect(warning).toContain('contradicted by the source');
    // Per-claim marks: contradicted marker ids resolve to the rendered <Claim> spans.
    expect(warning).toContain('data-docstube-claim=');
    expect(warning).toContain("classList.add('dt-claim--contradicted')");
    expect(warning).toContain('contradicted');
  });

  it('stamps the stable data attributes on chip, warning, marks, sources, and entity wrapper', async () => {
    const chip = await readFile(join(siteRoot, 'src/docstube/DocstubeClaims.astro'), 'utf8');
    expect(chip).toContain('data-docstube-claims-checked={checked}');
    expect(chip).toContain('data-docstube-claims-total={total}');
    expect(chip).toContain('data-docstube-reviewed-for={reviewedFor}');
    const warning = await readFile(join(siteRoot, 'src/docstube/DocstubeContradictions.astro'), 'utf8');
    expect(warning).toContain('data-docstube-contradicted={contradicted}');
    const entity = await readFile(join(siteRoot, 'src/docstube/DocstubeEntity.astro'), 'utf8');
    expect(entity).toContain('data-docstube-entity-id={entityId}');
    const claim = await readFile(join(siteRoot, 'src/docstube/DocstubeClaim.astro'), 'utf8');
    expect(claim).toContain('data-docstube-claim={id}');
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
    for (const mount of [
      '<DocstubeClaims',
      '<DocstubeContradictions',
      '<DocstubeSources',
      '<DocstubeSectionChips',
      '<DocstubeEntity'
    ]) {
      expect(layout).toContain(mount);
    }
    // The entity wrapper receives the page identity injected by the kernel.
    expect(layout).toContain('entityId={frontmatter.docstubePageId}');
  });

  it('injects the page entity id, literal counts, and section counts into every generated route', async () => {
    const page = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(page).toMatch(/docstubePageId: "pg[_A-Za-z0-9-]+"/u);
    // The fixture shard has 1 checked claim of 2 — the literal counts, nothing else.
    expect(page).toContain('docstubeClaimsChecked: 1');
    expect(page).toContain('docstubeClaimsTotal: 2');
    expect(page).toContain('docstubeClaimsContradicted: 0');
    expect(page).not.toContain('docstubeGuarantee');
    // Section chips carry literal per-section counts.
    expect(page).toContain('"checked":1');
    expect(page).toContain('"total":1');
    // The kernel Claim renderer is always in scope for the inline markers.
    expect(page).toContain("import Claim from '../../docstube/DocstubeClaim.astro';");
  });

  it('renders a first-generation contradiction LOUD: warning frontmatter and per-claim marker ids', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-proof-contra-'));
    await emitSite(buildFixtureInput(repoRoot, { withContradiction: true }));
    const page = await readFile(join(repoRoot, 'docs-site', 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(page).toContain('docstubeClaimsContradicted: 1');
    expect(page).toContain('docstubeContradictedClaims: ["c3"]');
    expect(page).toContain('docstubeClaimsTotal: 3');
    // Section counts surface the contradiction where it lives.
    expect(page).toContain('"contradicted":1');
  });

  it('renders a page WITHOUT a trust spine LOUDLY unverified — never a silent 0/0 (impl-08)', async () => {
    // The setup fixture page persists with no ledger/provenance (the failed first-generation
    // anchoring shape): its route must carry the explicit unverified frontmatter, and the chip
    // primitive must render the visible warning from it.
    const bare = await readFile(join(siteRoot, 'src/pages/guides/setup.mdx'), 'utf8');
    expect(bare).toContain('docstubeUnverified: true');
    const chip = await readFile(join(siteRoot, 'src/docstube/DocstubeClaims.astro'), 'utf8');
    expect(chip).toContain('unverifiedPage ? (');
    expect(chip).toContain('This page could not be verified');
    expect(chip).toContain('data-docstube-unverified="true"');
    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    expect(layout).toContain('unverifiedPage={unverifiedPage}');
    expect(layout).toContain('frontmatter.docstubeUnverified === true');
    // The verified install page must NOT carry the unverified marker.
    const verified = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(verified).not.toContain('docstubeUnverified');
  });
});
