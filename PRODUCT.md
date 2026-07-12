# docstube — PRODUCT.md

> **Verified docs, generated from your code.**
> The first L4 documentation system: fully autonomous within a declared domain, trustworthy because every claim is proven or flagged — never silently wrong.

**Status:** source of truth as of 2026-07. Supersedes all prior versions of this document and the plan the existing implementation was built on. Reasoning and evidence live in `knowledge/` (see §10).

---

## 1 · Thesis

### 1.1 Vision: L4

Documentation tooling sits on an autonomy ladder:

| Level | Who writes | Who maintains | Examples |
|---|---|---|---|
| L0 | humans | humans | Docusaurus, Starlight, MkDocs |
| L1 | humans + AI assist | humans | GitBook editor AI, "you + Claude in the repo" |
| L2 | humans wrote the base | AI drafts PRs, humans approve | Mintlify Autopilot, GitBook Agent, Dosu, Swimm |
| L3 | AI generates from code | humans review output | DocuWriter-style one-shots |
| **L4** | **AI generates** | **AI maintains — no human gate** | DeepWiki (unverified, distrusted) · **docstube (verified)** |

docstube is designed ground-up as **L4**: humans set intent once (config, personas, IA); the system generates, verifies, ships, and maintains docs autonomously. Human attention is pulled **only** for declared out-of-domain exceptions. Flags are exceptions, not supervision — if humans must review output, it's L3.

The ladder is **published publicly** as category-defining content ("the 5 levels of documentation autonomy"). Whoever publishes the scale defines the category; docstube claims the top: *"the only actual L4 — because you can't claim L4 when it doesn't work."*

### 1.2 Mechanism: verification

L4 without verification is DeepWiki: confidently wrong, publicly distrusted (documented hallucinations: wrong build systems, invented architecture). **Deterministic verification is the technology that substitutes for human supervision.** Every claim in generated docs is either:

- **proven** — checked by a deterministic tool (compiler, type-checker, link resolver, schema validator, sandbox execution, codemap match), or
- **scored** — assessed by AI review against explainable criteria, or
- **out-of-domain** — declared unprovable (tribal knowledge, intent, "why") → flagged or asked-once.

### 1.3 Accuracy doctrine

Nothing is 100%. The bar is the **human baseline**, which is measurably bad: 28.9% of popular repos document symbols that no longer exist; the average outdated reference has been wrong 4.7 years (Tan/Wagner/Treude, EMSE). The metric: **verified defects per 100 claims**, measured by `docstube audit` — falsifiable, head-to-head, on any docs site.

Key asymmetry: human doc errors are mostly *staleness* (was true once); raw AI errors include *confabulation* (never true). The deterministic layer structurally eliminates the confabulation class; provenance-driven regeneration eliminates staleness. What remains is flagged.

---

## 2 · Positioning & segments

- **Lead:** L4 is the category claim; verification is why anyone believes it (positioning option C).
- **Segments:** public product docs (free distribution engine: OSS, devtool/API companies) + internal engineering wikis (monetization: Cloud tier, "the wiki that can't be silently wrong").
- Explicitly NOT: API-reference-first (spec-compiled incumbents own it) and NOT help-desk KB. But **OpenAPI ingestion is v1** — public docs for devtool companies leak without it.
- **Business model:** MIT core free forever · Cloud tier later (§4.4) · Enterprise self-hosted later.
- **GTM wedge:** `docstube audit` on famous OSS repos → published drift reports → offer to fix.
- Never claim "zero hallucinations." Always: "flagged, never silently wrong."

---

## 3 · Core architecture contracts

These are the contracts everything else builds on. They MUST be designed before implementation regardless of feature shipping order.

### 3.1 Entity model

Every piece of generated content is an addressable entity with a **stable ID**:

```
page → section → block → claim (inline, finest grain)
         block types (illustrative, NOT exhaustive):
             paragraph · callout · code-example · diagram ·
             diagram-node · table · api-entry · …
```

Block-type taxonomy rule: **open enum, not a closed union.** Block types derive from (a) a small set of core primitives and (b) the component registry — each registry component with a Zod metadata schema is a block type. Since components are pluggable (§3.4), plugins can add block types; the entity model MUST support this (per-type Zod metadata, no hardcoded union). Final taxonomy is architecture work (§7).

One schema, four consumers:

1. **Provenance** — every entity links to the source symbols/lines/commits that ground it.
2. **Guarantee level** — every entity carries proven / scored / out-of-domain.
3. **Feedback anchoring** — the review UI selects these same entities to attach feedback.
4. **Regeneration granularity** — provenance maps symbols → entities, enabling sub-page regeneration.

