## Design problems

**Release verdict:** do not ship 0.1.0 with the current “actual L4” positioning or default auto-merge. Either delay it until the five release gates below exist, or label it an experimental preview whose output requires review.

0.1.0 must not ship without:

- One authoritative specification and an honest, executable support matrix.
- A declared assurance domain that determines which runs qualify as autonomous.
- A first-class claim ledger with coverage enforcement and predicate-level evidence.
- Transactional generation: failed, frozen, or incomplete runs cannot alter published output.
- End-to-end release evidence using planted defects, code changes, and real model runs—not keyword fixtures.

### 1. The source of truth has forked — fundamental

**Why:** `PRODUCT.md` and `ARCHITECTURE.md` are declared authoritative, but three newer documents also call themselves binding while contradicting them. Trust v2 replaces `proven/scored/out-of-domain`; pipeline v2 removes `refresh`; release-scope v2 cuts versions; harness-state v2 changes manifest and claim behavior. Meanwhile, `PRODUCT.md` still says versions, i18n, and Java ship in v1 because “coding is cheap,” and `ARCHITECTURE.md` still describes the old guarantee and pipeline models. A contributor can faithfully follow the designated source of truth and build the wrong product. [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:3), [trust-model-v2.md](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:1), [pipeline-v2.md](/C:/Projects/docstube/knowledge/design/pipeline-v2.md:1), [release-scope-v2.md](/C:/Projects/docstube/knowledge/design/release-scope-v2.md:1)

**Better design:** fold every binding v2 decision into `PRODUCT.md` and `ARCHITECTURE.md` before further implementation. Retain the v2 files as decision records, not parallel specifications. Add a small release support matrix derived from actual registered language packs, content sources, verifiers, and transports; use it in the website, wizard, `doctor`, and Action validation. “Designed,” “experimental,” and “supported in 0.1” must be separate states.

**Cost:** now, this is primarily editorial consolidation plus a bounded contract migration. After 0.1.0, every contradiction becomes either a broken public promise or a compatibility obligation.

### 2. “L4 autonomous within a declared domain” is not an executable contract — fundamental

**Why:** the product’s category-defining claim is that every claim is proved or flagged and no human gate is required. But “declared domain” is not represented as an assurance boundary. The config exposes an `autonomy` block that is currently reserved/ignored and uses the obsolete guarantee vocabulary. It does not declare supported claim types, required checkers, source completeness, environment requirements, or publication policy. [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:14), [config-schema.ts](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:129)

The newer pipeline decision makes claims without a checker non-blocking. That may be a sensible availability policy, but it means absence of flags is not evidence of L4 completeness. System failures, structural changes, coverage failures, unanswered questions, and unsupported inputs also require attention, contradicting the simpler claim that human attention is confined to out-of-domain knowledge. [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:87), [pipeline-v2.md](/C:/Projects/docstube/knowledge/design/pipeline-v2.md:58)

There is also no metric for the defining outcome: how often a code change reaches correct published documentation without human intervention. The public metric is defects per 100 claims, while flag/intervention rate was explicitly removed. That makes the L4 claim unmeasurable. [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:292)

**Better design:** introduce a versioned `AssuranceProfile` created during initialization and frozen into every run:

- Supported languages, source providers, repo roots, and artifact types.
- Claim classes and the accepted evidence/checker for each.
- Required environment capabilities.
- Completeness rules for the claim ledger and source extraction.
- Publication rules for unchecked, owner-attested, contradictory, and structurally invalid content.

A run is “L4-qualified” only when it completes against that profile with complete extraction coverage, permitted evidence for every in-domain claim, no contradiction, and an atomic publish. Everything else is explicitly “partial” or “assisted”—not retroactively treated as L4 because the pipeline finished.

Measure autonomous completion rate, human interventions per 100 changes, verified-claim coverage, maintenance latency, and cost per changed page.

**Cost:** meaningful schema, wizard, Action-gating, and UI work now. After launch, redefining L4 will look like walking back the central company claim.

### 3. The proof architecture cannot represent what the product promises — fundamental

**Why:** the current writer produces MDX, not MDX plus a claim ledger. Claims are extracted afterward by a separate model task; unanchored claims are dropped, and the resulting schema carries a broad guarantee state rather than a checkable predicate. A passing verifier can effectively prove an entity without proving the specific value or behavior asserted by a claim. [write-page.ts](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:50), [claims-stage.ts](/C:/Projects/docstube/packages/core/src/pipeline/claims-stage.ts:119), [entity-schema.ts](/C:/Projects/docstube/packages/contracts/src/entity-schema.ts:44), [verify-stage.ts](/C:/Projects/docstube/packages/core/src/pipeline/verify-stage.ts:173)

