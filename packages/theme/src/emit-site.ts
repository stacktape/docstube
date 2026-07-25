import { mkdir, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';
import { Document, isAlias, isCollection, isMap, isScalar, isSeq, parseDocument, visit } from 'yaml';
import type { Pair, ToStringOptions } from 'yaml';
// ONE SHARED FRONTMATTER SPLITTER (wave 2b close): emission and the kernel must read the same
// bytes as frontmatter, so the tolerant rules live in contracts and both sides import them. See
// contracts/src/frontmatter.ts for why a second local definition is a cross-boundary bug.
import { localeRoutePrefixConflict, splitFrontmatter } from '@docstube/contracts';
import type { DocstubeConfig, ManifestIndex, PageEntity, PageShard, SourceRef } from '@docstube/contracts';
import { applyThemeBundle } from './apply-theme-bundle.ts';
import {
  checkShardMdxBinding,
  projectShardProof,
  projectTranslationAssurance,
  projectUnboundShardProof
} from './proof-projection.ts';
import type { ThemeConflict } from './apply-theme-bundle.ts';
import { docsMcpReadmeMd, docsMcpServerMjs } from './mcp-server-source.ts';
import {
  docstubeClaimAstro,
  docstubeClaimsAstro,
  docstubeContradictionsAstro,
  docstubeEntityAstro,
  docstubeSearchAstro,
  docstubeSectionChipsAstro,
  docstubeSourcesAstro
} from './proof-source.ts';
import { ThemeError } from './theme-manifest.ts';
import type { ThemeBuild, ThemeBundle } from './theme-manifest.ts';

// Emits a fully self-contained Astro site: generated sites vendor everything they need and never
// depend on a @docstube/* package at runtime (ARCHITECTURE.md §2). The site builds with plain
// `npm install && npm run build`.
//
// Ownership (knowledge/design/theming.md): content MDX, public/*.md mirrors, llms.txt,
// site-data.mjs, the MCP server, Pagefind wiring, and src/docstube/** proof primitives are
// kernel/content-owned. src/layouts/**, src/components/**, src/styles/** come from the resolved
// theme bundle. astro.config.mjs and package.json are kernel-generated from invariants plus the
// theme's typed build hooks.

export type EmitSitePage = {
  shard: PageShard;
  mdx: string;
  // SOURCE FALLBACK route (i18n-lifecycle-v2 decision 1): a locale entry whose translation failed
  // (hashless shard) serves the SOURCE MDX bytes under the locale route with a visible
  // not-yet-translated notice — `mdx` holds the source bytes, never a stale locale file.
  sourceFallback?: boolean;
};

export type EmitSiteInput = {
  repoRoot: string;
  // Repo-relative output directory for the generated site, e.g. 'docs-site'.
  outDir: string;
  config: DocstubeConfig;
  index: ManifestIndex;
  // The resolved theme bundle. The CLI resolves it (builtinThemes[config.theme.name]) — emitSite
  // never performs a hidden registry lookup.
  theme: ThemeBundle;
  // Source-locale pages, routed at /<slug>.
  pages: EmitSitePage[];
  // Target-locale shards (same page ids/slugs, different locale), routed at /<locale>/<slug>.
  translations?: EmitSitePage[];
  // Labels of frozen versions (ManifestIndex.versions with status 'frozen'). Renders the version
  // switcher only; emitting the frozen snapshots' content under /versions/<label>/ is a later
  // wave — the manifest shards exist but their MDX may not have been generated yet.
  frozenVersions?: string[];
  // Public URL of the source repository (e.g. https://github.com/acme/widget). When set, source
  // citations link to <repoUrl>/blob/<commit>/<file>#L<line>; plain text otherwise.
  repoUrl?: string;
  // Overwrite user-modified theme-owned files instead of reporting conflicts.
  forceTheme?: boolean;
};

export type EmitSiteResult = {
  // Theme-owned files that were NOT touched because the user modified them (reported, never
  // silently destroyed). The CLI prints these.
  themeConflicts: ThemeConflict[];
  // MDX↔shard binding failures (tampered MDX or a pre-hash shard): each named page rendered in
  // the loud UNVERIFIED state instead of its recorded trust state. The CLI prints/journals these.
  warnings: string[];
  // Site-relative paths of obsolete routes and .md twins deleted this emit (a removed page or a
  // changed slug). Reported, never silent — a deletion the user did not ask for must be visible.
  pruned: string[];
};

// Kernel invariants pinned exactly (no ranges): a generated site must build identically whenever
// it is rebuilt, and a docstube release is only ever validated against these versions.
// `docstube generate` updates them. Theme dependencies merge on top; a conflicting pin is an error.
const kernelBaseDependencies: Record<string, string> = {
  '@astrojs/mdx': '6.0.3',
  astro: '6.4.6',
  // Baseline static search (PRODUCT §4.1); indexes dist/ in the postbuild step.
  pagefind: '1.4.0'
};

const mergeDependencies = (theme: ThemeBundle): Record<string, string> => {
  const merged: Record<string, string> = { ...kernelBaseDependencies };
  for (const [name, version] of Object.entries(theme.manifest.dependencies)) {
    const existing = merged[name];
    if (existing !== undefined && existing !== version) {
      throw new ThemeError(
        'theme-dependency-conflict',
        `theme "${theme.manifest.name}" pins ${name}@${version} but the kernel requires ${name}@${existing}`,
        { package: name, themeVersion: version, kernelVersion: existing }
      );
    }
    merged[name] = version;
  }
  return Object.fromEntries(Object.entries(merged).toSorted(([left], [right]) => left.localeCompare(right)));
};

type NavEntry = { label: string; href: string };
type NavGroup = { label: string | null; entries: NavEntry[] };
type LocaleAlternate = { locale: string; href: string };

const slugToHref = (slug: string): string => (slug === 'index' ? '/' : `/${slug}/`);

const localeHref = (slug: string, locale: string, sourceLocale: string): string =>
  locale === sourceLocale ? slugToHref(slug) : `/${locale}${slugToHref(slug)}`;

const humanizeSegment = (segment: string): string =>
  segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const buildNav = (index: ManifestIndex, hrefPrefix: string, titleBySlug?: Map<string, string>): NavGroup[] => {
  const groups: NavGroup[] = [];
  const byLabel = new Map<string | null, NavGroup>();
  const groupFor = (label: string | null): NavGroup => {
    const existing = byLabel.get(label);
    if (existing) {
      return existing;
    }
    const group: NavGroup = { label, entries: [] };
    byLabel.set(label, group);
    groups.push(group);
    return group;
  };
  for (const page of index.pages) {
    const segments = page.slug.split('/');
    const first = segments[0];
    const label = segments.length > 1 && first !== undefined ? humanizeSegment(first) : null;
    groupFor(label).entries.push({
      label: titleBySlug?.get(page.slug) ?? page.title,
      href: `${hrefPrefix}${slugToHref(page.slug)}`
    });
  }
  return groups;
};

// One nav per locale so translated routes link within their own locale, using translated page
// titles where the translation shard provides them.
const buildNavByLocale = (
  index: ManifestIndex,
  sourceLocale: string,
  translations: EmitSitePage[]
): Record<string, NavGroup[]> => {
  const navByLocale: Record<string, NavGroup[]> = { [sourceLocale]: buildNav(index, '') };
  const titlesByLocale = new Map<string, Map<string, string>>();
  for (const translation of translations) {
    const locale = translation.shard.locale;
    const titles = titlesByLocale.get(locale) ?? new Map<string, string>();
    titles.set(translation.shard.page.slug, translation.shard.page.title);
    titlesByLocale.set(locale, titles);
  }
  for (const [locale, titles] of titlesByLocale) {
    navByLocale[locale] = buildNav(index, `/${locale}`, titles);
  }
  return navByLocale;
};

// slug -> alternates across locales, source locale first. Only slugs with at least one
// translation get target entries; single-locale pages render no switcher.
const buildAlternatesBySlug = (
  pages: EmitSitePage[],
  translations: EmitSitePage[],
  sourceLocale: string
): Map<string, LocaleAlternate[]> => {
  const alternates = new Map<string, LocaleAlternate[]>();
  for (const page of pages) {
    const slug = page.shard.page.slug;
    alternates.set(slug, [{ locale: sourceLocale, href: slugToHref(slug) }]);
  }
  for (const translation of translations) {
    const slug = translation.shard.page.slug;
    const locale = translation.shard.locale;
    const existing = alternates.get(slug) ?? [{ locale: sourceLocale, href: slugToHref(slug) }];
    if (!existing.some((alternate) => alternate.locale === locale)) {
      existing.push({ locale, href: localeHref(slug, locale, sourceLocale) });
    }
    alternates.set(slug, existing);
  }
  return alternates;
};

// KERNEL-OWNED FRONTMATTER (impl-24 finding): every `docstube*` key on a route is COMPUTED here
// from the persisted trust spine. Authored frontmatter that declares one — a writer (or a
// hand-edited artifact) carrying `docstubeClaimsComplete: true` on a partial page — used to
// survive into the emitted route and decide the badge. The authored keys are stripped before the
// computed ones are injected, so the kernel value always wins and there is exactly one of each.
//
// PARSED, NOT PATTERN-MATCHED (wave 2b close finding): the previous pass was line-scoped text, so
// every ordinary YAML spelling of the same key walked straight through it — `"docstubeReviewedFor":
// "security"`, the explicit form `? docstubeClaimsComplete` / `: true`, a key indented by a space.
// Any one of them survived hashing and rendered a false editorial trust label. Ownership is decided
// on the PARSED key — YAML compares keys by resolved scalar value, so quoting and key style cannot
// change what a key is — and matched case-INsensitively, since `DocstubeReviewedFor` is a
// kernel-namespace key by any honest reading. Non-docstube keys re-serialize through the Document
// API, which preserves their comments, quoting, and block/flow style.
//
// ONE PARSE, ONE SERIALIZE (wave 2b close 2 finding): the kernel's own keys are SET on this same
// document and the document is serialized exactly once. Appending `key: value` TEXT to a
// re-serialized authored block was a second, incompatible syntax: an authored flow root
// (`{ title: Docs }`) followed by block lines is not YAML at all, so a perfectly ordinary page
// emitted a route Astro cannot parse.
type AuthoredFrontmatter = {
  // The authored mapping with every kernel-owned key deleted — the single document the kernel's
  // computed keys are set on, and the only thing that gets serialized.
  document: Document;
  // Top-level key names that DID survive — what the injection consults instead of re-scanning the
  // text, so a quoted `"title"` can no longer smuggle in a duplicate.
  keys: Set<string>;
  warning?: string;
};

// Kernel-created nodes carry no parsed style, so these defaults decide how they are spelled:
// double-quoted string values (the JSON spelling every theme and test already reads), plain keys,
// and unpadded flow collections. Authored nodes keep the style they were parsed with — a parsed
// scalar carries its own type — so an author's quoting, comments, and block/flow choices survive.
const frontmatterStringifyOptions: ToStringOptions = {
  lineWidth: 0,
  defaultStringType: 'QUOTE_DOUBLE',
  defaultKeyType: 'PLAIN',
  flowCollectionPadding: false
};

const emptyFrontmatterDocument = (): Document => new Document({});

// FAIL CLOSED (wave 2b close): frontmatter the kernel cannot parse is frontmatter whose keys it
// cannot vet, and passing it through verbatim is exactly how an authored `docstube*` key would
// reach the reader. The page is emitted as if it declared nothing, and the dropped block is
// surfaced as a warning naming the route so the author can see what happened.
const failClosed = (route: string, problem: string, reason: string): AuthoredFrontmatter => ({
  document: emptyFrontmatterDocument(),
  keys: new Set(),
  warning:
    `route "${route}": authored frontmatter ${problem} (${reason}), so it was dropped — the page renders ` +
    'with kernel-computed frontmatter only. Fix the frontmatter block in the page source and re-run ' +
    '`docstube generate`'
});

// Constructs whose meaning the kernel cannot decide by looking at top-level key names. An alias or
// a merge key (`<<: *base`) INSERTS pairs the kernel never sees as pairs — a merged mapping can
// carry `docstubeReviewedFor`, minting a false editorial trust label on an unreviewed page — and an
// explicit/unresolved tag reinterprets a node's value under a schema the kernel did not vet (and
// Astro's parser would reject anyway). None of these can be filtered by key name, and all of them
// are vanishingly rare in docs frontmatter, so the whole authored block fails closed instead.
const unvettableConstruct = (document: Document): string | undefined => {
  const unresolvedTag = document.warnings[0];
  if (unresolvedTag !== undefined) {
    return unresolvedTag.message;
  }
  // Merge keys are reported first: `<<` is the construct an author is most likely to have written
  // deliberately, and the anchor it points at would otherwise be blamed instead.
  let merge: string | undefined;
  visit(document, {
    Pair(_key, pair) {
      if (isScalar(pair.key) && pair.key.value === '<<') {
        merge ??= 'YAML merge key "<<"';
      }
    }
  });
  if (merge !== undefined) {
    return merge;
  }
  let reason: string | undefined;
  visit(document, {
    Node(_key, node) {
      if (isAlias(node)) {
        reason ??= `YAML alias "*${node.source}"`;
      } else if (node.anchor !== undefined) {
        reason ??= `YAML anchor "&${node.anchor}"`;
      } else if (node.tag !== undefined) {
        reason ??= `explicit YAML tag "${node.tag}"`;
      }
    }
  });
  return reason;
};

const pairKeyName = (pair: Pair): string | undefined =>
  isScalar(pair.key) && typeof pair.key.value === 'string' ? pair.key.value : undefined;

// COMPLEX ROOT KEYS FAIL CLOSED (wave 2b close): ownership is decided on the RESOLVED key string,
// so a root key the kernel cannot read as a string is a key it cannot vet — while the downstream
// YAML parser still gives it one, and decides the spelling itself. The explicit form
// `? [docstubeReviewedFor]` / `: security` walked straight past the namespace strip and reached
// Astro's loader as the key `docstubeReviewedFor` (js-yaml resolves a sequence key to its joined
// items), minting a false editorial trust label on an unreviewed page. Same treatment as anchors,
// aliases, merge keys, and tags — all vanishingly rare in docs frontmatter, none filterable by key
// name — the whole authored block is dropped.
const complexRootKey = (pair: Pair): string | undefined => {
  if (pairKeyName(pair) !== undefined) {
    return undefined;
  }
  const key = pair.key;
  if (isSeq(key)) {
    return 'a root key that is a sequence, not a plain scalar';
  }
  if (isMap(key)) {
    return 'a root key that is a mapping, not a plain scalar';
  }
  return 'a root key that is not a plain string scalar';
};

const readAuthoredFrontmatter = (frontmatter: string, route: string): AuthoredFrontmatter => {
  if (frontmatter.trim() === '') {
    return { document: emptyFrontmatterDocument(), keys: new Set() };
  }
  let document;
  try {
    document = parseDocument(frontmatter);
  } catch (error) {
    return failClosed(route, 'could not be parsed as a YAML mapping', (error as Error).message);
  }
  if (document.errors.length > 0) {
    return failClosed(route, 'could not be parsed as a YAML mapping', document.errors[0]?.message ?? 'invalid YAML');
  }
  const contents = document.contents;
  if (!isMap(contents)) {
    // A scalar or sequence document has nowhere to put the kernel's keys.
    return failClosed(route, 'could not be parsed as a YAML mapping', 'frontmatter must be a mapping of keys');
  }
  const unvettable = unvettableConstruct(document);
  if (unvettable !== undefined) {
    return failClosed(route, 'uses a YAML construct the kernel cannot vet', unvettable);
  }
  for (const pair of contents.items) {
    const complexKey = complexRootKey(pair);
    if (complexKey !== undefined) {
      return failClosed(route, 'uses a YAML construct the kernel cannot vet', complexKey);
    }
  }
  const keys = new Set<string>();
  const surviving: typeof contents.items = [];
  // NO COMMENT MIGRATION (wave 2b close, deliberate — do not re-add): a comment written above a
  // deleted `docstube*` pair is deleted with the pair, which is the yaml Document's own behavior and
  // is defensible — the comment sat above a key the kernel owns. Reattributing it to the next
  // surviving pair was purely cosmetic and bought real defects: a spurious `#null` comment, reversed
  // trailing-comment order, and silently skipped complex keys.
  for (const pair of contents.items) {
    const name = pairKeyName(pair);
    if (name !== undefined && name.toLowerCase().startsWith('docstube')) {
      continue;
    }
    if (name !== undefined) {
      keys.add(name);
    }
    surviving.push(pair);
  }
  contents.items = surviving;
  // FLOW ROOT NORMALIZED TO BLOCK (wave 2b close 2): the kernel sets a dozen keys on this mapping,
  // and a flow root would put every one of them on a single unreadable line. Block style is what
  // every other emitted route uses, and the conversion is style-only — the authored keys, values,
  // comments, and any NESTED flow collections are untouched.
  contents.flow = false;
  return { document, keys };
};

// Visible per-entity citations (PRODUCT §3.2): page-level sources plus every block-level source
// on the page, deduplicated, rendered by the layout as the Sources footer.
const collectPageSources = (page: PageEntity): SourceRef[] => {
  const seen = new Set<string>();
  const sources: SourceRef[] = [];
  const add = (refs: SourceRef[]) => {
    for (const ref of refs) {
      const key = `${ref.file}:${ref.span?.join('-') ?? ''}:${ref.commit}`;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push(ref);
      }
    }
  };
  add(page.provenance.sources);
  const blocks = [...page.preamble, ...page.sections.flatMap((section) => section.blocks)];
  for (const block of blocks) {
    add(block.provenance.sources);
  }
  return sources;
};