Entity IDs carry **version** and **locale** dimensions (versioned docs + i18n are v1). Code-example entities support **language variants** (one canonical example → per-language variants; multi-language samples are v2 but the model supports them now).

### 3.2 Provenance & guarantee levels

- Symbol-level provenance (normalized symbol hashes over tree-sitter codemap) — never keyed to identifier *names* (stale-naming hallucination class).
- Visible per-entity source citations on the rendered site (line/commit links).
- Bias rule retained: when provenance is uncertain, regenerate or flag — never assume.

### 3.3 Verification gate & autonomy defaults

- **Auto-merge by default.** All deterministic gates green + no flags + no guarantee downgrades → the refresh PR merges without a human. This is the product's honest L4 posture.
- v1 ships **hardcoded safe exception rules** (any flag present; guarantee downgrade on an existing entity; structural/IA changes). The configurable **policy engine is v2** (§4.3).
- **Flag queue** — the triage surface for out-of-domain exceptions only. Distinct from the **review UI**, which is the interactive feedback surface (production-rendered preview; click any entity to leave feedback; categorizer routes feedback into criteria / writing instructions / glossary / config).
- Feedback learning is durable and shared by construction: categorizer writes to `.docstube/instructions/` and `.docstube/criteria/`, which the writer agent reads on every future generation.

### 3.4 Plugin kernel

```
KERNEL (trusted core): pipeline orchestration · entity model ·
                       provenance · verification gates
EVERYTHING ELSE = PLUGIN: deployment targets · analytics · site auth ·
   search providers · content sources · verifiers · language packs
```

- **First-party features consume the same plugin API third parties get** (dogfooding keeps the API honest). Built-in verifiers and language packs are architecturally plugins.
- **`plugin-authoring` skill ships with the product**: the user's own coding agent writes a working plugin in minutes → long-tail coverage + shareable plugins → network effect.
- Plugin API is marked **experimental until 1.0** (semver-stabilized after), so early refactors don't kill the ecosystem.
- Plugins declare **capabilities and writable roots** in a manifest (npm-style trust posture, consistent with agent-invocation sandboxing).

### 3.5 Pipeline (retained, extended)

Stage contracts — responsibilities and semantics are product decisions; exact I/O schemas are architecture work.

1. **Codemap** — tree-sitter structural map of the source repo; normalized symbol hashes (§3.2); API truth extracted via TypeDoc (TS), griffe (Python), Java extractor; OpenAPI/AsyncAPI specs ingested as first-class sources alongside code.
2. **Context assembly** — per-page source-grounded context from codemap + `ia.yml` + criteria/instructions/glossary + imported reference context (§4.1 importers). Context provided to the writer is recorded as **seed context** (provenance input).
3. **Write** — writer agent drafts MDX entities. All agent reads during writing are recorded (**observed reads**) and citations captured → together with seed context these form per-entity provenance.
4. **Review** — one reviewer agent per persona; audience-fit and correctness-risk findings; scores derived from explainable criteria only (never an opaque judge number).
5. **Verify** — deterministic verifiers (§4.1) run per entity; results assign guarantee levels (proven / scored / out-of-domain).
6. **Gate** — pass → ship. Fail → bounded retry loop back to the writer with findings attached. Unprovable → flag. Never silently wrong.
7. **Assemble & eject** — self-contained Astro + React site written into the user's repo (no runtime dependency on docstube); agent conventions applied (llms.txt, `.md` URLs, MCP server, AGENTS.md).
8. **Maintain** — on code change: symbol-hash diff → provenance lookup → only affected entities regenerate. Bias rule: uncertain provenance ⇒ regenerate or flag, never assume. A **topology pass** restores cross-page consistency after partial regeneration (links, glossary, nav, contradictions). GitHub Action opens auto-merging PRs (§3.3).

Cross-cutting semantics: long runs are **resumable** (journaled in `.docstube/runs/`, resume is obvious); usage caps are approximate — **freeze with margin**, surfaced as a cap-freeze banner in the dashboard; agent calls cached by prompt+input hashes with record/replay in CI (§3.6).

### 3.6 BYO-AI (retained)

Official codex / claude / gemini CLIs, or direct API keys with provider presets and custom OpenAI-/Anthropic-compatible base URLs (this covers Ollama/local models — MUST be tested and documented, strong OSS demand). docstube servers never receive source, prompts, docs, paths, or project names. Non-interactive agent invocations, declared writable roots, cache by prompt+input hashes, record/replay in CI.