The source model is equally insufficient. `SymbolRecord` is a flat identity/signature record with neither typed API facts nor relations. TypeScript extraction is explicitly not TypeDoc-level semantic extraction, Python uses the standard AST rather than griffe, Java is absent, and builtin loading does not register the promised OpenAPI/importer truth sources. D2 can therefore compile syntax and fuzzy-match node names, but it cannot ground edges or behavioral relationships. [symbol-schema.ts](/C:/Projects/docstube/packages/contracts/src/symbol-schema.ts:26), [extract-symbols.ts](/C:/Projects/docstube/packages/lang-typescript/src/extract-symbols.ts:6), [load-plugins.ts](/C:/Projects/docstube/packages/core/src/plugins/load-plugins.ts:12), [diagram-d2.ts](/C:/Projects/docstube/packages/verifiers/src/diagram-d2.ts:173)

Trust-model v2 identifies the correct direction—writer-emitted claims, evidence obligations, and full ledger coverage—but this has not reached the long-lived contracts. [trust-model-v2.md](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:9)

**Better design:**

1. Make one writer task return an atomic `PageArtifact { mdx, claims }`.
2. Give each claim a normalized predicate, entity/revision scope, required evidence class, and disposition.
3. Attach checker results to claim predicates, never merely to the enclosing entity.
4. Introduce a typed `TruthIndex` above the codemap: facts, signatures, schemas, values, relationships, and evidence locations. Codemap should own identity/change detection, not pretend to be the whole truth layer.
5. Specify semantic conformance, not TypeDoc/griffe brand names. A full TypeScript `Program` and checker is acceptable if it produces the required facts.
6. In 0.1, describe D2 as syntax-checked rendering. Defer verified edges until the relation graph exists.

**Cost:** high now, but highest after release: this changes persisted manifests, task output, verifier authority, plugin contracts, badges, and generated artifacts. This is the change to make before external plugins or compatibility promises exist.

### 4. Autonomous maintenance is not transaction-safe — fundamental

**Why:** generation persists pages progressively. A budget freeze or late failure can leave earlier pages changed, the manifest partially advanced, and the command still returning a non-failure outcome. The CLI emits a site for flagged/frozen results, while the Action’s merge decision principally keys off open flags rather than proof completeness. [generate.ts](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:198), [generate.ts](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:254), [generate.ts](/C:/Projects/docstube/apps/cli/src/commands/generate.ts:54), [merge-decision.ts](/C:/Projects/docstube/apps/github-action/src/merge-decision.ts:12)

Maintenance also cannot reconcile desired state reliably: new IA pages require switching commands, removed pages are retained, new symbols cannot be routed through backward provenance, and config/IA hashes can be recorded without driving correct invalidation. This is not “always current”; it is partial mutation with optimistic labeling. [maintain.ts](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:367), [design-review-06-pipeline.md](/C:/Projects/docstube/knowledge/design/design-review-06-pipeline.md:65)

**Better design:** implement pipeline v2’s idempotent reconciler as the only public generation operation:

`frozen input snapshot → impact plan → staged candidate → full candidate validation → atomic publish`

Budget exhaustion, unsupported capability, or failed validation must leave the published tree and manifest unchanged. Expose `generate --explain` for affected pages, expected checks, and estimated cost without adding an approval gate. Replace `generate`/`refresh` user semantics with one desired-state command; keep internal planning modes private.

Auto-merge should remain off until this transactional property is proven by tests covering interruption, cap exhaustion, new/deleted pages, changed configuration, and resume.

**Cost:** moderate pipeline and storage work now. After release, fixing it changes CLI behavior and invalidation semantics while users already have partially advanced manifests in repositories.

### 5. The 0.1 scope has no credible wedge — fundamental

**Why:** the public specification spans TypeScript, Python, Java, OpenAPI, four importers, i18n, versions, changelogs, D2 verification, public plugins, multiple transports, screenshots-as-reserved-config, UI review, audit, deploy integrations, and autonomous GitHub updates. The implementation cannot supply authoritative API truth even for the strongest language path, and newer binding notes still preserve a substantial localization subsystem before source-language proof is reliable. [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:112), [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:218), [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:223), [i18n-lifecycle-v2.md](/C:/Projects/docstube/knowledge/design/i18n-lifecycle-v2.md:1)

This breadth is especially damaging because docstube’s differentiator is assurance. A mediocre unsupported language is not an extra feature; it falsifies the brand.

**Better design:** make 0.1 a narrow TypeScript/JavaScript repository product:

- Current repository state only; one source locale.
- Compiler-semantic TypeScript truth.
- Local generated site plus GitHub Action.
- One writer, one claim ledger, a small set of trustworthy checkers.
- Pure MDX, executable code snippets, path/link checks, and D2 syntax rendering.
- Internal plugin boundaries retained, but no public plugin compatibility promise yet.

