I treated the newer founder-decision documents—especially `trust-model-v2`, `i18n-lifecycle-v2`, and `release-scope-v2`—as binding refinements of PRODUCT.md for 0.1.0.

## Design problems

### 1. The guarantee chip is not yet a defensible reader contract

Severity: **fundamental**

Why the current design is ineffective:

The UI translates internal states into `verified`, `reviewed`, and `unverified`, as though these were three points on one confidence scale. They are not. “Reviewed” is an editorial assessment with an unspecified reviewer; “unverified” mixes several materially different reasons; and “verified” does not tell the reader what proposition was checked. [proof-source.ts](/C:/Projects/docstube/packages/theme/src/proof-source.ts:8)

The only explanation is a hover-only `title` containing a block count. The dogfood site exposes the contradiction sharply: the GitHub Action page is labeled `verified` while reporting 2 of 22 blocks proven and four of five sections as merely reviewed. [DocLayout.astro](/C:/Projects/docstube/packages/theme/src/themes/docstube/site/layouts/DocLayout.astro:28) [github-action.mdx](/C:/Projects/docstube/docs-site/src/pages/github-action.mdx:7)

The binding trust redesign already has the right semantic direction: the full badge means 100% of declared factual claims received claim-class-appropriate evidence; editorial review becomes a separate axis; ambiguous `out-of-domain` is replaced by explicit dispositions. [trust-model-v2.md](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:9)

Concrete better design:

Use one page-level trust control with literal, quantitative language:

- Complete: `All 23 factual claims checked`
- Partial: `18/23 checked · 2 issues · 3 need input`
- Separate row: `AI-reviewed for SDK integrators`
- For localized pages: `German translation fidelity-reviewed`

Clicking it should open a popover containing the denominator, evidence mix, unresolved dispositions, last checked commit/date, and a short definition of “checked.” Reserve green for 100% completion. Positive section chips should disappear; show section markers only for exceptions or partial coverage. Add a generated `/verification/` trust report for site-wide methodology, coverage, and unresolved issues.

Cost now versus after release:

High now, but it is already part of the mandatory claim-ledger migration. After 0.1.0, this becomes a public retraction of badge semantics, a manifest migration, and a reputational problem: previously “verified” pages may need their status revoked.

### 2. “Sources” are detached from the claims they supposedly support

Severity: **fundamental**

Why the current design is ineffective:

The emitter unions page-, block-, and claim-level references into one deduplicated page list, destroying the claim-to-evidence relationship. [emit-site.ts](/C:/Projects/docstube/packages/theme/src/emit-site.ts:193) The renderer then presents the result as a flat footer titled “Sources,” with only path, starting line, and commit. [proof-source.ts](/C:/Projects/docstube/packages/theme/src/proof-source.ts:32)

This is provenance-shaped noise, not proof. A reader cannot determine:

- Which sentence a source supports.
- Whether the evidence was merely read, structurally matched, executed, schema-checked, or maintainer-attested.
- What exact assertion a verifier evaluated.
- Why a neighboring claim remains unchecked.

The dogfood build demonstrates the scaling failure: “How verification works” emits 133 source links; other six-page dogfood pages emit 46–114 each. Its injected source metadata alone is 16,875 characters. [how-verification-works.mdx](/C:/Projects/docstube/docs-site/src/pages/how-verification-works.mdx:10)

Concrete better design:

Attach a compact evidence button to each factual claim. Its accessible popover should show:

- Exact claim.
- Evidence disposition and evidence type.
- Source span or maintainer attestation.
- Check performed and outcome.
- Commit/revision and tool version.
- Direct source link when available.

Rename the footer to “Files consulted,” collapse it by default, and explicitly state that it is debugging lineage rather than evidence. Private repositories should default to link/path-only evidence; embedding source excerpts should require policy opt-in.

Cost now versus after release:

Moderate-to-high now because it depends on the claim ledger, but it is localized to the same migration. After release, it changes rendered markup, theme contracts, proof terminology, and potentially public links anchored to the old footer.

### 3. The AI-readable outputs discard the product’s defining trust information

Severity: **fundamental**

Why the current design is ineffective:

The human site receives guarantee metadata, but every AI-facing representation loses it:

- `llms-full.txt` concatenates MDX bodies after stripping frontmatter.
- Per-page `.md` mirrors copy the original MDX, not the injected proof metadata.
- `site-index.json` contains only title, slug, URL, and description.
- MCP `read_wiki_contents` returns the same evidence-free mirror.

[emit-site.ts](/C:/Projects/docstube/packages/theme/src/emit-site.ts:411) [emit-site.ts](/C:/Projects/docstube/packages/theme/src/emit-site.ts:437) [emit-site.ts](/C:/Projects/docstube/packages/theme/src/emit-site.ts:448) [mcp-server-source.ts](/C:/Projects/docstube/packages/theme/src/mcp-server-source.ts:71)

An AI consumer therefore cannot distinguish a checked claim from an unchecked one, even though AI consumption is exactly where confident reuse of weak claims is dangerous. The `llms.txt + .md + MCP` story is currently a collection of delivery formats, not a verified knowledge contract.

Concrete better design:

Generate one canonical machine-readable docs corpus containing:

- Resolved IA and routes.
- Page/entity IDs and revision.
- Locale and publication state.
- Normalized Markdown rather than theme-specific MDX.
- Claim ledger with evidence dispositions.
- Optional evidence detail and source links.

Then make everything else a projection:

- `llms.txt` → compact discovery map.
- Per-page `.md` → normalized content plus minimal trust metadata.
- `llms-full.txt` → optional bounded concatenation.
- MCP → query/read adapter over the same corpus.

An MCP page read should support `includeEvidence: summary | full`, while search results should return relevant sections and evidence summaries rather than only prose.

Cost now versus after release:

Moderate-to-high now and naturally aligned with the claim-ledger work. After release, `.md`, index, and MCP response formats become compatibility contracts consumed by external agents and integrations.

### 4. The emitted MCP server is neither a public-site feature nor a coherent local feature

Severity: **significant**

Why the current design is ineffective:

The MCP files are written to `docs-site/mcp/`, outside Astro’s `public/` and `src/pages/`; consequently they are absent from the built static site. The README requires a repository checkout, Node, and a manually started localhost server. [emit-site.ts](/C:/Projects/docstube/packages/theme/src/emit-site.ts:543) [mcp-server-source.ts](/C:/Projects/docstube/packages/theme/src/mcp-server-source.ts:188)

That may be useful to a repository owner, but a reader or public AI client cannot discover or connect to it. Calling it the docs site’s Streamable HTTP MCP server overstates what ships.

The tool semantics are also strained:

- `read_wiki_structure` returns a flat list, not a tree.
- `ask_question` is keyword ranking, despite its name implying an answer.
- Every question rereads every page.
- It returns an entire best-matching page rather than focused passages.

[mcp-server-source.ts](/C:/Projects/docstube/packages/theme/src/mcp-server-source.ts:42) [mcp-server-source.ts](/C:/Projects/docstube/packages/theme/src/mcp-server-source.ts:79)

Concrete better design:

Choose one explicit 0.1.0 posture:

1. **Local repository MCP:** describe it as a developer-side adapter, emit ready-to-paste client configuration, use a precomputed corpus index, and expose honest retrieval tools such as `search_docs`, `read_page`, and `read_structure`. Keep compatibility aliases only if clearly documented.
2. **Public site MCP:** ship it only through a deployment adapter that can host a serverless/Node endpoint and define discovery, authentication, CORS, rate limits, and evidence-bearing responses.

Do not imply that static hosting provides MCP.

Cost now versus after release:

Moderate now. After release, users may already have client configurations tied to the current endpoint shape and DeepWiki-style tool semantics.

### 5. The site discards the information architecture it asks users to design

Severity: **fundamental**

Why the current design is ineffective:

`ia.yml` supports nested children, grouping nodes, briefs, and a `sectioned` mode in which top-level nodes are meant to become tabs. [ia-schema.ts](/C:/Projects/docstube/packages/contracts/src/ia-schema.ts:11) [ia-schema.ts](/C:/Projects/docstube/packages/contracts/src/ia-schema.ts:34)

The emitter does not consume that tree. It rebuilds a two-level navigation structure from the first segment of each page slug in a flat manifest index. [emit-site.ts](/C:/Projects/docstube/packages/theme/src/emit-site.ts:103) The basic theme explicitly admits that sectioned mode is still rendered as sidebar headings; the other themes similarly have no real sectioned shell. [DocLayout.astro](/C:/Projects/docstube/packages/theme/src/themes/basic/site/layouts/DocLayout.astro:67)