### 3.7 Cloud ↔ client contract

Designed in v1 (API shape, auth, what syncs — and what never syncs: source, prompts, docs content). Hosted at launch: **account registration + waitlist/interest capture only.** Everything else is local + GitHub Action.

### 3.8 Failure-mode taxonomy (private)

Internal spec, v1: every failure class → detection mechanism → guarantee level. Verifiers and flags are organized around it. Classes include: factual claims, code samples (compile + runtime), structure (links, orphans, contradictions, cross-page duplication), audience/quality, omission/coverage, tribal knowledge (declared ODD boundary), system-level (build-system misidentification, partial coverage on large repos, model output-format failures, provider-capability mismatch). **Kept private** (acquirer value). The telemetry/classification of real user errors is v2 with hard privacy design (§4.3).

---

### 3.9 Local UI & wizard

#### 3.9.1 What the UI is
Single-page localhost web app (not a TUI), served by `docstube wizard`: **setup wizard** (first run) or **dashboard** (once a run exists). Three surfaces — setup wizard · generation dashboard · review UI — plus the **flag queue** (§3.3; fourth surface vs dashboard mode: architecture call). Keystones: the **NavTree** is one component reused across all surfaces (IA editing → progress → review navigation); **no node-graph pipeline canvas** (considered, rejected).

#### 3.9.2 Setup wizard flow
Each step writes intent into `docstube.yml` / `ia.yml`:
Steps 1–3 are pre-filled by a **deterministic detection engine** (<1s, no agent calls: manifest/README/OpenAPI/framework sniffing) — confident detections pre-fill, ambiguous fields stay blank. The engine is a shared module (also serves `doctor`, `audit`, language-pack detection).
1. **Doc type** — `internal` · `external-library` · `external-product` (detected from manifest signals).
2. **Project context** — short free-text: what the project is, who it's for (extracted from README/manifest — extracted, never generated).
3. **Personas** — audiences (`id` + `description`); drive the per-persona reviewers (suggested from a static per-doc-type catalog — templates, not inference).
4. **Sources (optional)** — OpenAPI/AsyncAPI specs as first-class sources; existing docs as reference context via importers (Mintlify/GitBook/ReadMe/Confluence; claims unverified until re-grounded).
5. **Information architecture** — segmented control of agent-generated IA proposals ("A: task-oriented · B: by-module · C: user-journey", one-line rationales) + editable NavTree (drag reorder/reparent, inline rename, add/remove; selecting a node shows its **page brief**, which seeds the writer; any edit forks to "Custom"). `sectioned` layout renders top-level nodes as section tabs.
6. **Versions & locales** (new; both ship v1) — declare version scheme + target locales; detailed UX in architecture (§7).
7. **Theme** — "Design it here" (token editor with persistent miniature live preview: real sample page in a scaled iframe, live-updating) or "Match my existing project" (agent extracts tokens from Tailwind config / CSS vars / token files → same editor to confirm). URL-scraping fallback = stretch.
8. **Site metadata** — title, description, logo, favicon.
9. **Component selection** — enabled MDX components (Callout, CodeGroup, FileTree, Diagram, ApiReference, …); registry-defined with Zod metadata, plugin-extensible open enum (§3.1, §3.4).
10. **Start.**

No screenshots step (deferred; reserved config object only).

#### 3.9.3 Generation dashboard
Principle: **"the waiting room is the review room"** — finished pages stream in reviewable while the run continues. NavTree in progress mode (`queued → writing → checking → judging → retrying → passed / flagged`, findings counts, per-page cost, live over WebSocket). Per-page **CI-style step timeline** (GitHub-Actions-like; each step expands to the actual agent output, reviewer criteria results, deterministic-check results, retry diffs) — a **pure renderer over SQLite job/findings state**: refresh-safe, identical after resume. Live preview pane renders real production output as pages land. Cap-freeze banner (§3.5).

#### 3.9.4 Review UI
Production-rendered preview. **Feedback anchors to entities** (§3.1): element/block, section, page, whole-docs — addressed by stable entity IDs. **Feedback categorizer** routes every item into criteria / writing instructions / glossary / config (durable, shared learning — read by the writer on every future generation). Actions per page: regenerate · approve — **approval is never a shipping gate** (auto-merge default, §3.3); required human attention lives only in the flag queue.