// The component imports injected into every page route, generated from the theme's renderer map:
// contract name -> '<site-relative module>[#ExportName]' (export defaults to the contract name).
// Writer MDX must not import theme components itself — these lines put them all in scope.
const rendererImportLines = (renderers: Record<string, string>, up: string): string[] => {
  const byModule = new Map<string, string[]>();
  for (const [contractName, target] of Object.entries(renderers)) {
    const hashIndex = target.indexOf('#');
    const modulePath = hashIndex === -1 ? target : target.slice(0, hashIndex);
    const exportName = hashIndex === -1 ? contractName : target.slice(hashIndex + 1);
    const specifier = exportName === contractName ? contractName : `${exportName} as ${contractName}`;
    const list = byModule.get(modulePath) ?? [];
    list.push(specifier);
    byModule.set(modulePath, list);
  }
  return [...byModule].map(
    ([modulePath, specifiers]) => `import { ${specifiers.join(', ')} } from '${up}${modulePath}';`
  );
};

type PageRouteContext = {
  sourceLocale: string;
  alternatesBySlug: Map<string, LocaleAlternate[]>;
  renderers: Record<string, string>;
};

const pageRouteMdx = (
  page: EmitSitePage,
  context: PageRouteContext,
  onWarning: (warning: string) => void,
  // The source-locale page for a translated rendition: the canonical shard its proof derives from.
  canonical?: EmitSitePage
): string => {
  const { frontmatter: authored, body } = splitFrontmatter(page.mdx);
  const locale = page.shard.locale;
  const isSourceLocale = locale === context.sourceLocale;
  const slug = page.shard.page.slug;
  const parsed = readAuthoredFrontmatter(authored, localeHref(slug, locale, context.sourceLocale));
  if (parsed.warning !== undefined) {
    onWarning(parsed.warning);
  }
  const depth = slug.split('/').length + (isSourceLocale ? 0 : 1);
  const up = '../'.repeat(depth);
  // RENDITIONS INHERIT CANONICAL PROOF (i18n-lifecycle-v2 decisions 3/4, strict isomorphism):
  // the reader-facing correctness proof of a locale route derives from the CANONICAL source
  // shard's ledger/evidence — claim state is language-independent and marker ids are identical
  // across renditions (enforced by translation hygiene). The locale shard contributes only the
  // translation dimension (fidelity/fallback state), never its own claim counts.
  const proofShard = canonical?.shard ?? page.shard;
  // MDX↔SHARD BINDING at emission (wave 2b close final): the trust spine may only project over
  // prose the persisted state can vouch for. Translated routes keep the binding check against the
  // LOCALE shard's hash over the LOCALE MDX bytes; a source-fallback route serves the SOURCE
  // bytes, so it binds against the canonical shard instead. A mismatch (post-persistence edit) or
  // a missing hash (old shard) renders the loud UNVERIFIED state with a surfaced warning — never
  // stale claim counts over changed prose.
  const binding = checkShardMdxBinding(page.sourceFallback === true ? proofShard : page.shard, page.mdx);
  if (!binding.ok) {
    onWarning(binding.reason);
  }
  // LITERAL proof surface (impl-07 finding 4): claim counts, contradiction facts, and per-claim
  // contradicted markers straight from ClaimEvidence — the guarantee-label ladder is gone.
  const proof = binding.ok ? projectShardProof(proofShard) : projectUnboundShardProof(proofShard);
  // LOCALE SECTION ANCHORS (wave 2b close, impl-21): the canonical proof carries the SOURCE
  // page's section anchors, but a translated route renders the LOCALE document — its headings get
  // their own anchors, so chips projected wholesale would target ids that do not exist in the
  // rendered HTML. Translation hygiene guarantees an identical heading inventory (count + order),
  // so canonical sections map onto locale sections POSITIONALLY; the locale anchor/title come
  // from the locale shard's own sections, derived from the translated headings by the same
  // extraction slugger that derives the source anchors the source route relies on. A
  // source-fallback route renders the SOURCE bytes, so it keeps the canonical anchors; a
  // length mismatch (pre-inventory shard) falls back to canonical rather than guessing.
  const localeSections = page.shard.page.sections;
  const sections =
    canonical !== undefined && page.sourceFallback !== true && proof.sections.length === localeSections.length
      ? proof.sections.map((section, index) => {
          const localeSection = localeSections[index]!;
          return { ...section, anchor: localeSection.anchor, title: localeSection.title };
        })
      : proof.sections;
  // TWO-DIMENSION PROOF UI (i18n-lifecycle-v2 decision 3): the translation dimension travels
  // beside the correctness counts above, never folded into them.
  const translationAssurance = projectTranslationAssurance({
    shard: page.shard,
    isRendition: !isSourceLocale,
    sourceFallback: page.sourceFallback === true
  });
  const alternates = context.alternatesBySlug.get(slug) ?? [];
  const sources = collectPageSources(page.shard.page).map((ref) => ({
    file: ref.file,
    ...(ref.span === undefined ? {} : { line: ref.span[0], endLine: ref.span[1] }),
    commit: ref.commit
  }));
  // Every kernel-owned value is SET on the authored document (never appended as text), so the
  // emitted block is one internally consistent YAML mapping whatever the author wrote.
  const document = parsed.document;
  const set = (key: string, value: string | number | boolean): void => {
    document.set(key, value);
  };
  // Structured values stay on one line, as they did when they were JSON: a route carries one
  // `docstubeSources` line, not a forty-line block.
  const setFlow = (key: string, value: unknown): void => {
    const node = document.createNode(value);
    visit(node, {
      Node(_visitKey, child) {
        if (isCollection(child)) {
          child.flow = true;
        }
      }
    });
    document.set(key, node);
  };
  // Every theme bundle ships this exact layout path (validated by applyThemeBundle).
  set('layout', `${up}layouts/DocLayout.astro`);
  if (!parsed.keys.has('title')) {
    set('title', page.shard.page.title);
  }
  if (page.shard.page.description !== undefined && !parsed.keys.has('description')) {
    set('description', page.shard.page.description);
  }
  set('docstubeLocale', locale);
  set('docstubePageId', page.shard.page.id);
  set('docstubeClaimsChecked', proof.checkedClaims);
  set('docstubeClaimsTotal', proof.totalClaims);
  set('docstubeClaimsContradicted', proof.contradictedClaims);
  // Coverage lint (harness-state-v2 decision 5): assertion-shaped prose no marker covers. It
  // rides beside the counts and gates the complete state — a page with any unmarked assertion
  // can never present as done, so ledger omission cannot manufacture "100% checked".
  set('docstubeUncoveredAssertions', proof.uncoveredAssertions);
  if (proof.complete) {
    set('docstubeClaimsComplete', true);
  }
  // A page without a persisted trust spine renders a LOUD unverified warning (impl-08).
  if (proof.state === 'unverified') {
    set('docstubeUnverified', true);
  }
  // Source-fallback rendition: themes render the visible not-yet-translated notice from this.
  if (page.sourceFallback === true) {
    set('docstubeSourceFallback', true);
  }
  // The translation dimension of a served rendition, rendered as its own line by every theme.
  if (translationAssurance !== undefined) {
    set('docstubeTranslationAssurance', translationAssurance);
  }
  if (proof.contradictedMarkers.length > 0) {
    setFlow('docstubeContradictedClaims', proof.contradictedMarkers);
  }
  // Unchecked claims are individually marked inline too (impl-09 finding 2) — quieter than a
  // contradiction, but never invisible.
  if (proof.uncheckedMarkers.length > 0) {
    setFlow('docstubeUncheckedClaims', proof.uncheckedMarkers);
  }
  if (proof.reviewedFor !== undefined) {
    set('docstubeReviewedFor', proof.reviewedFor);
  }
  if (alternates.length > 1) {
    setFlow('docstubeAlternates', alternates);
  }
  if (sources.length > 0) {
    setFlow('docstubeSources', sources);
  }
  if (sections.length > 0) {
    setFlow('docstubeSections', sections);
  }
  return [
    '---',
    document.toString(frontmatterStringifyOptions).trimEnd(),
    '---',
    '',
    // The kernel-owned inline Claim renderer is always in scope: writer MDX carries <Claim>
    // markers, and the contradiction marks target their rendered spans.
    `import Claim from '${up}docstube/DocstubeClaim.astro';`,
    ...rendererImportLines(context.renderers, up),
    '',
    body.trimEnd(),
    ''
  ].join('\n');
};

