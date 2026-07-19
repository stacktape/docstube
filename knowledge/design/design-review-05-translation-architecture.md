## Design problems

Verdict: do not harden `translateArtifact` as the long-term architecture. Replace it with a derived-localization subsystem whose cache unit is a translatable block field, whose normal model-call unit is a page-locale batch, and whose assurance/publication unit is the complete page-locale.

| Concern | Correct unit |
|---|---|
| Factual truth and claim checking | Canonical source claim |
| Translation cache and invalidation | Block-derived translatable field |
| Translation model request | Changed fields batched per page-locale |
| Fidelity review and publication | Complete page-locale revision |
| Links, routes, and locale coverage | Version-locale site graph |

Target flow:

`source gate → source topology → localization-plan diff → translate changed fields → deterministic MDX assembly → bilingual fidelity review → locale checks → atomic promotion`

### 1. Translation is not a maintained derived artifact

Severity: fundamental

Why the current design is wrong:

Translation is invoked only from `generate`, immediately after an individual source page passes. The maintenance path replaces source pages without invoking the same translation lifecycle. Adding a locale therefore has no translation-only backfill path; the practical route is to rerun source generation. [`generate.ts`](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:235) [`maintain.ts`](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:324)

The state model cannot express whether German page X translates the current source revision, an earlier revision, or a failed attempt. A target shard records a repository commit and generation time, but not the canonical page revision, localization inputs, candidate state, or published state. [`manifest-schema.ts`](/C:/Projects/docstube/packages/contracts/src/manifest-schema.ts:60)

This makes “always-current” unachievable for declared locales. It is the underlying design error behind the lifecycle cluster already recorded in the previous i18n review—not eight independent bugs. [`design-review-03-i18n.md`](/C:/Projects/docstube/knowledge/design/design-review-03-i18n.md:1)

Concrete better design:

Create a localization scheduler that reconciles desired and published state for every `version × locale × pageId`. A committed localization record should contain:

- `desiredSourceRevision`: hash of the canonical translatable plan and claim ledger.
- `localizationInputHash`: source revision plus target locale, applicable terminology revisions, localization policy version, and component rules.
- `status`: `absent | pending | ready | stale | failed`.
- `published`: the complete target revision—unit translations, assembled MDX hash, source revision, fidelity review, and locale-verification revision.
- `lastAttempt`: candidate hash, findings, run ID, and failure classification.

Every source-mutating command calls this scheduler. Adding a locale automatically backfills from committed source artifacts without rerunning writers, persona reviewers, source verifiers, or claim checking. Glossary-only changes invalidate localization work without regenerating the source.

Cost of changing now versus after 0.1.0:

Now, this is a substantial but contained rewrite of private contracts, orchestration, and manifests. After release, it becomes a migration of committed shards and generated routes—and users may already have merged stale translations under the “verified, always-current” claim.

### 2. Whole-page MDX is the wrong translation contract

Severity: fundamental

Why the current design is wrong:

The model is asked to reproduce an entire MDX document while preserving structure, code, components, props, URLs, and identifiers. Correctness therefore depends on prompt obedience followed by positional post-hoc alignment. [`translate-page.ts`](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:15) [`translate-page.ts`](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:49)

This spends tokens regenerating invariant syntax and makes structural validity probabilistic even though strict isomorphism is a kernel rule. It also has no principled treatment for component props: `ComponentDefinition` declares a props schema but not which props are invariant, localizable, locale-formatted, or unsupported. [`hook-types.ts`](/C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:158)

Concrete better design:

Parse canonical MDX plus its claim ledger into a `LocalizationPlan`. Each plan contains ordered, stable units such as:

- Heading text.
- Paragraph or blockquote content.
- Individual list items and table cells.
- Frontmatter title and description.
- Explicitly localizable component props.
- Target claim-anchor mappings for claims contained in the unit.

Each unit should carry `unitId`, owning entity ID, field path, source text hash, placeholder inventory, relevant claim IDs, and contextual metadata. Code, link destinations, inline identifiers, component structure, and invariant props remain outside model output.

The translator returns a structured map such as `{ unitId, targetText, targetClaimAnchors }`. The kernel rejects missing or duplicate units and altered placeholders, then reconstructs MDX from the canonical AST. Structure, code, IDs, ordering, and component syntax are then correct by construction.