#### 3.9.5 Config & round-trip
`docstube.yml` at repo root = single source of truth, **intent only**. The wizard is one editor among others: reads → pre-fills → writes back through a **comment- and formatting-preserving YAML document API** (hard requirement — hand annotations must survive). Config shape = Zod schema in `@docstube/core` → generated JSON Schema, shipped + registered on SchemaStore (editor autocomplete/validation with zero setup); same Zod validates at runtime with human-readable errors. Everything is files ⇒ **an agent can configure a project end-to-end without the wizard** ("IaC for docs"). **Secrets never in config** — env/keychain only.

#### 3.9.6 Cross-cutting UI principles
Explainable quality scores (criteria results + deterministic outcomes + finding severity; never an opaque number). Resumability first-class (timelines are pure SQLite renderers). PostHog opt-out telemetry with the strict never-send list.

### 3.10 State model (committed vs local)

**Committed, travels with the repo** (the lockfile pattern — derived state committed for determinism and branch-correctness: provenance always matches the commit it sits on): `.docstube/manifest.yml` (provenance map, guarantee levels, open flags), config family, criteria/instructions, the generated site. **Local, rebuildable, never committed:** `db.sqlite` (a derived view/cache, rebuilt from manifest + repo), `cache/`, `runs/` (in CI, run journals upload as Actions artifacts for debugging). CI flow: checkout → symbol-diff vs committed manifest → regenerate affected → PR carries docs + manifest + flags atomically → auto-merge (§3.3). Manifest MUST be text, diffable, and merge-tolerant — likely sharded per-page rather than monolithic (architecture, §7).

## 4 · Feature spec

RFC-2119 keywords (MUST/SHOULD/MAY) used deliberately.

### 4.1 V1 — ships at launch

**Verification & proof**

| Feature | Spec |
|---|---|
| Extended deterministic verifiers | Existing set (MDX compile + component props, tsc, pyright, javac, import/path resolution, internal+external links, D2 render, glossary rules, frontmatter/IDs, API-ref consistency) **plus**: shellcheck for bash blocks; JSON/YAML samples vs schema; config examples vs Zod/JSON-schema; curl examples vs OpenAPI spec; env-var existence; CLI flag validity |
| Snippet runtime execution | Code samples MUST execute in a sandbox (doctest-style); compile ≠ works |
| Verified diagrams | **Very important.** D2 only. Every node/edge MUST map to a codemap symbol/relation; ungrounded elements are flagged. Layout: ELK default, dagre fallback, TALA opt-in only (proprietary; Enterprise license required for CI — cannot be an MIT default) |
| `docstube audit` | Runs against **arbitrary existing docs sites** (Mintlify/Docusaurus/GitBook/MD/MDX): parse foreign docs → extract claims → match against codemap → defect report. The GTM weapon and the metric's measuring device |
| Per-entity provenance citations | Visible on the rendered site |
| Per-entity guarantee levels | proven / scored / out-of-domain, in frontmatter + UI |
| Coverage metric | % public symbols documented — **doc-type-conditional** (on for libraries/SDKs; off for apps/services) |
| Verification badge | Static badge at launch ("N claims verified · X defects · date"); live endpoint is Cloud |

**Autonomy**

| Feature | Spec |
|---|---|
| Auto-merge by default | §3.3. PRs annotated with the verified delta (what changed, what proves it) |
| Flag queue | Exception triage only — never page-by-page approval |
| Tribal-knowledge capture | When generation hits out-of-domain ("why was X deprecated?"), ask **once**, store the answer as durable context keyed to the symbol/entity. **Non-blocking**: generation never waits — flag + proceed; the answer is incorporated on the next run |

**Generation quality**

- Depth/page-count policy — IA-level control of granularity (⚠ needs full spec, §7).
- Anti-slop prose lints — deterministic style checks (banned AI-isms, repetition, sentence-variance).
- Changelog generation — same verified pipeline over git history; optional "why" via user-owned MCP sources (Jira/Linear).

**Site & agent-readiness**

- Agent conventions, exactly: llms.txt + llms-full.txt (hygiene, not headline); raw `.md` served at every doc URL; docs MCP server with tool names matching DeepWiki de-facto conventions (`ask_question`, `read_wiki_structure`, `read_wiki_contents`) over Streamable HTTP; AGENTS.md emitted and kept fresh.
- **Versioned docs — ships v1.** Hybrid model (C): the current version is live from HEAD (full pipeline); past versions are frozen snapshots cut at release time (manual re-cut possible). Version dimension in entity IDs/provenance/manifest; version switcher.
- **i18n — ships v1.** Declared locale list; source locale is truth; locale dimension in entity IDs/provenance; translations pass through the same verifiers per locale (verified translations).
- Pagefind baseline search (world-class custom search is Cloud).
- PR-preview deployments via deployment plugins.
- Retained: sitemap/canonical/OG/structured data; FAQ/AEO guidance; layouts `single-tree` + `sectioned`; footer credit default-on, disableable.