const generatedSitePackageJson = (dependencies: Record<string, string>): string =>
  `${JSON.stringify(
    {
      name: 'docstube-generated-site',
      private: true,
      type: 'module',
      scripts: {
        dev: 'astro dev',
        build: 'astro build',
        // Pagefind indexes the built site; the search UI degrades gracefully when it never ran.
        postbuild: 'pagefind --site dist',
        preview: 'astro preview'
      },
      dependencies
    },
    null,
    2
  )}\n`;

// The kernel owns astro.config.mjs: generated from invariants (MDX, static output, base URL) plus
// the theme's typed build hooks — themes never own the config file.
const astroConfigMjs = (config: DocstubeConfig, build: ThemeBuild): string => {
  const shiki = build.shiki;
  const transformerImports = (shiki?.transformers ?? []).map(
    (modulePath, index) => `import themeShikiTransformers${index} from './src/${modulePath}';`
  );
  const shikiThemeLines =
    shiki === undefined
      ? []
      : shiki.themes.length > 1
        ? [`      themes: { light: ${JSON.stringify(shiki.themes[0])}, dark: ${JSON.stringify(shiki.themes[1])} },`]
        : [`      theme: ${JSON.stringify(shiki.themes[0])},`];
  const shikiTransformerLines =
    shiki === undefined || (shiki.transformers ?? []).length === 0
      ? []
      : [
          `      transformers: [${(shiki.transformers ?? []).map((_, index) => `...themeShikiTransformers${index}`).join(', ')}],`
        ];
  return [
    "import mdx from '@astrojs/mdx';",
    "import { defineConfig } from 'astro/config';",
    ...(build.integrationsModule === undefined
      ? []
      : [`import themeIntegrations from './src/${build.integrationsModule}';`]),
    ...transformerImports,
    '',
    '// TODO(review-ui): rehype plugin slot — a `markdown.processor` rehype plugin will inject',
    '// data-entity-id attributes on arbitrary blocks from the manifest sidecar (ARCHITECTURE.md',
    '// §3.4). Section-level guarantee chips already ship (injected by the layout by anchor);',
    '// block-level addressing is deliberately not faked in v1.',
    'export default defineConfig({',
    `  integrations: [mdx()${build.integrationsModule === undefined ? '' : ', ...themeIntegrations'}],`,
    "  output: 'static',",
    ...(config.site.baseUrl === undefined ? [] : [`  site: ${JSON.stringify(config.site.baseUrl)},`]),
    ...(shiki === undefined
      ? []
      : ['  markdown: {', '    shikiConfig: {', ...shikiThemeLines, ...shikiTransformerLines, '    }', '  },']),
    '});',
    ''
  ].join('\n');
};