Use block-derived fields as the cache unit, but batch all uncached fields from one page-locale into one model call. That preserves page context without creating one call per paragraph. Supply heading ancestry, neighboring source units, page title, and the locale terminology profile as context.

Cost of changing now versus after 0.1.0:

Now, the cost is a localization-plan contract, AST substitution machinery, structured model output, and localization metadata in the component SDK. After release, the existing raw-MDX task, plugin component contract, and localized manifests become compatibility baggage.

### 3. The locale boundary breaks the new trust model

Severity: fundamental

Why the current design is wrong:

The current alignment code deletes claims from normally translated prose, changes its guarantee to `scored`, and copies source provenance onto the target block. That is neither strict isomorphism nor honest evidence modeling. [`translate-page.ts`](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:72)

The binding trust decision now says the writer supplies the complete claim ledger, claims are checked by class, and editorial review is a separate axis from factual correctness. [`trust-model-v2.md`](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:9) [`trust-model-v2.md`](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:30)

A translation is a rendition of already-checked source claims. Re-running code or claim checks cannot detect altered meaning, while relabeling target prose as merely `scored` loses the source proof relationship.

Concrete better design:

Keep one canonical claim ledger in the source locale. A localized rendition must preserve every block and claim ID and provide localized anchors for those same claims. Its evidence should reference the canonical claim evidence at an exact source revision rather than copying or recomputing it.

Record two independent axes:

- Source correctness: checked claim outcomes and evidence.
- Localization assurance: `reviewed | unreviewed | stale | failed`.

Run exactly one bilingual fidelity review per new page-locale revision. It should compare normalized source and target units and report structured findings for meaning changes, omissions, additions, changed negation or quantities, terminology violations, and broken claim anchors. It needs no repository tools because factual checking already happened in the source pipeline.

Persona reviews are inherited from the source. Fidelity review checks that their intended meaning and register survived; it does not repeat one reviewer call per persona.

A failed fidelity review should feed the prior candidate and block-specific findings back to the translator, then rerun the single fidelity review. One correction cycle is a sensible default: normal success costs two calls, persistent failure costs four before fallback.

The reader-facing proof should say, in substance, “12/12 source claims checked · German translation fidelity-reviewed.” It must not collapse both axes into an unqualified `proven`.

Cost of changing now versus after 0.1.0:

Now, this fits naturally into the already-mandated claim-ledger migration. After release, it changes public badge semantics, claim identity across locales, and committed evidence records—the most expensive kind of trust correction.

### 4. Caching and model routing ignore translation economics

Severity: significant

Why the current design is ineffective:

The generic transcript cache hashes the entire task prompt, full MDX, model, and transport. It can reuse an entirely unchanged page, but one changed block invalidates the whole translation output. The cache is also local rather than the durable source of localized freshness. [`agent-task-schema.ts`](/C:/Projects/docstube/packages/contracts/src/agent-task-schema.ts:108) [`ARCHITECTURE.md`](/C:/Projects/docstube/ARCHITECTURE.md:200)

The config already accepts `agents.roles.translator`, but the runner only special-cases `review-page`; `translate-page` uses the primary writer model. [`config-schema.ts`](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:55) [`task-runner.ts`](/C:/Projects/docstube/packages/core/src/pipeline/task-runner.ts:111)

Concrete better design:

Persist translation memory at the unit level. Its freshness key should include:

`source text hash + source/target locale + placeholder shape + relevant glossary-term revisions + localization-policy version`

An unchanged unit must not retranslate merely because another block, repository commit, writer model, or page-level provenance changed. Cross-page matches may be used as draft candidates, but page fidelity review remains mandatory because identical short text can be context-sensitive.

Make role routing operational:

- `write-page` → writer role.
- `translate-units` and `localize-glossary` → translator role.
- Persona reviews and `review-translation-fidelity` → reviewer role.

The default translator should be a transport-specific economy multilingual model. Fidelity review should use the balanced reviewer class and, where available, a different model from the translator to reduce correlated mistakes. For unknown custom endpoints, inherit the explicitly configured model rather than guessing.

The repository’s own pricing table puts the economy models at roughly 2.5–3× lower per-token cost than their balanced counterparts, making the unused role distinction material rather than cosmetic. [`model-pricing.ts`](/C:/Projects/docstube/packages/agent-runtime/src/model-pricing.ts:14)