**Inputs**

- **OpenAPI/AsyncAPI ingestion** as first-class source next to code (enables curl/endpoint verification; unlocks API-company public docs).
- **Migration importers as context**: Mintlify / GitBook / ReadMe / Confluence → reference context (tone, structure, tribal knowledge). Imported claims are **unverified until re-grounded** against source. Never as-is migration.

**Scale & languages**

- Language packs shipping v1: **TypeScript, Python, Java.** Language-pack plugin interface designed for Go/Rust/C#/PHP (ship post-v1 in that order).
- Monorepo / multi-project support (⚠ design doc required, §7) — monorepo is becoming the JS/TS default.
- Large-repo hardening (⚠ design doc required): token budgets, chunked codemaps, partial coverage as **declared state**, never silent truncation.

**Ops & distribution**

- Deployment plugin interface with first adapters (GitHub Pages, Vercel, Netlify). Site auth belongs to the deployment layer: edge/proxy basic auth via plugins (v1-cheap); SSO is Cloud. Frontend-only auth is prohibited (decorative).
- CLI: wizard · generate [--fresh] · refresh · refine [page] · **audit** · validate · check · status · doctor · upgrade · plugin (scaffold via skill) · help · version. Existing flag surface survives (wizard --fresh, refine --failed/--max-rounds, upgrade --check/--to). `check` kinds MUST derive from registered verifier plugins (open enum, §3.4) — not a hardcoded list.
- Config: docstube.yml (typed, comment-preserving) · ia.yml · glossary.yaml · .docstube/ (manifest, criteria, instructions, db.sqlite, cache, runs) · plugin manifests.
- npm package + standalone binaries. PostHog opt-out telemetry with strict never-send list.
- Minimal hosted: registration + waitlist.
- Autonomy ladder published as public content.

### 4.2 V1 — architect-only (contracts now, ship later)

| Contract | Design now |
|---|---|
| Policy engine schema | `autonomy:` config block — per-glob {mode, guarantee floor, exception rules} |
| Signed provenance manifest | Tamper-evident per-entity record {source, commit, verifier, guarantee, signature} |
| Multi-language sample variants | Entity model supports variants (§3.1) |
| SSO / access-control hooks | In the deployment-plugin + Cloud contract |
| Remaining language packs | Go / Rust / C# / PHP behind the pack interface |
| Cloud contract | §3.7 |

### 4.3 V2 / fast-follow

- **Autonomy policy engine** (configurable auto-merge/exception rules; replaces hardcoded v1 rules).
- **Failure-registry telemetry**: classify real user errors via the user's own AI; hard privacy design (classes + counts only, never content; visible opt-out; trust-preserving by construction).
- **Feedback → autonomous refinement**: cluster + threshold + auto-apply into instructions/criteria (removes the human from the learning loop).
- Non-code knowledge via user-owned MCP sources, generalized (any "why" source, with provenance).
- Multi-language code samples (one canonical example → verified per-language variants).

### 4.4 Cloud

World-class custom docs search (the assumed pillar; likely Stacktape-deployed, AWS AgentCore or custom) · cross-repo Ask agent · docs-gaps-from-MCP-queries loop · fleet docs-health dashboard · SSO/governance/audit · analytics (as a plugin) · Slack/Discord answer bot · Ask-AI site widget · live badge endpoint. Entry ~$10–15k/yr (open-core norm). Cloud integrates as **plugins** over the same API.

---

## 5 · Removed (decided against, with reasons)

| Item | Reason |
|---|---|
| Dry-run / plan mode | No user value seen; PRs already show the delta |
| One-command rollback | Git revert covers it |
| Flag-rate telemetry (as a feature) | Cut; flags are visible per-run anyway |
| "Was this helpful?" widget | Needs a backend; Ask-AI query mining (Cloud) is strictly richer signal |
| TALA as default layout | Proprietary licensing incompatible with MIT default |
| Public failure-mode registry | Kept private — acquirer value; audit/drift reports carry the marketing |

## 6 · Boundaries (out of scope, unchanged unless listed in §4)

