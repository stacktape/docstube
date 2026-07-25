import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { emitSite } from './emit-site.ts';
import { buildFixtureInput } from './emit-site-fixture.ts';
import { builtinThemes } from './theme-manifest.ts';

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

  it('renders translation assurance as its OWN dimension, never folded into the checked counts', async () => {
    // i18n-lifecycle-v2 decision 3: source correctness and translation assurance are separate and
    // never collapsed. A rendition inherits the canonical checked counts, so without this line an
    // unreviewed translation reads as fully checked. The bilingual fidelity review (decision 2) is
    // implemented in the i18n wave; "not yet reviewed" is the honest interim surface.
    const chip = await readFile(join(siteRoot, 'src/docstube/DocstubeClaims.astro'), 'utf8');
    expect(chip).toContain('Translation: not yet reviewed');
    expect(chip).toContain('data-docstube-translation-assurance={translationAssurance}');
    // Its own element, separate from the counts chip and from the fallback notice.
    expect(chip).toContain('class="dt-translation-assurance"');
    expect(chip.indexOf('dt-translation-assurance')).toBeGreaterThan(chip.indexOf('claims checked'));
    // Every built-in theme threads the dimension into the primitive — a conformance contract, not
    // a theme choice.
    for (const bundle of Object.values(builtinThemes)) {
      const layout = (await bundle()).files.find((file) => file.path === 'src/layouts/DocLayout.astro');
      expect(layout && 'content' in layout ? layout.content : '').toContain(
        'translationAssurance={translationAssurance}'
      );
    }
    const css = await readFile(join(siteRoot, 'src/styles/global.css'), 'utf8');
    expect(css).toContain('.dt-translation-assurance');
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

  it('renders quiet-but-visible per-claim UNCHECKED marks — an exception indicator, not an alarm (impl-09)', async () => {
    const warning = await readFile(join(siteRoot, 'src/docstube/DocstubeContradictions.astro'), 'utf8');
    // A distinct marker-id list from the contradicted one, applied as a dotted-underline class
    // plus an explanatory title — never the contradiction alarm treatment.
    expect(warning).toContain('dt-unchecked-claims');
    expect(warning).toContain("classList.add('dt-claim--unchecked')");
    expect(warning).toContain("dataset.docstubeUnchecked = 'true'");
    expect(warning).toContain('not been mechanically checked');
    // A contradicted claim never also gets the quiet mark.
    expect(warning).toContain("claim.dataset.docstubeContradicted === 'true'");
    const css = await readFile(join(siteRoot, 'src/styles/global.css'), 'utf8');
    expect(css).toContain('.dt-claim--unchecked');
    expect(css).toMatch(/\.dt-claim--unchecked \{[^}]*dotted/u);
  });

  it('applies the inline claim marks PARSE-SAFELY: the primitive mounts before the content slot (impl-10)', async () => {
    // All themes mount DocstubeContradictions ABOVE the <Claim>-bearing slot, so an immediate
    // query would find none of its targets. The emitted script must use a parse-safe mechanism:
    // defer to DOMContentLoaded while the document is still parsing.
    const warning = await readFile(join(siteRoot, 'src/docstube/DocstubeContradictions.astro'), 'utf8');
    expect(warning).toContain("document.readyState === 'loading'");
    expect(warning).toContain("document.addEventListener('DOMContentLoaded', applyClaimMarks, { once: true })");
    // The layout really does order the primitive before the slot — the guard is what makes that
    // ordering safe, so both facts are asserted together.
    const layout = await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8');
    expect(layout.indexOf('<DocstubeContradictions')).toBeGreaterThan(-1);
    expect(layout.indexOf('<DocstubeContradictions')).toBeLessThan(layout.indexOf('<slot'));
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

  it('the inline Claim primitive consumes ONLY the id prop — no prop spreading (wave 2b close final)', async () => {
    // Defense in depth behind submit_page's attribute whitelist: even if a marker attribute ever
    // reached the emitted site, the kernel Claim renderer must not forward it to the DOM. It
    // destructures id and nothing else — a props spread would let unknown attributes through.
    const claim = await readFile(join(siteRoot, 'src/docstube/DocstubeClaim.astro'), 'utf8');
    expect(claim).toContain('const { id } = Astro.props;');
    expect(claim).not.toContain('...Astro.props');
    expect(claim).not.toContain('{...');
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
    // The unchecked marker list reaches the primitive alongside the contradicted one.
    expect(layout).toContain('uncheckedMarkers={uncheckedClaims}');
  });

  it('injects the page entity id, literal counts, and section counts into every generated route', async () => {
    const page = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(page).toMatch(/docstubePageId: "pg[_A-Za-z0-9-]+"/u);
    // The fixture shard has 1 checked claim of 2 — the literal counts, nothing else.
    expect(page).toContain('docstubeClaimsChecked: 1');
    expect(page).toContain('docstubeClaimsTotal: 2');
    expect(page).toContain('docstubeClaimsContradicted: 0');
    // The unchecked claim's marker id ships too — the inline quiet mark targets it (impl-09).
    expect(page).toContain('docstubeUncheckedClaims: ["c2"]');
    expect(page).not.toContain('docstubeGuarantee');
    // Section chips carry literal per-section counts.
    expect(page).toContain('checked: 1');
    expect(page).toContain('total: 1');
    // The kernel Claim renderer is always in scope for the inline markers.
    expect(page).toContain("import Claim from '../../docstube/DocstubeClaim.astro';");
  });

  // NO HIDDEN DENOMINATOR (harness-state-v2 decision 5, PRODUCT §1.2): the coverage linter's count
  // reaches the reader, and the complete/green state is gated on it — a page that simply left its
  // facts unmarked can never present as done.
  it('threads the unmarked-assertion count into the chip and gates the complete state on it', async () => {
    const chip = await readFile(join(siteRoot, 'src/docstube/DocstubeClaims.astro'), 'utf8');
    expect(chip).toContain('unmarked assertion');
    expect(chip).toContain('data-docstube-uncovered-assertions={uncovered}');
    // The complete class can only appear when the linter found nothing — and the chip re-derives
    // it from the numbers it renders rather than trusting the flag (impl-24 defensive recompute).
    expect(chip).toContain(
      'const isComplete = complete === true && total > 0 && checked === total && uncovered === 0 && contradicted === 0;'
    );
    expect(chip).toContain('dt-claims--complete');
    // HONEST BADGE SEMANTICS (impl-24, PRODUCT §1.2 / harness-state-v2 decisions 4-5): wherever the
    // complete state is explained it says what it means AND what it does not — the deterministic
    // linter is a floor, and semantic assertion-coverage is the risk critic's job.
    expect(chip).toContain("every claim in this page's ledger is checked");
    expect(chip).toContain('does not mean the page contains no unverified statement');
    // Every built-in theme threads the props and styles the complete state — a conformance
    // contract, not a theme choice.
    for (const bundle of Object.values(builtinThemes)) {
      const files = (await bundle()).files;
      const layout = files.find((file) => file.path === 'src/layouts/DocLayout.astro');
      const content = layout && 'content' in layout ? layout.content : '';
      expect(content).toContain('uncovered={uncoveredAssertions}');
      expect(content).toContain('complete={claimsComplete}');
      // The contradiction count reaches the chip too, so the recompute can refuse the green state.
      expect(content).toContain('contradicted={claimsContradicted}');
      expect(content).toContain('does not mean the page contains no unverified statement');
      const css = files.find((file) => file.path === 'src/styles/global.css');
      expect(css && 'content' in css ? css.content : '').toContain('.dt-claims--complete');
    }
  });

  it('emits the unmarked-assertion count on every route and withholds complete when any exist', async () => {
    // The fixture install page is 1-of-2 checked with no uncovered spans: honest, not complete.
    const page = await readFile(join(siteRoot, 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(page).toContain('docstubeUncoveredAssertions: 0');
    expect(page).not.toContain('docstubeClaimsComplete');

    // Same ledger, one uncovered span recorded: the count ships and complete stays withheld.
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-proof-uncovered-'));
    const input = buildFixtureInput(repoRoot);
    const install = input.pages[0]!;
    const ledger = install.shard.ledger;
    if (ledger === undefined) {
      throw new Error('fixture shard is missing its ledger');
    }
    input.pages[0] = {
      ...install,
      shard: {
        ...install.shard,
        ledger: {
          ...ledger,
          coverageLint: {
            uncovered: [
              {
                blockId: ledger.claims[0]!.anchor.blockId,
                excerpt: 'The `retryLimit` defaults to 5.',
                detector: 'identifier-with-numeric-literal'
              }
            ]
          }
        }
      }
    };
    await emitSite(input);
    const route = await readFile(join(repoRoot, 'docs-site/src/pages/getting-started/installation.mdx'), 'utf8');
    expect(route).toContain('docstubeUncoveredAssertions: 1');
    expect(route).not.toContain('docstubeClaimsComplete');
  });

  it('renders a first-generation contradiction LOUD: warning frontmatter and per-claim marker ids', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-proof-contra-'));
    await emitSite(buildFixtureInput(repoRoot, { withContradiction: true }));
    const page = await readFile(join(repoRoot, 'docs-site', 'src/pages/getting-started/installation.mdx'), 'utf8');
    expect(page).toContain('docstubeClaimsContradicted: 1');
    expect(page).toContain('docstubeContradictedClaims: ["c3"]');
    expect(page).toContain('docstubeClaimsTotal: 3');
    // Section counts surface the contradiction where it lives.
    expect(page).toContain('contradicted: 1');
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