Cost of changing now versus after 0.1.0:

Now, role-aware transport pools and unit-cache records are moderate changes. After release, users will have written configuration against role fields that currently do nothing, and changing cache invalidation may require regenerating large locale sets once.

### 5. There is no locale-specific terminology authority

Severity: significant

Why the current design is ineffective:

The glossary contains only source terms, definitions, aliases, and avoided source wording. It cannot say that a term must remain English in Japanese, has one preferred German equivalent, or has forbidden localized variants. [`glossary-schema.ts`](/C:/Projects/docstube/packages/contracts/src/glossary-schema.ts:3)

The translation task receives neither the glossary nor durable translation instructions. Independent page calls can therefore choose different equivalents for the same product concept. [`translate-page.ts`](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:28)

Concrete better design:

Introduce a committed locale terminology profile derived from `glossary.yaml`. For each canonical term and locale, record:

- `translate-to` or `keep-source`.
- Allowed variants and inflections.
- Forbidden equivalents.
- Definition/context.
- Origin: AI-derived or user override.
- Profile revision.

When a locale is first added, automatically generate its terminology profile with one locale-level translation call and one locale-level fidelity review. Store this as derived state; user-supplied glossary overrides remain intent and win.

Each page translation receives only the terms relevant to its units plus the global do-not-translate set. Deterministic terminology checks run after assembly, while the bilingual reviewer judges whether the preferred term is semantically appropriate.

A glossary change should invalidate only units that depend on the changed term, followed by fidelity review of their page-locales—not every target page.

Cost of changing now versus after 0.1.0:

Now, this is a moderate glossary/profile schema and verifier change. After release, terminology corrections require mass content churn, and changing the public glossary schema becomes a migration concern.

### 6. Inline serial translation is on the wrong critical path

Severity: significant

Why the current design is ineffective:

`generate` translates immediately after each passing source page, and `translateArtifact` processes target locales serially. Translation spend counts against the same budget before the next canonical page starts, so several locales can freeze source generation partway through the IA. [`generate.ts`](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:215) [`translate-page.ts`](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:147)

Lazy reader-triggered translation would be worse: it is incompatible with an ejected static site, reproducible manifests, pre-publication verification, and predictable costs.

Concrete better design:

Use a separate batched localization phase after the canonical source set and source topology checks complete:

1. Finish canonical source generation and proof first.
2. Diff localization plans against published target units.
3. Bootstrap missing locale terminology profiles.
4. Run page-locale jobs with bounded concurrency, preferably grouped by locale for prompt-prefix reuse.
5. Perform fidelity and locale-site verification.
6. Promote complete candidates atomically.

Localized pages can still stream into the dashboard during this phase. A translation budget freeze leaves explicit `pending` or `stale` jobs and never prevents canonical source pages from completing.

New-locale backfill enters directly at step 2 using the committed canonical pages. It is automatic pipeline work, not a separate human-managed translation project.

Cost of changing now versus after 0.1.0:

Now, this requires a localization job type, locale-aware journal events, and budget partitioning. After release, run timelines, resume behavior, and user expectations will already encode the inline sequence.

### 7. Failure has the wrong artifact and the wrong blast radius

Severity: significant

Why the current design is wrong:

After repeated structural failure, the current translator constructs a target-locale shard around the untranslated source artifact. The caller persists the shard but not the candidate MDX. This does not represent a coherent localized publication; it represents an attempt and a fallback using the same artifact contract. [`translate-page.ts`](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:214) [`generate.ts`](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:241)

Assembly then infers availability by independently finding a shard and MDX, instead of consuming an explicit route-resolution state. [`emit-current-site.ts`](/C:/Projects/docstube/apps/cli/src/commands/emit-current-site.ts:62)

Under the current auto-merge rule, any system flag can also prevent a fresh source correction from shipping because one translation failed. [`PRODUCT.md`](/C:/Projects/docstube/PRODUCT.md:89)

Concrete better design:

Separate candidate, published rendition, and route fallback.

For a failed page-locale:

- Do not publish a stale or failed target candidate.
- Keep the failed candidate only in `lastAttempt` for correction and diagnostics.
- Serve the current verified source under the locale route with an explicit language-fallback banner.
- Omit target `hreflang`, localized-search indexing, and localized-content claims for that route.
- Keep the rest of the locale available and report coverage such as “49 ready · 1 failed.”
- Treat this as a nonblocking localization-coverage finding because the served content is fresh and explicitly labeled—not a correctness defect that blocks source updates.

Distinguish transient transport errors from persistent semantic failures. Transient jobs resume with backoff. After the bounded correction cycle fails for the same input hash, dead-letter the job and do not spend money retrying it on every unrelated refresh; retry when its content, glossary, policy, or model changes, or when explicitly requested.

Cost of changing now versus after 0.1.0:

Now, this is a moderate publication-state and route-resolver change. After release, stale locale URLs can become indexed and externally linked, while changing whether translation failures block auto-merge becomes a visible product-policy reversal.

### Recommended cost model

Assume `P` source pages and `L` target locales.

| Situation | Translation calls | Fidelity calls | Total per page-locale |
|---|---:|---:|---:|
| Initial generation | 1 | 1 | 2 |
| Unchanged refresh | 0 | 0 | 0 |
| Refresh with one or more changed translatable units | 1 batched call | 1 | 2 |
| One failed fidelity correction cycle | +1 | +1 | 4 maximum |
| New-locale backfill | 1 | 1 | 2 |

Terminology bootstrap adds two one-time calls per new locale—one generation and one review—not two calls per page.

For a representative project with 100 pages and three target locales:

- Initial localization: `100 × 3 × 2 = 600` model calls.
- Refresh changing five pages: `5 × 3 × 2 = 30` calls, a 95% call reduction versus revisiting every page-locale.
- If only 10% of the blocks in those pages changed, translation generation processes 0.5% of the corpus per locale: 99.5% less translation text than a full-locale rebuild and 90% less than whole-page invalidation of those five pages.
- Fidelity still examines five complete page-locales. Assuming translation and fidelity each cost roughly one page-sized payload, total localization tokens are approximately 45% lower than whole-page invalidation of the same five pages and 97.25% lower than a complete locale rebuild.
- A code-only change that leaves translatable units and claim wording unchanged costs zero localization calls; only the canonical claim evidence reference changes.

This architecture gets block-level savings without block-level call explosion.

## Effectiveness and UX

- The current `translator` role is a false affordance: users can configure it, but translation still bills the writer model.

- Whole-page translation sends and regenerates code, MDX syntax, and component scaffolding that the output is forbidden to change.

- The existing second translation attempt is a rerun rather than a correction: it does not receive the failed candidate and concrete findings.

- Inline locale work increases time-to-source-completion and can consume the budget intended for canonical documentation.

- A new locale should appear as an automatic backfill run with “0/100 ready” progress, not force users to regenerate already-verified source content.

- The dashboard needs page-locale job identities and explicit `pending`, `stale`, `failed`, and `source fallback` states. A page-level “passed” status is insufficient.

- Translation feedback should target either a locale rendition or the canonical concept. Locale wording corrections should update terminology or locale instructions without perturbing source prose.

- The PR summary should distinguish source-proof changes from localization changes: “2 source claims changed · 6 German units retranslated · 2 German pages fidelity-reviewed.”

- Reader-facing proof must not imply that an AI fidelity judgment is a deterministic proof. Source correctness and translation assurance answer different questions.

## What is genuinely good

- Source locale as the single factual truth must remain non-negotiable.

- Shared logical IDs and byte-identical invariant blocks are the right foundation for strict rendition isomorphism.

- Per-page, per-locale committed shards are the correct merge granularity once they represent complete publication state.

## Open questions for the founder

1. Should an incomplete locale remain available with explicit fresh-source page fallbacks, or stay entirely hidden until every page is translated?

2. When a fresh source fallback is served, should localization failure be nonblocking for auto-merge, or should any declared-locale coverage loss block the entire documentation update?

3. Should the public proof UI show separate “source claims checked” and “translation fidelity-reviewed” dimensions, or collapse them into one conservative status?

4. Must fidelity review use a different model or model family from translation, or may the same model self-review with that limitation recorded?

5. When a new locale is added, should docstube backfill only the current version, or also translate every frozen version automatically?

6. Should AI-derived locale terminology be committed automatically with optional user overrides, or should locale glossary entries remain ephemeral until a user explicitly accepts them?