Cut entirely from v1: Python, Java, versions, translations, migration importers, screenshots, behavioral D2 edge verification, changelog generation, external plugin publication, deploy integrations, and Gemini support.

OpenAPI should be a founder-level wedge decision: either make it a release-blocking first-class truth provider and target API products, or cut it from 0.1. Do not leave it as an advertised configuration surface without a working data path.

Remove the opaque `screenshots` config field. “Reserved unknown object” provides no compatibility benefit and creates a fake affordance. Add a typed capture contract later when viewport, state, authentication, redaction, provenance, and refresh semantics exist. [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:156), [config-schema.ts](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:174)

**Cost:** mainly deletion, copy correction, and hiding unsupported paths now. After public release, each advertised surface attracts the wrong users and becomes an implicit roadmap obligation.

### 6. The audit metric is not an accuracy metric — significant

**Why:** audit extracts at most 30 claims per page, then primarily checks whether referenced identifiers exist. A claim becomes “grounded” if any candidate identifier matches; it is generally a defect only when all candidates are absent. That cannot distinguish a correct behavioral statement from a confidently false one about an existing symbol. Invalid extraction can yield zero claims, which improves the denominator instead of failing coverage. [extract-claims.ts](/C:/Projects/docstube/packages/core/src/audit/extract-claims.ts:11), [match-claims.ts](/C:/Projects/docstube/packages/core/src/audit/match-claims.ts:148)

The dogfood runner provides an extractor returning zero claims, so it does not exercise the advertised trust property. The CLI nevertheless calls the output “verified defects per 100 claims.” [dogfood-build.ts](/C:/Projects/docstube/scripts/dogfood-build.ts:40), [audit.ts](/C:/Projects/docstube/apps/cli/src/commands/audit.ts:51)

**Better design:** for 0.1, rename this to **stale public-reference rate** and report:

- Pages scanned.
- Claims attempted and successfully extracted.
- Public identifiers checked.
- Missing/renamed identifiers.
- Unchecked behavioral claims, explicitly excluded from the accuracy denominator.

Do not market it as overall documentation accuracy or use it for competitive comparisons. Later, behavioral accuracy can be added only through claim predicates and domain-specific checkers.

**Cost:** small now. After publishing “defects per 100 claims,” correcting the methodology will look like a retraction.

### 7. The trust vocabulary is an ontology collision — significant

**Why:** there are twelve trust-adjacent labels across current contracts and binding designs: `proven`, `scored`, `out-of-domain`, `verified`, `reviewed`, `unverified`, `grounded`, `unverifiable`, `defect`, `checked`, `source-linked`, and `flagged`. The theme maps `proven` to “verified” and `scored` to “reviewed,” even though persona review is a separate process. Audit uses “grounded” for identifier existence, while v2 proposes “checked.” [provenance-schema.ts](/C:/Projects/docstube/packages/contracts/src/provenance-schema.ts:11), [proof-source.ts](/C:/Projects/docstube/packages/theme/src/proof-source.ts:8), [trust-model-v2.md](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:15)

Users cannot tell whether “reviewed” means an AI judged the writing, a source supports the claim, a deterministic checker passed, or a page is eligible to publish.

**Better design:** use three orthogonal axes:

- **Correctness:** `checked | unchecked | contradicted`, with evidence kind shown separately: source, execution, schema, or owner attestation.
- **Editorial:** `reviewed | not reviewed | issues found`.
- **Workflow:** `publishable | attention needed | blocked`.

Reserve **Verified** for the page/run aggregate that satisfies its published assurance profile. Keep “grounded” as an internal evidence relation and “flag” as a workflow task—not trust grades. Remove `proven`, `scored`, and `out-of-domain` from public surfaces.

**Cost:** modest now, involving schema migration and UI/copy cleanup. After release, these terms become persisted API values, badge semantics, and user expectations.

### 8. Feedback is prompt accumulation, not a closed learning loop — significant

**Why:** the product promises categorization into criteria, instructions, glossary, or config, immediate targeted regeneration, and durable shared learning. The implementation only supports the first three categories; glossary notes are written to a directory the normal context loader does not read; the UI’s regenerate action starts a whole refine run. [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:162), [feedback.ts](/C:/Projects/docstube/packages/core/src/server/feedback.ts:13), [context-files.ts](/C:/Projects/docstube/packages/core/src/pipeline/context-files.ts:28), [review.tsx](/C:/Projects/docstube/apps/local-ui/src/review.tsx:218)

More importantly, model-classifying a local comment into a project-global instruction is dangerous. “Use less detail here” can silently become a permanent instruction applied to every future page. Adding the missing `config` category would make this worse by allowing prose feedback to mutate product intent.

**Better design:** store every feedback item as an immutable, entity-and-revision-scoped record. Its default effect is one targeted repair. Promotion to a global criterion, writing instruction, or glossary term must be an explicit user action. Config feedback should become a structured proposed diff requiring confirmation, never an automatic model-authored mutation. Answering a flag should resume the affected page/run immediately.