type SiteDataInput = {
  config: DocstubeConfig;
  navByLocale: Record<string, NavGroup[]>;
  currentVersion: string;
  frozenVersions: string[];
  repoUrl: string | undefined;
};

const siteDataMjs = (input: SiteDataInput): string =>
  [
    `export const siteTitle = ${JSON.stringify(input.config.site.title)};`,
    `export const siteDescription = ${JSON.stringify(input.config.site.description)};`,
    `export const siteUrl = ${JSON.stringify(input.config.site.baseUrl ?? null)};`,
    `export const layoutMode = ${JSON.stringify(input.config.site.layout)};`,
    `export const footerCredit = ${JSON.stringify(input.config.site.footerCredit)};`,
    `export const sourceLocale = ${JSON.stringify(input.config.locales.source)};`,
    `export const repoUrl = ${JSON.stringify(input.repoUrl ?? null)};`,
    // Frozen labels link to /versions/<label>/; emitting frozen snapshot content is pending.
    `export const versions = ${JSON.stringify({ current: input.currentVersion, frozen: input.frozenVersions })};`,
    `export const navByLocale = ${JSON.stringify(input.navByLocale, null, 2)};`,
    ''
  ].join('\n');

const kebabCase = (name: string): string => name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

// Kernel-emitted src/docstube/tokens.css: the theme's token defaults merged with the config
// theme.tokens overrides, exposed as CSS custom properties. The four semantic tokens
// (accent/accentDark/fontBody/fontCode) are honored by every theme; the legacy 'font-family'
// token stays an alias of the final body font so the existing token vocabulary keeps working.
export const tokensCss = (theme: ThemeBundle, config: DocstubeConfig): string => {
  const overrides = config.theme.tokens;
  const merged: Record<string, string> = { ...theme.manifest.tokens, ...overrides };
  const legacyFont = overrides['font-family'];
  if (legacyFont !== undefined && overrides.fontBody === undefined) {
    merged.fontBody = legacyFont;
  }
  if (merged.fontBody !== undefined) {
    merged['font-family'] = merged.fontBody;
  }
  const lines = Object.entries(merged).map(([name, value]) => `  --${kebabCase(name)}: ${value};`);
  return [
    '/* Generated by docstube (kernel-owned): theme token defaults + config theme.tokens. */',
    ':root {',
    ...lines,
    '}',
    ''
  ].join('\n');
};