This is the largest gap relative to Mintlify or Starlight. Those users will miss coherent nested navigation, collapsible groups, top-level product areas, a real home page, preserved ancestry, previous/next navigation, and related-page links before they miss visual polish.

Concrete better design:

Emit a resolved navigation tree directly from `ia.yml`, with each node carrying:

- `group | page` kind.
- Page ID and resolved route.
- Children and ancestry.
- Per-locale availability.
- Current/active state.
- Previous and next page.
- Optional proof exception marker.

For 0.1.0, remove the `sectioned` choice and ship one excellent nested single-tree layout. Add sectioned mode later as a different rendering of the same tree: top-level tabs plus a section-local sidebar. Do not maintain two nominal layouts when one is not implemented.

Cost now versus after release:

Moderate now because the IA already exists. After release, layout configuration, navigation order, URLs, and user-customized generated themes become public expectations that are much harder to change.

### 6. Locale and version switchers are file-presence controls, not logical-page controls

Severity: **significant**

Why the current design is ineffective:

Locale navigation is constructed from the global page index once any translation exists, while the switcher appears only for pages with an emitted alternate. [emit-site.ts](/C:/Projects/docstube/packages/theme/src/emit-site.ts:128) [emit-site.ts](/C:/Projects/docstube/packages/theme/src/emit-site.ts:149) The result has no coherent reader contract for pending, stale, failed, or source-fallback pages.

The binding i18n design correctly requires explicit source fallbacks, stale warnings, full locale navigation, and separate source-correctness and translation-fidelity states. [i18n-lifecycle-v2.md](/C:/Projects/docstube/knowledge/design/i18n-lifecycle-v2.md:12) [i18n-lifecycle-v2.md](/C:/Projects/docstube/knowledge/design/i18n-lifecycle-v2.md:23)

Version UX is even less ready: switcher entries link to version roots rather than the corresponding logical page, while emitted frozen content is explicitly pending. [emit-site.ts](/C:/Projects/docstube/packages/theme/src/emit-site.ts:355) The binding release scope has already cut versioned docs and the switcher from 0.1.0. [release-scope-v2.md](/C:/Projects/docstube/knowledge/design/release-scope-v2.md:7)

Concrete better design:

Introduce one resolved route matrix keyed by `pageId × locale × version`. Both switchers should preserve the logical page and the other dimension. Each target must resolve to `ready`, `stale`, `source-fallback`, or unavailable, with a reader-visible explanation.

For 0.1.0:

- Remove every version switcher surface.
- Show configured locales everywhere using human-readable names.
- Serve explicit source fallbacks at locale routes.
- Mark fallback/stale entries in navigation.
- Keep source correctness and translation fidelity visually separate.

Cost now versus after release:

Locale work is high but already mandated by the binding redesign; removing the 0.1 version surface is cheap. After release, incorrect `hreflang`, indexed fallback routes, and public version URLs become expensive SEO and compatibility liabilities.

### 7. Search is wired as a dependency, not designed as part of the documentation state

Severity: **significant**

Why the current design is ineffective:

Pagefind runs over the whole `dist` tree with no emitted indexing contract beyond `pagefind --site dist`. [emit-site.ts](/C:/Projects/docstube/packages/theme/src/emit-site.ts:293) The UI supplies no locale, section, publication-state, or hierarchy filters. [proof-source.ts](/C:/Projects/docstube/packages/theme/src/proof-source.ts:115)

The rendered article also contains the giant source footer and proof chrome inside the searchable page shell. Without explicit Pagefind body and ignore boundaries, implementation paths and repeated status vocabulary can compete with actual documentation. Future locale fallbacks would add further duplicate-language results.

Concrete better design:

Keep Pagefind for 0.1.0, but define indexing as an emitter-owned contract:

- Mark only the article as `data-pagefind-body`.
- Ignore navigation, TOC, proof controls, footer credit, and files-consulted disclosure.
- Attach metadata for page ID, IA section, locale, and publication state.
- Scope results to the current locale by default.
- Exclude source-fallback pages from claiming localized search coverage.
- Render IA breadcrumbs and section excerpts in results.

Cost now versus after release:

Low-to-moderate now. Later it becomes harder because search behavior is one of the first qualities users use to judge a docs platform, even when the underlying provider remains replaceable.

