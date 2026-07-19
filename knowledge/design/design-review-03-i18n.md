Verdict: i18n is not release-ready as an L4 subsystem. It is currently a generate-time post-processing step attached to a source-page pipeline, while refresh, refine, versioning, verification, state, and site emission each operate under different assumptions. The redesign should treat every localization as a revisioned derived artifact keyed by `version × locale × pageId`, with explicit freshness, verification, availability, and publication state.

## Design problems

### 1. Translation has no durable lifecycle — fundamental

Why the current design is wrong:

`generate` translates only source pages that pass during that invocation ([generate.ts:235–251](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:235)). `refresh` and `refine` replace source artifacts without running the translation stage ([maintain.ts:275–345](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:275), [refine.ts:223–247](/C:/Projects/docstube/packages/core/src/pipeline/refine.ts:223)). Therefore a successful source maintenance operation can immediately make every target locale stale while still reporting those locale artifacts as current.

The manifest cannot represent this. A localized shard has a commit, timestamp, entity tree, and flags, but no source-content revision, desired revision, freshness state, or distinction between a failed candidate and the last published translation ([manifest-schema.ts:62–71](/C:/Projects/docstube/packages/contracts/src/manifest-schema.ts:62)).

Failure handling makes that omission dangerous. When translation never aligns, `translateArtifact` constructs a target-locale shard from the source artifact ([translate-page.ts:214–253](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:214)), while `generate` deliberately does not write target MDX ([generate.ts:243–249](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:243)). Site assembly later treats shard and MDX as independently optional and reads any MDX already on disk ([emit-current-site.ts:62–75](/C:/Projects/docstube/apps/cli/src/commands/emit-current-site.ts:62)). After a formerly successful translation fails regeneration, the site can therefore pair a new fallback/source shard with an old translated body. This is not merely a missing retry; publication state is not atomic.

Concrete better design:

Introduce a committed localization record per `version × locale × pageId`:

- `desiredSourceRevision`: hash of the canonical translatable entity tree.
- `translationInputHash`: source revision plus locale, terminology, translation instructions, task schema, and component-localization rules.
- `status`: `absent | pending | ready | stale | failed`.
- `published`: optional complete artifact containing translated page metadata, MDX content hash/path, source revision, and verification revision.
- `lastAttempt`: findings and run identity, without masquerading as published content.

The lifecycle should be:

`absent → pending → ready`; source or translation-input change causes `ready → stale → pending`; failure causes `pending → failed`; locale removal causes `retired → pruned`. A last-known-good translation may remain available for diagnostics, but must not be selected for the current route once its source revision is stale.

All source-mutating commands must invoke the same localization scheduler:

- `generate`: enqueue every missing or invalid target.
- `refresh`: enqueue target artifacts for regenerated source pages, plus previously failed translations even when the source did not change.
- `refine`: enqueue targets only when the resulting canonical translation input changed.
- Locale addition: enqueue every current-version page.
- Translation glossary/instruction changes: invalidate affected locales without regenerating source content.
- Cost freeze: leave explicit `pending`/`stale` state rather than an apparently complete locale.

A candidate becomes `published` only when its MDX, aligned entities, verification results, and state record can be promoted together.

Cost now versus after 0.1.0:

Now, this is a substantial but contained rewrite of private contracts, run journaling, orchestration, and assembly. After release, it requires migrations for committed manifests and generated sites, while users may already have merged stale localized content under the L4 accuracy claim. The reputational cost would exceed the implementation cost.

### 2. “Verified translation” currently has no translation verification — fundamental

Why the current design is wrong:

The source pipeline performs deterministic verification, persona review, claim extraction, and grounding ([page-runner.ts:162–239](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:162)). Translation performs none of the semantic stages. It checks structural alignment and page-level verifiers, explicitly excluding site scope ([translate-page.ts:179–207](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:179)).