type LlmsPage = {
  title: string;
  url: string;
  description?: string | undefined;
  content: string;
};

// Source locale only, deliberately: the source locale is truth (PRODUCT §4.1) and llms-full.txt
// concatenates full page bodies — including translations would multiply its token cost per
// locale while adding no facts an agent could not get from the source text.
const llmsPages = (pages: EmitSitePage[]): LlmsPage[] =>
  pages
    .map((page) => ({
      title: page.shard.page.title,
      url: slugToHref(page.shard.page.slug),
      description: page.shard.page.description,
      content: splitFrontmatter(page.mdx).body.trim()
    }))
    .toSorted((left, right) => left.url.localeCompare(right.url));

const llmsText = (config: DocstubeConfig, pages: LlmsPage[]): string => {
  const lines = [`# ${config.site.title}`, ''];
  if (config.site.description !== '') {
    lines.push(`> ${config.site.description}`, '');
  }
  lines.push('## Docs');
  for (const page of pages) {
    const description = page.description === undefined ? '' : `: ${page.description}`;
    lines.push(`- [${page.title}](${page.url})${description}`);
  }
  return `${lines.join('\n')}\n`;
};

const llmsFullText = (config: DocstubeConfig, pages: LlmsPage[]): string => {
  const lines = [`# ${config.site.title}`, ''];
  if (config.site.description !== '') {
    lines.push(`> ${config.site.description}`, '');
  }
  for (const page of pages) {
    lines.push(`## ${page.title}`, '', `URL: ${page.url}`, '', page.content, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
};

const siteIndexJson = (config: DocstubeConfig, index: ManifestIndex, pages: EmitSitePage[]): string =>
  `${JSON.stringify(
    {
      site: config.site.title,
      description: config.site.description,
      generatorVersion: index.docstubeVersion,
      pages: pages
        .map((page) => ({
          title: page.shard.page.title,
          slug: page.shard.page.slug,
          url: slugToHref(page.shard.page.slug),
          ...(page.shard.page.description === undefined ? {} : { description: page.shard.page.description })
        }))
        .toSorted((left, right) => left.slug.localeCompare(right.slug))
    },
    null,
    2
  )}\n`;

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const sitemapXml = (baseUrl: string, urls: string[]): string => {
  const base = baseUrl.replace(/\/$/u, '');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.flatMap((url) => ['  <url>', `    <loc>${escapeXml(`${base}${url}`)}</loc>`, '  </url>']),
    '</urlset>',
    ''
  ].join('\n');
};

const robotsTxt = (baseUrl: string): string =>
  ['User-agent: *', 'Allow: /', '', `Sitemap: ${baseUrl.replace(/\/$/u, '')}/sitemap.xml`, ''].join('\n');

const writeTextFile = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
};