**Cost:** moderate due to targeted-run and feedback-state work. After release, repositories will accumulate opaque prompt files whose origin, scope, and continuing applicability are impossible to audit.

### 9. Privacy and transport claims undermine the trust story — significant

**Why:** `PRODUCT.md` carefully promises that docstube’s servers do not receive source. The website also says “your source never leaves your machine,” which is false when a remote Claude, OpenAI, Anthropic, or compatible provider receives prompt context. The same website advertises Gemini while the product specification keeps Google transport experimental and out of public v1. [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:125), [site.ts](/C:/Projects/docstube/apps/web/src/data/site.ts:27), [site.ts](/C:/Projects/docstube/apps/web/src/data/site.ts:144)

**Better design:** standardize one precise privacy statement: “docstube does not receive your source; the AI provider you configure receives the context required for generation.” Show a transport data-flow table covering subprocess/API destination, credentials, persisted transcripts, cache, and local-model mode. Generate the displayed transport list from the same registry used by the CLI.

**Cost:** trivial copy and registry work now. After release, this becomes a credibility and potentially legal problem.

## Effectiveness and UX

- The current economics are release-blocking, not merely optimizable. A six-page dogfood run took 43.1 minutes and approximately 5.46 million input tokens across 56 task calls. It is not a benchmark, but it disproves scale readiness. [design-review-06-pipeline.md](/C:/Projects/docstube/knowledge/design/design-review-06-pipeline.md:181)

- Every writer receives up to the first 200 symbols rather than a page-specific evidence pack. That wastes tokens while encouraging broad, imprecise provenance. Harness-state v2’s `PageContextPack` is the right replacement and should precede more agents or languages. [write-page.ts](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:24), [harness-state-v2.md](/C:/Projects/docstube/knowledge/design/harness-state-v2.md:19)

- Writing, post-hoc claim extraction, verification, and persona review create multiple model interpretations of the same page. Writer-emitted claims remove one full call and prevent extraction drift. A primary persona per page should replace review by every persona unless a page explicitly targets several audiences.

- Fine-grained entity IDs currently save little money because regeneration is page-wide. The UI’s “Regenerate” button launching a full refine run makes the scope invisible to users. Show the affected page/entity set and estimated task budget before execution without requiring approval.

- The “waiting room is the review room” UI is not yet a production preview. Showing a structural approximation beside proof language will cause users to approve content whose final rendering they have not seen. Until the actual Astro renderer is embedded, label it source preview—not production preview.

- Flags are an undifferentiated queue containing owner questions, unsupported-domain claims, system failures, coverage gaps, and structural changes. Group attention items by required actor and action: answer, fix environment, expand scope, accept attestation, or retry system failure.

- Accepted-but-ignored config such as `autonomy` and `screenshots` is worse UX than omission. It tells sophisticated users they have control when they do not.

- Removing “dry run” entirely was too broad. An automatic non-generative impact explanation—affected pages, required checkers, missing capabilities, and expected cost—is valuable for an expensive autonomous operation and does not introduce a human shipping gate.

## What is genuinely good

- The v2 split between claim evidence, editorial review, and workflow disposition is the correct conceptual core and must survive.

- Stable page/entity identity plus committed, branch-local manifest state is the right foundation for incremental, reviewable maintenance.

- Owning the agent loop and observed-read provenance while treating vendor CLIs as transports is a strategically strong boundary.

## Open questions for the founder

1. Is 0.1.0 a **TypeScript/JavaScript documentation wedge**, or an **API-product wedge with OpenAPI as a release blocker**? It cannot credibly be both plus Python and Java.

2. Will docstube stop claiming “actual L4” until an executable conformance suite passes, or delay 0.1.0 until that suite passes? Shipping the claim without the test should not be an option.

3. May a page with unchecked in-domain claims auto-merge as “partial,” or must auto-merge require complete evidence under its assurance profile? I recommend the latter for 0.1.

4. Is **Verified** reserved for a page-level aggregate with complete evidence, or does the founder want several public trust grades? If several grades remain, their publication semantics need to be specified before release.

5. Should i18n be cut to v1.x, or should 0.1.0 wait for independent source-correctness and translation-fidelity assurance? I recommend cutting it.

6. Should feedback remain entity-scoped unless the user explicitly promotes it, or may the model continue converting local comments directly into global project rules? I recommend explicit promotion.

7. Should audit ship honestly as a stale-reference checker, or be delayed until it can verify behavioral predicates? It should not ship under the current accuracy metric.

8. Is the initial customer building code-first developer documentation without screenshots, or external product documentation where screenshots are essential? Pick one; the current scope implicitly promises both.

No files were modified.