When prose changes, the translated block is assigned `scored`, its claims are deleted, and source provenance is copied unchanged ([translate-page.ts:72–80](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:72)). That conflicts with the architecture contract that `scored` means criteria-based AI review ([ARCHITECTURE.md:165–166](/C:/Projects/docstube/ARCHITECTURE.md:165)). It also breaks the same-entity-across-locales model at the claim level: block IDs survive, but translated claims disappear.

MDX compilation, entity integrity, and prose linting can establish hygiene. They cannot detect mistranslated negation, changed defaults, omitted caveats, invented claims, or incorrect terminology. Calling this “verified translations,” as PRODUCT does ([PRODUCT.md:211](/C:/Projects/docstube/PRODUCT.md:211)), overstates the guarantee.

Concrete better design:

Translate structured entity fields rather than whole MDX. Extract translatable units keyed by stable entity and field IDs—headings, paragraphs, list items, table cells, descriptions, and explicitly localizable component props. Keep code, identifiers, paths, URLs, component structure, and non-localizable props out of the model output. Reassemble MDX deterministically.

The component registry should declare which props are:

- invariant,
- translatable text,
- locale-formatted data,
- or unsupported for localization.

Then add a bilingual fidelity review that compares source and target entities for semantic equivalence, omissions/additions, terminology, and audience preservation. Retry the translation with its previous draft and concrete findings.

Localized claims should retain the source claim IDs, with translated text and anchors plus explicit `translatedFrom` provenance tied to the source revision. A translation that cannot align claims should fail fidelity review rather than silently deleting them.

Do not overload the existing guarantee into pretending translation fidelity is deterministic. Store two dimensions:

- Source content guarantee: `proven | scored | out-of-domain`.
- Localization assurance: `reviewed | unreviewed | stale | failed`, with reviewer criteria and source revision.

Render the honest composite, for example “Proven source · translation reviewed.” A localized page should not simply display “proven” when the semantic equivalence step is only scored.

Cost now versus after 0.1.0:

Now, the main costs are new localization contracts, one structured task and reviewer task, claim alignment, component metadata, and proof UI changes. After release, changing badge semantics and localized entity/provenance schemas becomes a public trust and compatibility break, particularly because the verified-claims metric may already have counted localized pages incorrectly.

### 3. Verifier scoping is not actually per locale — fundamental

Why the current design is wrong:

The architecture reduces i18n verification to `source-only | per-locale` ([ARCHITECTURE.md:415](/C:/Projects/docstube/ARCHITECTURE.md:415)), but the execution model does not define an isolated locale site graph.

Translation invokes verifiers with one page and `includeSiteScope: false` ([translate-page.ts:198–206](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:198)). The later generation topology pass receives only source artifacts ([generate.ts:266–275](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:266)); refresh reconstructs only the source locale before its site pass ([maintain.ts:374–385](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:374)).

Even if all locales were supplied together, `runVerifiers` sends every artifact to a `per-locale` verifier without partitioning by locale ([verify-page.ts:121–149](/C:/Projects/docstube/packages/core/src/pipeline/verify-page.ts:121)). A site verifier such as internal links builds one union of all supplied slugs ([internal-links.ts:46–53](/C:/Projects/docstube/packages/verifiers/src/internal-links.ts:46)). That can allow a page in one locale to satisfy a missing page in another.

Concrete better design:

Replace ad hoc filtering with a verification planner:

- Source-only checks run once for a source revision.
- Page/block locale checks run against one localized artifact.
- Site checks run separately for every `version × locale` publishable route graph.
- Cross-locale checks validate coverage records, alternates, `hreflang`, ID alignment, and fallback rules.

The plugin contract needs an explicit cross-locale mode rather than stretching `per-locale`; for example `localeScope: source | locale | cross-locale`. Locale site verifiers should receive a resolved route manifest, including which routes are translated versus source fallbacks, rather than infer availability from a loose artifact array.

Site findings must be attached to the correct version-and-locale address and participate in that locale’s publication gate.

Cost now versus after 0.1.0:

Now, this is a moderate verifier-runner and plugin-contract change. After release, `@docstube/plugin-sdk` becomes the expensive part: third-party verifiers may already depend on the incorrect meaning of `per-locale`, forcing compatibility shims or an API-version break.

### 4. There is no reader contract for a partial locale — significant

Why the current design is ineffective:

As soon as one page exists for a locale, `buildNavByLocale` constructs that locale’s navigation from every page in the global index ([emit-site.ts:128–146](/C:/Projects/docstube/packages/theme/src/emit-site.ts:128)). Emission creates target routes only for translations actually supplied ([emit-site.ts:556–562](/C:/Projects/docstube/packages/theme/src/emit-site.ts:556)). The resulting locale nav therefore advertises routes that may not exist.

A locale with no available translations instead falls back to the source nav ([DocLayout.astro:29–34](/C:/Projects/docstube/packages/theme/src/themes/basic/site/layouts/DocLayout.astro:29)), while the locale switcher is page-specific. Readers receive inconsistent signals: a locale can appear on one page, disappear on another, and contain navigation to 404s.

Concrete better design:

Generate a resolved availability and route table from localization records. The default partial-site behavior should be:

- `ready`: serve the verified target translation.
- `missing`, `pending`, `stale`, or `failed`: serve the current source page as an explicit fallback under the locale route.
- Show a prominent “This page is not currently available in German; showing English source” notice.
- Mark the article content with the source language.
- Canonicalize to the source route, omit target `hreflang`, and exclude fallback pages from localized search and sitemap claims.
- Never serve a stale translation as if it were current.
- Build navigation from the resolved route table so every link works; fallback entries should be visibly marked with their content language.

Expose locale coverage in the dashboard and generated site metadata: for example “42/50 pages translated, 5 pending, 3 failed.” That makes partial output an intentional state rather than an accidental collection of files.

Cost now versus after 0.1.0:

Now, this primarily affects the emitter, theme data contract, SEO metadata, and tests. After release, broken or mixed-language routes may already be indexed, linked externally, and treated as stable URLs. Correcting them then becomes both a migration and an SEO cleanup.

### 5. Version snapshots do not define locale semantics — significant

Why the current design is ineffective:

The current snapshot operation copies whichever locale shards happen to exist and silently skips missing ones ([version-cut.ts:30–52](/C:/Projects/docstube/packages/core/src/state/version-cut.ts:30)). It does not snapshot MDX content or a per-version page/locale availability index. Site emission explicitly treats frozen versions as labels whose content is deferred ([emit-site.ts:42–48](/C:/Projects/docstube/packages/theme/src/emit-site.ts:42)), while themes still render links to those routes ([DocLayout.astro:85–94](/C:/Projects/docstube/packages/theme/src/themes/basic/site/layouts/DocLayout.astro:85)).

Consequently, the system cannot answer whether a frozen version owns the locale set from cut time, follows current config, contains a partial translation, or should be repaired from old source versus HEAD.

Concrete better design:

A version cut should freeze one complete published-site revision:

- Its own page index.
- Its own declared locale set.
- Per-page localization states.
- Exact source and translated MDX hashes/content.
- Verification and translation-assurance revisions.
- Its resolved route table.

`refresh` and ordinary `refine` should affect only the current version. Adding or removing a current target locale must not mutate historical snapshots.

A frozen translation repair should translate from that snapshot’s canonical MDX and provenance, not from current HEAD. It should be an explicit operation that creates a new revision of the frozen snapshot. Version and locale switchers should resolve the same logical `pageId` and preserve the other dimension where available; otherwise they should land on the explicit source fallback.

Cost now versus after 0.1.0:

Now, frozen version emission is already incomplete, so the route and snapshot format can still be defined coherently. After release, version URLs, snapshot manifests, and the meaning of “frozen” become compatibility promises; retrofitting locale ownership then is much more expensive.

### 6. Locale reconciliation and site emission are append-only — significant

Why the current design is wrong:

Both generation and refresh prune orphan page IDs only inside the newly configured locale list ([generate.ts:320–324](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:320), [maintain.ts:459–463](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:459)). A removed locale is no longer traversed, so its shards survive.

The emitter writes the desired source and translation files but has no corresponding content cleanup phase ([emit-site.ts:521–578](/C:/Projects/docstube/packages/theme/src/emit-site.ts:521)). Old locale routes can remain in `src/pages`, be built by Astro, and be indexed by Pagefind even after the locale disappears from config.

Concrete better design:

Make site assembly a desired-state materializer:

- Preserve the previous manifest until reconciliation computes removed locales and routes.
- Track kernel-owned content files separately from user-modifiable theme files.
- Delete managed current-version shards, route MDX, raw Markdown mirrors, search inputs, and generated metadata that are absent from the new address graph.
- Prefer emission into a staging tree followed by promotion, or use a managed-file inventory with atomic replacement.
- Never prune frozen-version content through current-locale reconciliation.
- Optionally emit temporary redirects from removed current-locale URLs to source pages, but do not leave stale content behind.

Cost now versus after 0.1.0:

Now, this is a bounded state-store and emitter change. After release, safe pruning must account for user modifications and previously generated layouts from multiple docstube versions, making ownership detection and migration substantially harder.

## Effectiveness and UX

- Whole-document MDX translation spends tokens reproducing code, component syntax, and structure that must remain unchanged. Entity-field translation would reduce input/output volume and make structural corruption impossible by construction.

- The two translation attempts receive no prior findings or prior candidate draft; the second attempt is effectively the same request after a deterministic failure ([translate-page.ts:151–189](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:151)). This spends money without adding corrective information.

- Target locales run serially ([translate-page.ts:147–256](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:147)). Once source verification passes, independent locales should use bounded concurrency while respecting the shared freeze budget.

- The translator receives only source locale, target locale, slug, and MDX ([translate-page.ts:28–42](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:28)). It receives neither glossary nor durable writing instructions, so terminology feedback cannot reliably improve future translations.

- Code that is byte-identical across locales should inherit source-only checks by source revision. Re-running any code-oriented “per-locale” verifier over identical samples wastes time and blurs what was actually verified.

- Translation task events identify the source page but do not make version/locale/revision a first-class job identity. The dashboard and resume mechanism therefore cannot clearly distinguish “German pending,” “French failed,” and “German stale.”

- Missing MDX is silently skipped during site assembly. That converts state corruption into an apparently successful but incomplete build instead of a controlled fallback or a blocking invariant failure.

- Stale emitted route files can still be indexed by Pagefind even when the regenerated sitemap omits them. Readers may find removed or outdated localized pages through search.

## What is genuinely good

- Stable logical entity IDs with version and locale as address dimensions should remain the foundation.

- Source-locale truth and byte-identical invariant blocks are the correct basis for inheriting expensive source proofs.

- Per-page, per-locale committed state is the right merge granularity, provided it represents complete publication state rather than failed candidates.

## Open questions for the founder

1. Should partial locales publish page-level source fallbacks with explicit warnings, or should a locale remain entirely hidden until every page is ready?

2. Should a stale last-known-good translation ever be reader-accessible with a warning, or must current routes always fall back to the fresh source page?

3. Is one bilingual fidelity reviewer per page/locale sufficient while inheriting source persona reviews, or must every persona review rerun in every locale?

4. Should the public proof UI show two dimensions—source guarantee and translation assurance—or collapse them into one conservative guarantee level?

5. May a version be frozen while some declared locales use explicit source fallbacks, or must version cutting block until all translations are ready?

6. Are frozen-version translations immutable except for an explicit snapshot repair, or may normal locale/config changes update them?

7. When a locale is removed from current config, should it disappear only from the current version while remaining in frozen versions, or be purged from all versions?

8. Should changing the source locale require a fresh/migration workflow, or may an existing target locale be promoted in place with its translated entities becoming canonical?