Screenshot capture (reserved config object only) · native UI screenshots · Mermaid (D2 only) · docstube-operated free hosting · marketing website work · agent adapters beyond codex/claude/gemini + compatible base URLs · hosted backend beyond registration/waitlist.

*(Removed from boundaries by decision: versioned docs, i18n, migration-import-as-context — now v1.)*

## 7 · Open design questions (for the architecture step)

1. Entity block-type taxonomy — enumerate core primitives + registry-derived types; define the per-type Zod metadata pattern and how plugin-added types register (§3.1).
2. Depth/page-count policy — full spec needed.
3. Monorepo/multi-project — design doc (project discovery, shared glossary/theme, per-package provenance).
4. Large-repo hardening — budgets, chunking, declared-partial-coverage semantics.
5. `audit` claim extraction on arbitrary/foreign docs — parsing + claim-matching approach.
6. Plugin API surface — exact hook points, manifest schema, versioning.
7. Tribal-knowledge capture UX — where questions surface (CLI? flag queue? PR comment?).
8. i18n verifier semantics — which checks run per-locale vs source-only.
9. Versioned-docs provenance keying — version × symbol-hash interaction.
10. Old implementation salvage — inventory existing code; keep/rewrite per package (see HANDOFF.md).
11. State-model design — the committed-manifest vs local-sqlite split (§3.10): manifest sharding/merge semantics, what exactly is portable vs derived, and re-validating SQLite as the local store (chosen before the full data model was known; likely still right).

## 8 · Metrics

- **Verified defects per 100 claims** (the public, falsifiable metric; measured by `audit`).
- **Coverage %** (doc-type-conditional).
- Both surfaced per-run and on the badge.

## 9 · Decision log (2026-07 session)

| Decision | Reasoning |
|---|---|
| L4 as design goal (overriding research rec of "L3 default + dial") | Founder call; credibility earned via failure-mode enumeration + verification, not via keeping a human gate |
| Positioning C: L4 vision + verification mechanism | L4 is the category claim; verification is why it's believable |
| Ladder public, registry private | Ladder = pure positioning, no proprietary value; registry = engineering asset + acquirer value |
| Segments: public product docs + internal wikis; OpenAPI still v1 | Research-confirmed whitespace; public docs leak without OpenAPI |
| Auto-merge by default | Honest L4 posture; exceptions hardcoded v1, policy engine v2 |
| Unified entity model | One schema serves provenance, guarantees, feedback, regeneration |
| Plugin kernel + authoring skill | Collapses plugin cost to a prompt; network effect; first-party dogfoods the API |
| Versioned docs + i18n + Java ship in v1 | Founder call: coding is cheap now; design architecture around the full set |
| `audit` handles arbitrary docs | The GTM play requires the hard version |
| v1 hosted = registration/waitlist only; Cloud contract designed | Local-first launch, funnel open, no premature backend |
| Removed: dry-run, rollback, flag-rate feature, helpful-widget | See §5 |
| Term "review UI" = feedback surface; "flag queue" = exception triage | Founder naming preference |
| Wizard-first onboarding (no zero-config inference path) | Founder call; consistent with L4 — humans set intent once upfront, autonomy applies to output |
| Wizard pre-fill is deterministic, never agent-based | Latency (agent inference can take minutes); blank-if-unsure; shared detection module |
| Flag delivery: PR comment always + dashboard queue as triage home + digest issue for tribal-knowledge questions | Flags are the only human touchpoint in L4; must be visible where changes live, durable beyond merged PRs |
| State: manifest committed (lockfile pattern), sqlite never committed (derived local view) | Branch-correct provenance, backend-free CI, no binary merge conflicts |
| Versioning model C: current version live from HEAD, past versions frozen snapshots at release-cut | Regenerating from old code (A) explodes cost; pure declared list (B) can never fix old defects |
| Tribal-knowledge capture is non-blocking | Blocking generation on human answers would reintroduce supervision |

## 10 · Knowledge index

Research artifacts live in `knowledge/research/` (committed alongside this doc):

1. `01-competitor-feature-mining.md` — competitor features, demand themes, initial proposals.
2. `02-segment-strategy.md` — autonomy-ladder × purpose competitor map, segment analysis, autonomy-appetite evidence.
3. `03-l4-feature-plan.md` — DeepWiki-ecosystem mining, automation-trust mechanisms, L4-lens feature plan.

Pitch deck (`docstube-pitch-deck.md`) is a sibling artifact; keep claims consistent with §1–§2 (esp. "flagged, never silently wrong", no zero-hallucination claims).
