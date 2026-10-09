> _Historical research artifact (2026-07). Evidence base for PRODUCT.md. Where any recommendation here conflicts with PRODUCT.md, PRODUCT.md wins (e.g. dry-run, rollback, and flag-rate telemetry were later dropped; the review-UI reframing and several tier placements were adjusted)._

# Revised, Research-Backed Feature Plan for docstube (L4 Lens)

## (1) TL;DR — Highest-Conviction Changes under the L4 Lens

1. **Incremental regeneration is the #1 L4 requirement, not a nice-to-have.** DeepWiki's single biggest gap (deepwiki-open issues #402 and #371; the hosted DeepWiki re-indexes on a schedule; guides warn "the wiki lags the source") is exactly what docstube's symbol-level provenance regeneration solves. V1-core; lead marketing with "freshness proven, not scheduled."
2. **Reframe the Review UI as an Exception-Triage UI.** Under the L4 definition, a page-approval queue is an admission of L3. _(PRODUCT.md resolution: review UI stays the feedback surface; a separate flag queue is the exception-triage surface.)_
3. **`docstube audit` is the wedge — ship it first, standalone, free.** Operationalizes "verified defects per 100 claims" against the human baseline (Tan, Wagner & Treude, arXiv:2212.01479: 28.9% of the top-1000 most-popular GitHub projects contain at least one outdated reference to source code that no longer exists, outdated 4.7 years on average in that dataset).
4. **Ship a local-model (Ollama / OpenAI-compatible) adapter in V1.** deepwiki-open's largest issue volume is local-model friction (#358, #175, #248, #152, #355 "No valid XML found in response" with qwen3/llama3). BYO-AI already implies this; make it explicit and first-class for internal-wiki data residency.
5. **Private-wiki access control is a paid internal-wiki signal.** deepwiki-open's auth is admittedly weak; internal wikis need SSO/ACLs. Architect the contract now; ship in Cloud.
6. **Adopt the automation-trust playbook: dry-run diffs, blast-radius scopes, one-command rollback, signed provenance, audit log.** _(PRODUCT.md resolution: dry-run and rollback dropped; signed provenance = architect-only; scopes = v2 policy engine.)_
7. **Diagrams: default to ELK, dagre fallback, TALA opt-in/Cloud-only.** TALA is proprietary — free only for evaluation (watermark unlicensed), paid Terrastruct Enterprise license required for CI/server — cannot be a default in an MIT tool (D2 core is MPL-2.0). Diagram _correctness_ (verified against the codemap) matters more than layout beauty; that's the real DeepWiki trust-breaker.
8. **Extended deterministic verifiers should include runtime execution in sandboxes.** Doctest-style execution, shellcheck, JSON/YAML schema validation, config-sample validation against Zod/JSON-schema. Every claim promoted from "scored" to "proven" widens the L4 domain. Answers documented distrust (Sonar 2026, n=1,149: 96% don't fully trust AI-generated code is functionally correct).
9. **Publish the Autonomy Ladder + Failure-Mode Registry as living, versioned spec artifacts.** _(PRODUCT.md resolution: ladder public, registry private.)_ The SAE-for-docs frame is not yet claimed for documentation specifically (only adjacent domains — coding agents, QA). The "12-factor / SemVer" success pattern requires a canonical, versioned, vendor-neutral spec page.
10. **De-emphasize llms.txt as a headline; keep as cheap hygiene.** Ahrefs (137,210 domains, June 2026): 97% of valid llms.txt files received zero requests in May 2026; of ~1,100 files with any traffic, AI retrieval bots ~1%, coding agents (Claude-Code, GPTBot) led. Market the MCP server and per-page provenance instead.
11. **Coverage metric vs. codemap is a required L4 proof.** Omission is a declared failure class; you cannot claim autonomous docs without measuring documented fraction of public symbols.
12. **Confidence/guarantee-level per claim must be visible in output.** DeepWiki's line-level citations are its most-praised trust feature; per-claim provenance + guarantee labels are the superior L4-native version.

## (2) DeepWiki-Ecosystem Findings

_Sourcing caveat: GitHub reaction-sorted lists were not fully accessible; ranking inferred from recurrence, not confirmed engagement counts. Only #66 (≈9), #41 (≈3), #45 (≈2) showed visible indicators. Issue existence and verbatim text are reliable._

### Ranked demand list (what L4-docs users want most)

1. **Incremental update / regenerate-on-change** — #402 ("if new commits are made to the repository later, the new commits are not found in the search results… Does it currently support a feature to periodically synchronize and update the index?") and #371 ("Definition of the refresh function" — refresh reuses old code/vectors rather than pulling latest). Hosted DeepWiki re-indexes on a schedule. **→ symbol-level provenance regeneration is the killer feature; "freshness proven, not scheduled."**
2. **Local-model support (Ollama / OpenAI-compatible)** — largest volume cluster: #358, #175 ("I no longer can use my local ollama models anymore since OpenAI api key is required"), #248, #152, bug #355. **→ first-class local-model adapter; critical for internal data residency.**
3. **Large-repo / monorepo handling** — #468 ("larger repos will have difficulty loading into memory or LLM… input exceeding the LLM context length," reproduced on Gemini and Ollama). **→ codemap chunking + per-symbol context; make large-repo success a tested guarantee.**
4. **Deeper analysis (anti-shallowness)** — #230 ("The analysis of page content and system architecture is superficial, with limited practical value"). **→ persona-targeted writer + source-grounded context; measure via coverage + verifier pass-rate.**
5. **Custom wiki structure / IA control** — hosted DeepWiki added a `.devin/wiki.json` steering file (repo_notes + explicit page list) specifically for IA control on large repos. **→ ia.yml + NavTree editor is the answer; declarative and versioned.**
6. **Markdown / static-site export** — a whole ecosystem of third-party exporters exists (DeepWiki-to-Markdown Chrome extension, `deepwiki-to-md` on PyPI, DeepWiki Markdown MCP). **→ docstube ejects a self-owned site into the repo — structural advantage; emphasize "you own the output."**
7. **Better/correct diagrams** — HN on the DeepWiki launch: diagrams "not engineering quality" (IceHegel), "too handwavy to be useful… don't seem tied down enough to the actual implementation details." **→ source-grounded, codemap-verified diagrams as top wedge.**
8. **Private repo support without a paywall** — hosted DeepWiki paywalls private repos behind Devin (pay-as-you-go ACUs ~$20 start); recurring self-host motivation is analyzing private repos locally without sending code to third parties. **→ BYO-AI + local-first is the answer; lead with it for internal wikis.**
9. **Multi-repo bridging** — #66 (≈9 engagement, opened by a maintainer). **→ cross-repo Ask agent = Cloud monetization.**
10. **Provider breadth** — #41 (AWS Bedrock), #490 (OpenRouter embeddings), #512 (DashScope). **→ provider-agnostic adapter contract.**
11. **Persistent/cloud cache storage (S3)** — #367. **→ Cloud-tier fleet storage; local sqlite/cache is the OSS default.**
12. **CI integration + access control** — no first-class GitHub Action upstream (curl examples only); auth admittedly weak ("Restricts frontend initiation… but doesn't fully prevent backend generation if API endpoints are hit directly"). **→ docstube's GitHub Action + Cloud SSO differentiates.**

### Ranked trust-breaker list (what breaks L4 trust most)

1. **Hallucinated architecture / wrong factual claims** — LLVM contributor jcranmer: "results ranged from incomplete to just plain incorrect… completely omits some of the most important passes in LLVM" (InstCombine, GlobalISel). LibreOffice's buovjaga: DeepWiki wrongly claims LibreOffice uses the Buck build system. **→ Registry: build-system detection must be a deterministic verifier.**
2. **Stale content after code changes** — #402/#371; caching lag. **→ Registry: provenance staleness → symbol-level regeneration + freshness proof.**
3. **Convincing hallucination from stale naming** — OSS maintainer ignoramous: "hallucinating pretty convincingly… because a struct / a package / a function was named for something it wasn't doing anymore." **→ Registry: provenance keyed to current AST via normalized symbol hashes, never identifier names.**
4. **Shallow / padded analysis** — #230; jcranmer: "the general feeling of a student trying to pad their paper to meet a minimum length requirement." **→ Registry: audience/quality class.**
5. **Content overlap + broken internal links** — #230 ("High overlap exists across content in different wiki pages, and some hyperlink addresses are incorrect"). **→ link verifier + cross-page dedup check.**
6. **Diagrams not tied to implementation** — HN IceHegel. **→ diagram edges verified against codemap call/import graph.**
7. **Consent / unwanted indexing / SEO-slop reputation** — HN: "another SEO slop-spammer"; a maintainer reported a DeepWiki-generated AI-slop bug report wasting an hour (PureLB, GitLab issue #147); no clear takedown path. **→ docstube runs in the user's own repo by choice — structurally avoids this; "you invoke it, you own it."**
8. **Context-length/token failures producing partial coverage** — #468. **→ Registry: system-level → chunking + explicit partial-coverage flagging.**

## (3) Automation-Trust Mechanisms Table

| Mechanism                             | Evidence from adjacent tools                                            | docstube feature it maps to                                    |
| ------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| Deterministic checks gate the action  | Dependabot/Renovate auto-merge only on green CI                         | Publish only when all verifiers pass; else flag                |
| Scope / blast-radius limits           | Semver-patch-only, lockfile-only, CODEOWNERS                            | Per-path autonomy scopes (→ v2 policy engine)                  |
| Observation window before auto-action | 24h soak for security updates; `minimumReleaseAge`                      | (→ dropped; recorded for reference)                            |
| Dry-run / plan-vs-apply               | Terraform plan/apply; ArgoCD diff                                       | (→ dropped per founder)                                        |
| Self-heal / continuous reconciliation | ArgoCD `selfHeal`/`prune`                                               | Provenance-driven auto-regeneration                            |
| Easy rollback                         | Immutable versioned releases                                            | (→ dropped; git revert covers it)                              |
| Audit log + signed provenance         | Regulated auto-merge requirements                                       | Signed provenance manifest (architect-only) + `.docstube/runs` |
| Instrumented success-rate metric      | Auto-merge success dashboards                                           | Defects-per-100-claims; coverage                               |
| Advisory → gating promotion path      | "Start non-blocking, promote once dismissal rate <20%"                  | (informing v2 policy engine)                                   |
| Explainability as trust interface     | "Explainability is becoming the new observability" (CodeRabbit, vendor) | Explainable scores + per-claim guarantee levels                |

**Positioning precedent + backlash to avoid:** Oracle's "Autonomous Database" drew on-record skepticism — "we need to see proof that it works" (Marty Puranik, Atlantic.Net); "hyperbolic marketing" (Mike Lloyd, RedSeal). The L4 claim must be falsifiable and demonstrated (defect metrics, audit, registry), never asserted. Corroborating: METR RCT (arXiv:2507.09089, July 2025, n=16) — experienced OSS devs were 19% _slower_ with AI while believing they were 20% faster; measured evidence must lead.

## (4) The Revised Feature Plan (as proposed by this report)

### V1-CORE

| Feature                                                                                        | Evidence                                                  | L4-fit                   | Effort |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------ | ------ |
| Symbol-level incremental regeneration                                                          | #402, #371; DeepWiki lags source                          | Core                     | L      |
| `docstube audit` (standalone, free)                                                            | 28.9% baseline; drift GTM                                 | Proves the metric        | M      |
| Extended deterministic verifiers (incl. runtime exec, shellcheck, JSON/YAML, config-vs-schema) | Sonar 96%; #230 broken links                              | Widens "proven" domain   | L      |
| Source-grounded, codemap-verified diagrams (ELK default, dagre fallback)                       | HN "handwavy"; TALA proprietary                           | Proven diagram claims    | M      |
| Local-model / OpenAI-compatible adapter                                                        | #358/#175/#248/#152/#355                                  | Data-residency autonomy  | M      |
| Exception-triage surface                                                                       | Flags ≠ supervision                                       | Core                     | M      |
| Provenance links + per-claim guarantee level                                                   | DeepWiki citations most-praised                           | Core trust surface       | M      |
| Coverage metric vs codemap                                                                     | Omission failure class                                    | Required proof           | S      |
| MCP docs server (DeepWiki-convention names)                                                    | `ask_question`/`read_wiki_structure`/`read_wiki_contents` | Agent-ecosystem fit      | S      |
| GitHub Action opening PRs                                                                      | No first-class Action in deepwiki-open                    | Auto-merge-safe autonomy | M      |
| Explainable quality scores                                                                     | Trust interface                                           | Required                 | M      |

### V1-ARCHITECT-ONLY (contracts to define)

| Feature                           | Contract                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Per-path autonomy scopes / policy | `autonomy:` block — per-glob {mode, guarantee_floor, flag_budget}                               |
| Flag telemetry schema             | (→ dropped as feature; schema noted for reference)                                              |
| Signed provenance manifest        | per-claim {source_path, commit_sha, verifier, guarantee_level, signature}                       |
| Verification badge endpoint       | {defects_per_100, coverage_percent, last_verified_at}                                           |
| Tribal-knowledge capture          | instructions keyed by symbol hash; declared ODD boundary                                        |
| Private-wiki access control       | SSO/OIDC + per-path ACL contract; enforce in Cloud                                              |
| Migration importers               | importer → normalized IA + content as _context_; imported claims "unverified" until re-grounded |
| Versioned docs & i18n             | version/locale dimensions in manifest, IDs, provenance _(→ ship v1 per PRODUCT.md)_             |

### V2 / FAST-FOLLOW

Language expansion Java → Go → Rust → C# → PHP _(→ Java moved to v1)_; feedback → autonomous refinement; docs-gaps-from-MCP-queries _(→ Cloud)_; changelog generation _(→ v1)_; curl-vs-OpenAPI + CLI-output freshness verifiers _(→ v1 umbrella)_.

### CLOUD

Cross-repo Ask agent (#66); fleet docs-health dashboard; governance/SSO; S3/fleet storage (#367); TALA opt-in with license pass-through.

### REDESIGNED-FOR-L4 (before → after)

- Review UI: page approval → exception triage _(final: feedback surface + separate flag queue)_.
- Feedback widget: human backlog → autonomous refinement input _(final: widget dropped; Ask-AI mining instead)_.
- Autonomy default: L3-with-dial recommendation → **founder override: L4 default within declared ODD**.
- llms.txt: headline → hygiene.

### DROPPED / DOWNGRADED

TALA as default (licensing) · llms.txt as centerpiece (97% zero requests) · page-approval review UI (L3 gate) · generic star-rating widget (low signal).

## (5) Failure-Mode Registry Delta (new classes from this research)

1. **Build-system / tooling misidentification** (LibreOffice→Buck; LLVM) — system-level class. Detection: deterministic build-system detector vs manifest files; **proven**.
2. **Stale-naming hallucination** — refines factual claims. Detection: normalized symbol hashes, provenance to current AST; **proven**.
3. **Cross-page content overlap / redundancy** (#230) — structure sub-class. Detection: dedup/similarity check; **scored**.
4. **Partial-coverage-on-large-repo silent failure** (#468) — system-level. Detection: coverage metric + explicit partial-coverage flag; **declared**.
5. **Diagram-not-grounded-in-implementation** — detection: edges validated against codemap call/import graph; **proven** where compiler-derived.
6. **Rigid-format generation failure with alternate models** (#355 "No valid XML found in response") — system-level robustness. Detection: output-schema validation + model-capability contract + retry; **proven** (deterministic parse).
7. **Consent / attribution failure** (SEO-slop; unwanted indexing) — governance class; resolved structurally by run-in-your-own-repo + optional footer credit; **declared-out-of-scope by design**.
8. **Embeddings / provider-capability mismatch** (#191, #252 "No valid embeddings found") — system-level. Detection: pre-flight provider-capability check in `doctor`; **proven pre-flight**.

## (6) Ladder / Registry Publishing Recommendation

The SAE-style autonomy-ladder frame exists for coding agents (Tessl's "5 levels of AI agent autonomy"; SmartBear's "levels of autonomy in software development") and QA/testing — but **no documentation-specific canonical ladder exists**. docstube can claim "the autonomy ladder _for documentation_," explicitly framed as extending the SAE analogy to a new domain. What made 12-factor/SemVer/DORA succeed: a single canonical, versioned, vendor-neutral spec with a stable URL — not a product-marketing blog post. Recommendation: standalone versioned spec (vendor-neutral tone, docstube positioned as _an implementation targeting L4_), competitors mapped honestly; failure-mode registry as a living versioned document (security-advisory-database model) — _(final: ladder public, registry private)_; manifesto post that links to the spec; every claim anchored to the falsifiable metric (defects per 100 claims vs the 28.9% / 4.7-year human baseline).

## (7) Caveats on Evidence Quality

- deepwiki-open engagement counts largely unconfirmed (only #66 ≈9, #41 ≈3, #45 ≈2 visible); issue existence/verbatim text reliable; ranking inferred from recurrence.
- Hosted DeepWiki vs deepwiki-open complaints are conflated in places; attribution noted per item (LLVM/LibreOffice/SEO-slop → hosted; Ollama/XML/Docker → OSS clone).
- The 28.9% / 4.7-year baseline traces to a peer-reviewed EMSE study (Tan, Wagner & Treude, arXiv:2212.01479), popularized via Dosu's vendor blog; the 4.7-year average is dataset-specific (top-1000 repos, survival-curve based).
- llms.txt statistics (Ahrefs 137,210 domains; Originality.ai 8.8x growth) are self-described ceilings ("fetched ≠ read"); vendor-published.
- Distrust/productivity figures: Sonar 2026 (n=1,149); METR RCT (n=16 — directional); "1.7x more defects in AI code" is a CodeRabbit (vendor) analysis of 470 PRs.
- TALA licensing confirmed from Terrastruct's own pages: proprietary, watermark without license, Enterprise license for CI/servers; D2 core + dagre + ELK are MPL-2.0/free — a hard constraint for an MIT default.