### 8. The dogfood site documents implementation names instead of reader jobs

Severity: **significant**

Why the current design is ineffective:

“How verification works” opens with schema and function names; “Configuration” similarly narrates internal validators and helper functions. [how-verification-works.mdx](/C:/Projects/docstube/docs-site/content/en/how-verification-works.mdx:8) [configuration.mdx](/C:/Projects/docstube/docs-site/content/en/configuration.mdx:8)

Across all six pages there are no internal Markdown links. There is no proper overview/home page, no deployment guide despite deployment being explicitly assigned to documentation for 0.1.0, and no page explaining how readers or agents should consume `.md`, `llms.txt`, or MCP. [release-scope-v2.md](/C:/Projects/docstube/knowledge/design/release-scope-v2.md:19)

This makes the dogfood site a weak proof of its own persona-targeting claim. It reads like generated code commentary rather than product documentation.

Concrete better design:

Rebuild the dogfood IA around reader intent:

- Overview: what docstube does, when to use it, five-minute outcome.
- Guides: install, generate, configure, CI, deploy.
- Concepts: checked claims, evidence, flags, localization.
- Reference: CLI, configuration schema, plugin SDK.
- AI access: Markdown, `llms.txt`, and the honest MCP posture.
- Trust report: methodology and current dogfood verification state.

Function and schema names belong in reference details, not opening paragraphs. Add previous/next and explicit cross-links between guides and reference.

Cost now versus after release:

Low technically, but urgent for credibility. After public launch, the first-party docs become the permanent screenshot and review target against which the product’s quality claims are judged.

## Effectiveness and UX

- The current proof UI spends its visual budget on repeated H2 chips. On pages where every section says `reviewed`, repetition adds no information; exceptions should be salient, not normal state.

- Dogfood source disclosure is disproportionately expensive: 46–133 source links per page, plus 7–17 KB of source metadata in frontmatter, for no claim-level interpretability.

- `llms-full.txt` is unbounded whole-corpus duplication. For large sites it encourages agents to ingest far more context than necessary; emit it only below a documented size threshold or split it by IA section.

- MCP `ask_question` rereads the full corpus on every call and returns an entire page. A prebuilt index plus heading-level retrieval would reduce I/O and downstream token use substantially.

- Three theme layouts independently implement proof, search, version, and locale controls. The conformance tests assert that strings and mounts exist, not that the reader can interpret or operate them. [proof-conformance.spec.ts](/C:/Projects/docstube/packages/theme/src/proof-conformance.spec.ts:34) Kernel-owned headless interaction primitives would reduce duplicated fixes while preserving theme styling.

- The public `sectioned` option and latent version switcher expand configuration, testing, and support costs without producing a distinct usable reader experience.

- The most conspicuous Mintlify/Starlight omissions are structural: a home page, deep/collapsible navigation, previous/next links, related pages, a page action menu for Copy/View Markdown/Edit, and switchers/search that preserve the reader’s current context.

## What is genuinely good

- Kernel ownership of mandatory proof primitives across every theme is the correct invariant and must survive the redesign.

- A self-contained ejected Astro site with static Pagefind and per-page machine-readable content is the right local-first foundation.

- Treating the source locale as canonical and translations as derived renditions is the right basis for trustworthy multilingual docs.

## Open questions for the founder

1. Should the primary reader label remain **“Verified”**, or change to the more literal **“All N factual claims checked”** with “verified” used only in explanatory copy?

2. For 0.1.0, should `sectioned` be removed so one excellent nested layout ships, or is section-tab navigation important enough to finish before release?

3. Is the docs MCP server a **local repository tool** or a **public deployed endpoint**? Supporting both should come only after one is made coherent.

4. Should `llms-full.txt` always be emitted, or be omitted/split once the corpus exceeds a documented token or byte threshold?

5. Should every checked claim display an inline evidence marker, or should positive evidence remain visually quiet until the reader enables a “show evidence” mode?

6. Should search be strictly scoped to the current locale, or offer an explicit “all languages” mode?

7. Does 0.1.0 need a mandatory generated trust-report page, or is a per-page trust popover sufficient as the sole reader explanation?

8. Should the dogfood documentation be restructured into a complete guide/concept/reference experience before launch, or intentionally remain a small reference-first site for 0.1.0?

No files were modified.