// ROUTE PRUNING (impl-23 finding 2). Emission is a RECONCILER, not an appender: writing the
// desired routes without removing the ones that disappeared leaves a deleted page — or the old
// slug of a renamed one — fully renderable, serving prose and proof that no current manifest shard
// describes. `docstube generate` is the single idempotent reconciler (PRODUCT §9), so the rendered
// route tree must equal the desired set exactly.
//
// SCOPE IS DELIBERATELY NARROW — only the two file classes emission itself writes per route:
//   src/pages/**/*.mdx   the generated routes (theme bundles are forbidden from this namespace)
//   public/**/*.md       the raw-markdown twins (a theme may never own a public/**.md either)
// Both are in apply-theme-bundle's protected list, so nothing here can ever be theme- or
// user-authored. Every other file under outDir — theme assets, public/*.txt, sitemap, mcp/,
// node_modules, dist — is untouched, and nothing outside outDir is ever considered.
//
// A DIRECTORY THAT CANNOT BE READ IS REPORTED (impl-24 finding): only ENOENT — "the tree does not
// exist yet" — is an ordinary, silent outcome. Any other readdir failure (EACCES, EPERM, EIO, a
// path replaced by a file) means the reconciler could not see part of the tree, so obsolete routes
// may still be serving. Swallowing it turned "stale routes deleted" into an unverifiable claim;
// the path is surfaced as an emit warning instead.
const collectFiles = async (
  root: string,
  extension: string,
  onWarning: (warning: string) => void
): Promise<string[]> => {
  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        onWarning(
          `could not scan "${directory}" for obsolete ${extension} routes (${code ?? 'unknown error'}: ` +
            `${(error as Error).message}) — stale routes under it may still be served; check the directory's ` +
            'permissions and re-run `docstube generate`'
        );
      }
      return;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        found.push(absolute);
      }
    }
  };
  await walk(root);
  return found;
};

// Directories the prune emptied are removed too, so a deleted section leaves no hollow tree.
// rmdir without recursive fails on a non-empty directory, which is exactly the guard wanted.
const removeEmptyParents = async (from: string, stopAt: string): Promise<void> => {
  let directory = dirname(from);
  while (directory.startsWith(stopAt) && directory !== stopAt) {
    try {
      await rmdir(directory);
    } catch {
      return;
    }
    directory = dirname(directory);
  }
};

const pruneObsoleteFiles = async (
  siteRoot: string,
  root: string,
  extension: string,
  desired: ReadonlySet<string>,
  onWarning: (warning: string) => void
): Promise<string[]> => {
  const pruned: string[] = [];
  for (const absolute of await collectFiles(root, extension, onWarning)) {
    if (desired.has(absolute)) {
      continue;
    }
    await rm(absolute, { force: true });
    await removeEmptyParents(absolute, root);
    pruned.push(relative(siteRoot, absolute).split(sep).join(posix.sep));
  }
  return pruned;
};

// EMISSION PLANNING GATE (impl-24 finding): a source page whose slug starts with a configured
// target locale code wants the same route as that locale's rendition of the remaining path, and
// whichever write lands last owns it. Emission refuses to plan such a tree at all — the page, its
// slug, and the locale are all named, because only the author can decide which of the two to
// rename.
const assertNoLocaleRouteCollisions = (pages: readonly EmitSitePage[], targetLocales: readonly string[]): void => {
  for (const page of pages) {
    const slug = page.shard.page.slug;
    const locale = localeRoutePrefixConflict(slug, targetLocales);
    if (locale !== undefined) {
      throw new ThemeError(
        'route-locale-collision',
        `page "${page.shard.page.title}" has slug "${slug}", which collides with the "${locale}" locale route ` +
          `namespace: translated pages are emitted under /${locale}/<slug>, so this page and the ${locale} ` +
          `rendition of "${slug.slice(locale.length + 1)}" would fight over the same route. Rename the page's slug ` +
          `in ia.yml, or remove "${locale}" from locales.targets in docstube.yml`,
        { slug, locale, pageId: page.shard.page.id }
      );
    }
  }
};

export const emitSite = async (input: EmitSiteInput): Promise<EmitSiteResult> => {
  const siteRoot = join(input.repoRoot, input.outDir);
  const theme = input.theme;
  const sourceLocale = input.config.locales.source;
  const translations = input.translations ?? [];
  assertNoLocaleRouteCollisions(input.pages, input.config.locales.targets);
  const navByLocale = buildNavByLocale(input.index, sourceLocale, translations);
  const alternatesBySlug = buildAlternatesBySlug(input.pages, translations, sourceLocale);
  const routeContext: PageRouteContext = { sourceLocale, alternatesBySlug, renderers: theme.manifest.renderers };
  const pages = llmsPages(input.pages);
  const baseUrl = input.config.site.baseUrl;
  const currentVersion =
    input.index.versions.find((version) => version.status === 'current')?.label ?? input.config.versions.current;

  // Theme-owned files + kernel-generated config, applied with the ownership-manifest algorithm
  // (stale theme files from a previous theme are removed; user-modified files are preserved).
  const applied = await applyThemeBundle({
    siteRoot,
    bundle: theme,
    previousManifestPath: join(input.repoRoot, '.docstube', 'theme-files.json'),
    themeVersion: input.index.docstubeVersion,
    kernelConfigFiles: [
      { path: 'package.json', content: generatedSitePackageJson(mergeDependencies(theme)) },
      { path: 'astro.config.mjs', content: astroConfigMjs(input.config, theme.manifest.build) }
    ],
    ...(input.forceTheme === undefined ? {} : { force: input.forceTheme })
  });

  const writes: Array<Promise<void>> = [
    writeTextFile(join(siteRoot, '.gitignore'), 'dist/\nnode_modules/\n.astro/\n'),
    writeTextFile(
      join(siteRoot, 'src/site-data.mjs'),
      siteDataMjs({
        config: input.config,
        navByLocale,
        currentVersion,
        frozenVersions: input.frozenVersions ?? [],
        repoUrl: input.repoUrl
      })
    ),
    // Kernel-owned proof primitives + design tokens (src/docstube/**): every theme layout mounts
    // these; rewritten on every emit, never part of the theme bundle.
    writeTextFile(join(siteRoot, 'src/docstube/tokens.css'), tokensCss(theme, input.config)),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeClaims.astro'), docstubeClaimsAstro()),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeContradictions.astro'), docstubeContradictionsAstro()),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeClaim.astro'), docstubeClaimAstro()),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeSources.astro'), docstubeSourcesAstro()),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeEntity.astro'), docstubeEntityAstro()),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeSectionChips.astro'), docstubeSectionChipsAstro()),
    writeTextFile(join(siteRoot, 'src/docstube/DocstubeSearch.astro'), docstubeSearchAstro()),
    writeTextFile(join(siteRoot, 'public/llms.txt'), llmsText(input.config, pages)),
    writeTextFile(join(siteRoot, 'public/llms-full.txt'), llmsFullText(input.config, pages)),
    writeTextFile(join(siteRoot, 'mcp/site-index.json'), siteIndexJson(input.config, input.index, input.pages)),
    writeTextFile(join(siteRoot, 'mcp/docs-mcp-server.mjs'), docsMcpServerMjs()),
    writeTextFile(join(siteRoot, 'mcp/README.md'), docsMcpReadmeMd())
  ];

  const warnings: string[] = [];
  const collectWarning = (warning: string): void => {
    warnings.push(warning);
  };
  // The DESIRED route set, accumulated as the routes are written — the exact inventory the prune
  // below reconciles the emitted tree against.
  const desiredRoutes = new Set<string>();
  const desiredTwins = new Set<string>();
  for (const page of input.pages) {
    const slug = page.shard.page.slug;
    const routePath = join(siteRoot, 'src/pages', `${slug}.mdx`);
    const twinPath = join(siteRoot, 'public', `${slug}.md`);
    desiredRoutes.add(routePath);
    desiredTwins.add(twinPath);
    writes.push(
      writeTextFile(routePath, pageRouteMdx(page, routeContext, collectWarning)),
      // Raw markdown mirror at every doc URL, for agents and curl users.
      writeTextFile(twinPath, page.mdx)
    );
  }
  // Canonical source page by page id — the shard a translated rendition's proof derives from
  // (locale is an address dimension: identical page ids across locales).
  const sourceByPageId = new Map(input.pages.map((page) => [page.shard.page.id, page]));
  for (const translation of translations) {
    const slug = translation.shard.page.slug;
    const locale = translation.shard.locale;
    const routePath = join(siteRoot, 'src/pages', locale, `${slug}.mdx`);
    const twinPath = join(siteRoot, 'public', locale, `${slug}.md`);
    desiredRoutes.add(routePath);
    desiredTwins.add(twinPath);
    writes.push(
      writeTextFile(
        routePath,
        pageRouteMdx(translation, routeContext, collectWarning, sourceByPageId.get(translation.shard.page.id))
      ),
      writeTextFile(twinPath, translation.mdx)
    );
  }

  if (baseUrl !== undefined) {
    const urls = [
      ...pages.map((page) => page.url),
      ...translations.map((translation) =>
        localeHref(translation.shard.page.slug, translation.shard.locale, sourceLocale)
      )
    ].toSorted();
    writes.push(
      writeTextFile(join(siteRoot, 'public/sitemap.xml'), sitemapXml(baseUrl, urls)),
      writeTextFile(join(siteRoot, 'public/robots.txt'), robotsTxt(baseUrl))
    );
  }

  await Promise.all(writes);
  // Reconcile AFTER the desired routes exist, so an interrupted write never leaves a page with
  // neither its old route nor its new one.
  const pruned = [
    ...(await pruneObsoleteFiles(siteRoot, join(siteRoot, 'src/pages'), '.mdx', desiredRoutes, collectWarning)),
    ...(await pruneObsoleteFiles(siteRoot, join(siteRoot, 'public'), '.md', desiredTwins, collectWarning))
  ].toSorted((left, right) => left.localeCompare(right));
  return { themeConflicts: applied.conflicts, warnings, pruned };
};
