# docstube — PRODUCT.md

> **Verified docs, generated from your code.**
> The first L4 documentation system: fully autonomous within a declared domain, trustworthy because every claim is checked or visibly flagged — never silently wrong.

**Status:** source of truth as of 2026-07-21. Incorporates the founder-adjudicated design-review
decisions (the `knowledge/design/*-v2.md` decision records, folded in 2026-07-21). Supersedes all
prior versions of this document. Reasoning and evidence live in `knowledge/` (see §10).

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

docstube is designed ground-up as **L4**: humans set intent once (config, personas, IA); the system generates, verifies, ships, and maintains docs autonomously. Human attention is pulled **only** for declared exceptions. Flags are exceptions, not supervision — if humans must review output, it's L3.

Standing tenet (founder, 2026-07-19): **minimize human review everywhere.** docstube's default
posture is autonomous with visible outcomes, never approval gates.

The ladder is **published publicly** as category-defining content ("the 5 levels of documentation autonomy"). Whoever publishes the scale defines the category; docstube claims the top: *"the only actual L4 — because you can't claim L4 when it doesn't work."*

**Honesty posture:** the L4 claim leads the marketing; the in-product surfaces stay honest that the
guarantee does not cover every use case. The **AssuranceProfile** — a versioned per-project
declaration of covered languages, claim classes, and evidence kinds — is the in-product honesty
mechanism. A planted-defect conformance suite is built and informs quality, but does not gate the
launch claim.

### 1.2 Mechanism: the claim ledger

L4 without verification is DeepWiki: confidently wrong, publicly distrusted (documented hallucinations: wrong build systems, invented architecture). **Deterministic checking is the technology that substitutes for human supervision.**

The unit of trust is the **claim ledger**: the writer emits, in the same task as the page, a
structured ledger of every factual claim — exact text anchor, claim class, proposed source
references. The kernel validates and anchors the ledger before verification runs. There is no
hidden denominator: a page's badge means **100% of its ledger claims are checked** with
class-appropriate evidence, and a deterministic coverage linter catches assertion-shaped prose not
covered by any claim, so ledger omission cannot manufacture "100% checked".

Trust vocabulary is **three orthogonal public axes** (the old proven / scored / out-of-domain
ladder is removed from all public surfaces):

1. **Correctness** — per claim: `checked | unchecked | contradicted`, always with the evidence
   kind (source grounding, predicate check, execution, owner attestation, project-defined check).
2. **Editorial** — per page: reviewed | not reviewed | issues ("AI-reviewed for *persona*" appears
   only when the review genuinely completed).
3. **Workflow** — per page: publishable | needs attention | blocked.

Correctness describes factual checking only; editorial review is a separate assessment axis and
never feeds the correctness state.

### 1.3 Accuracy doctrine

Nothing is 100%. The bar is the **human baseline**, which is measurably bad: 28.9% of popular repos document symbols that no longer exist; the average outdated reference has been wrong 4.7 years (Tan/Wagner/Treude, EMSE). Key asymmetry: human doc errors are mostly *staleness* (was true once); raw AI errors include *confabulation* (never true). The claim ledger plus deterministic grounding structurally eliminates the confabulation class; fingerprint-driven regeneration eliminates staleness. What remains is flagged.

`docstube audit` is the measuring device, and it ships honestly: in 0.1.0 it is a **stale
public-reference checker** for existing docs sites — pages scanned, identifiers checked,
missing/renamed references reported. Behavioral claims are excluded from the denominator; audit is
not marketed as an overall accuracy metric until claim-class predicate verifiers exist.
PROVISIONAL (trust-model-v2): the public defect metric is *defective claims / checked claims*, with
extraction coverage and unresolved counts reported separately — one claim, one outcome.

---

## 2 · Positioning & segments

- **Lead:** L4 is the category claim; verification is why anyone believes it (positioning option C).
- **Segments:** public product docs (free distribution engine: OSS, devtool/API companies) + internal engineering wikis (monetization: Cloud tier, "the wiki that can't be silently wrong").
- Explicitly NOT: API-reference-first (spec-compiled incumbents own it) and NOT help-desk KB. But **OpenAPI ingestion is v1** — public docs for devtool companies leak without it.
- **Business model:** MIT core free forever · Cloud tier later (§4.5) · Enterprise self-hosted later.
- **GTM wedge:** `docstube audit` on famous OSS repos → published stale-reference reports → offer to fix.
- Never claim "zero hallucinations." Always: "flagged, never silently wrong."
- **Privacy statement (standardized copy):** "docstube does not receive your source; the AI
  provider you configure receives the context required for generation." A transport data-flow
  table is generated from the transport registry.
- **Release posture: keep broad scope, label honestly.** 0.1.0 keeps TS + Python (+ Java) and the
  wide advertised surface, but every capability below full assurance depth is marked **preview**.
  A three-state **support matrix** — `supported | preview | unavailable` — is generated from the
  actual registries and consumed by the website, wizard, doctor, and Action validation. Assurance
  claims are scoped to supported surfaces; preview features are explicitly outside them.

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

Block-type taxonomy rule: **open enum, not a closed union.** Block types derive from (a) a small set of core primitives and (b) the component registry — each registry component with a Zod metadata schema is a block type. Since components are pluggable (§3.4), plugins can add block types; the entity model MUST support this (per-type Zod metadata, no hardcoded union).

One schema, four consumers:

1. **Provenance/evidence** — every entity links to the sources and checks that ground it (§3.2).
2. **Trust state** — every claim carries its correctness state + evidence kind (§1.2).
3. **Feedback anchoring** — the review UI selects these same entities to attach feedback.
4. **Regeneration granularity** — dependency records map symbols → entities. **Page-level
   regeneration is the explicit 0.1.0 scope**; the ledger anchors claims to blocks so block/section
   granularity stays possible later, but that machinery is not built now.

Entity IDs carry a **locale** dimension (i18n is 0.1.0). A **version** dimension is reserved in
the address shape for the v1.x versioning release (§4.2); 0.1.0 documents `latest` only.
Code-example entities support **language variants** (multi-language samples are v2 but the model
supports them now).

**Claim anchors are inline markers in the MDX** — a lightweight `<Claim id>` component around the
asserted span. Anchors cannot drift through diff-edits, translation units inherit claim refs, and
inline citations render straight from the markers. Because claims are inline components, **every
page also emits a clean pure-Markdown twin** (per-component `renderToMarkdown`, §4.1 site spec).

**Identity under ambiguity — the threading hybrid.** Trust state is NEVER carried by matching:
correctness and evidence recompute every run (the invariant that makes continuity safe). On
regeneration: confident match → ID and human threads (feedback, flags, review history) carry;
ambiguous match → ID carries *for threading only* and every carried human thread gets a drift
marker ("content changed substantially since this was written", one-click detach), with matching
confidence recorded on the shard; no plausible match → new ID, and the old entity's threads
surface as orphans for re-attachment or dismissal.

### 3.2 Claims, evidence & trust states

- **Claim classes** determine what "checked" requires. Notable classes: `code-structure`
  (existence/shape of a named API or config field — the class formerly called `structural`;
  page-structure quality is never a claim), value/behavior ("defaults to 3", "throws on
  timeout"), intent/history.
  - *Shape claims*: grounding against the codemap suffices — the identifier's existence is most
    of the assertion.
  - *Value claims*: 0.1.0 ships a **minimal value-predicate verifier** (founder decision,
    2026-07-21): the claim's asserted value is normalized and compared against the value
    fingerprints the typed fingerprint ladder already extracts per symbol — match → `checked`,
    mismatch → `contradicted` (a caught lie). This makes the full badge honestly achievable at
    launch instead of rare.
  - *Behavior claims*: grounding confers only `source-linked` (subject real, assertion
    unchecked); they count as **checked** when snippet execution exercises the behavior or, from
    v1.x, when richer predicate verifiers pass (execution assertions, schema validation).
    Grounding failures (missing identifiers) are hard defects for every class.
  - *Intent/history claims*: a recorded maintainer answer (**owner-attested**, with authorship +
    timestamp in the evidence record) is legitimate evidence and counts toward 100%; the UI
    distinguishes attestation from mechanical checks.
- **Citations are inline per claim.** A claim's evidence (source span, passed check, or
  attestation) attaches to the claim itself. The flat page-footer sources list is removed; a
  collapsed "Files consulted" disclosure survives, labeled as lineage — explicitly not evidence.
- Symbol-level grounding uses **normalized symbol hashes** over the codemap — never identifier
  *names* (the stale-naming hallucination class). Bias rule: when provenance is uncertain,
  regenerate or flag — never assume.
- PROVISIONAL (trust-model-v2): unresolved claims carry explicit **dispositions** —
  `not-applicable`, `no-checker-available`, `maintainer-input-needed`, `owner-attested` — derived
  from claim class + verifier availability, replacing the old out-of-domain bucket.
  `no-checker-available` claims do not block auto-merge; they surface as a coverage disposition.
- PROVISIONAL (trust-model-v2): plugin verifiers do not mint the built-in badge status; their
  evidence is labeled **"project-defined check"** unless explicitly promoted in config.
- PROVISIONAL (trust-model-v2): provenance records split into GenerationLineage / Dependencies /
  ClaimEvidence / Assessments; reader surfaces read ONLY ClaimEvidence.

### 3.3 Verification gate, autonomy & CI

- **Auto-merge by default.** All deterministic gates green + no blocking flags + no guarantee
  downgrades → the docs PR merges without a human. This is the product's honest L4 posture.
- **Kernel-owned fail-closed PublicationDecision.** `docstube generate --ci` emits one typed
  artifact (schema/tool version, base + source SHA, candidate hash, execution state, plan counts,
  gate result, regressions, `publishable`, `autoMergeEligible`, reason codes) bound to the
  candidate tree. The GitHub Action validates and enforces it; absence, mismatch, missing shards,
  deferred work, or unknown reason codes **fail closed**. Frozen (budget-capped) runs report
  `publishable: false` — no mergeable PR until the plan completes (staged atomic publish, §3.5).
- **Commit boundary is an output-inventory allowlist:** the reconciler emits an exact inventory
  with hashes; the Action stages only declared paths, reports undeclared writes, and marks the
  candidate ineligible on any mismatch.
- **Guarantee-downgrade detection is semantic:** a kernel-produced base-vs-candidate **ledger
  comparison** (badge loss, disposition regression, checked-count drop without deletion,
  evidence-authority weakening, attestation loss). Editorial/assessment changes report separately.
- **Debt policy: no new debt.** New blocking conditions block; pre-existing conditions block only
  changes in their own scope; regressions always block; unrelated fixes merge with debt visible.
  Dismissals are **recorded waivers** (actor, reason, scope, optional expiry; invalidated when the
  claim materially changes).
- **Auth honesty:** full-auto mode requires a GitHub App/PAT + a supported branch policy; with
  plain `GITHUB_TOKEN` the mode is labeled **approval-assisted**. `docstube doctor --ci --json`
  preflights transport auth AND all GitHub permissions/settings **before any model spend**.
- **One supported reusable workflow:** concurrency set before the job, invokes only
  `generate --ci`, least-privilege permissions documented, Action + CLI pinned as one unit. Stale
  queued runs coalesce.
- **Flag queue** — the triage surface for exceptions only (never page-by-page approval). Distinct
  from the **review UI**, the interactive feedback surface. Blocking flag kinds in 0.1.0:
  coverage failure, guarantee downgrade, CI structural change, system. Tribal-knowledge questions
  and translation failures are **non-blocking by design**; structural-quality findings are
  **always non-blocking** in 0.1.0 and never enter the flag queue (§4.1). Unrun editorial reviews
  are non-blocking: the page publishes with the "AI-reviewed" label withheld; reviews that ran
  and found required criteria not-met still block.
- Comment hygiene: PR marker comments upsert even when the last flag clears; flag lines carry
  new-vs-existing status and links.
- The configurable **policy engine is v2** (§4.4). There is no reserved `autonomy` config block —
  reserved-but-ignored config is a fake affordance and is removed.

### 3.4 Plugin kernel

```
KERNEL (trusted core): pipeline orchestration · entity model ·
                       claim ledger · evidence · gates · publication decision
EVERYTHING ELSE = PLUGIN: verifiers · language packs · content sources ·
   importers · search providers · theme components · structural checks
```

- **First-party features consume the same plugin API third parties get** (dogfooding keeps the API honest). Built-in verifiers and language packs are architecturally plugins.
- **`plugin-authoring` skill ships with the product**: the user's own coding agent writes a working plugin in minutes → long-tail coverage + shareable plugins → network effect.
- Plugin API is marked **experimental until 1.0** (semver-stabilized after), so early refactors don't kill the ecosystem.
- Plugins declare **capabilities and writable roots** in a manifest (npm-style trust posture, consistent with agent-invocation sandboxing).
- Deterministic structural checks are pluggable (`host.structuralCheck`); AI structural assessment
  stays kernel-owned. Deployment adapters are **not** a 0.1.0 plugin surface (§4.1 "Ops").

### 3.5 Pipeline: `generate` is an idempotent reconciler

**One command.** `docstube generate` computes desired vs published state and does the minimal
work: first run = full generation; later runs = the affected set; interrupted or budget-frozen
runs continue automatically from staged work (no `--continue` flag — continuation is the
contract, terraform-apply style). There is **no separate refresh command** — that concept is
removed outright, with no deprecation alias. The wizard's final step and the GitHub Action both
just run `generate`. `docstube audit` stays separate. `generate --explain` gives a
**non-generative impact/cost preview** (what would regenerate and why, estimated cost) — an
inspection tool, not an approval gate.

Stage semantics (exact I/O schemas are architecture work):

1. **Codemap + typed fingerprints** — tree-sitter structural map; language packs emit
   **signature / cited-value / body fingerprints** per symbol; files no pack can parse
   (package.json, poms, README…) fall back to whole-file content hashing — never less safe than
   hashing, precision improves per file type. OpenAPI/AsyncAPI specs ingest as first-class sources.
2. **Reconcile** — ledger claims subscribe to the fingerprint kind they depend on (shape claims →
   signature; value claims → the specific value; body subscriptions rare). Fingerprint diffs +
   knowledge/feedback/config dependency records (§3.10) produce the dirty set.
3. **Context** — a typed, token-budgeted **PageContextPack** per page (purpose, primary persona,
   assigned symbols/topics, relevant signatures/tests/examples, neighbor-page summaries, source
   trust labels, declared omissions). The pack is **additive**: on-demand exploration always
   remains available, packs declare what they omitted, and a badly built pack may degrade a page
   but must never wall the writer off from the repository. (Founder-flagged HIGH-RISK contract.)
4. **Write** — **one writer per page, always** (no section fan-out/assembler). The writer emits
   MDX with inline `<Claim>` markers plus the structured claim ledger in the same task; the
   kernel validates and anchors the ledger before verification. Invalid, truncated, or unanchored
   ledger output is a coverage failure that blocks the full-page badge. A deterministic coverage
   linter detects assertion-shaped prose not covered by any claim.
5. **Repair path** — an invalidated page gets a **diff-aware minimal edit task** (prior page +
   relevant code diff + the stale claims) instead of full regeneration; escalates to full
   regeneration when the edit fails verification or structure changed.
6. **Verify** — deterministic verifiers assign per-claim evidence; **one evidence-fed risk critic
   per page** receives the claim/evidence summary (not the raw repo) and hunts what the ledger
   structurally cannot catch: misleading framing, dangerous omissions, wrong emphasis.
7. **Review** — the **primary persona's** review gates the page (audience fit + brief conformance
   only — correctness left persona reviews). Secondary personas run as advisory reviews on a
   sampled subset; `refine` may act on their findings.
8. **Structure pass** — over the staged canonical site; emits non-blocking structural findings
   (§4.1 "Structural quality").
9. **Localization phase** — separate phase after canonical source generation, own budget
   partition (§4.1 "i18n").
10. **Gate & staged atomic publish** — pass → stage. When a run freezes (cost or plan-usage cap),
    completed work persists internally (journal + cache; nothing re-billed on resume) but
    **nothing publishes until the whole plan completes** — the site never shows a half-applied
    source change. The next `generate` resumes and publishes atomically.
11. **Assemble** — self-contained Astro + React site written into the user's repo (no runtime
    dependency on docstube); canonical machine corpus + projections (§4.1 "Site").

Cross-cutting: long runs are **resumable** (journaled in `.docstube/runs/`); budget is
**admission control over durable reconciliation** — the plan is persisted before agent calls,
per-page-family reservations come from historical usage, work units that don't fit aren't
started, staged work persists across workflow runs, rolling repo-level daily/weekly ceilings for
API billing, per-vendor windows and reset timestamps preserved for subscriptions. Agent calls are
cached by prompt+input hashes with record/replay in CI (§3.6).

**`refine`** stays an explicit, separately budgeted command — the "make the worst pages better"
intent: ranked by open auto-repairable findings (impact-ordered), then primary-persona `not-met`
criteria, then staleness. A reroll is **accepted only under the Pareto gate** — at least one
target finding resolves or a criterion flips to met, and nothing regresses (no new blocking
finding, no claim loses evidence/anchor, no disposition or criterion regression) — otherwise
discarded byte-for-byte with the reason journaled. Rejections are reported as the guardrail
working. Never makes a page worse.

Release economics SLO (PROVISIONAL, to validate on the dogfood repo before 0.1.0): a typical
single-symbol commit regenerates ≤ 5% of pages p50 / ≤ 15% p90 once typed fingerprints land; a
body-only refactor regenerates 0.

### 3.6 BYO-AI (retained)

Official codex / claude CLIs, or direct API keys with provider presets and custom OpenAI-/Anthropic-compatible base URLs (this covers Ollama/local models — MUST be tested and documented, strong OSS demand). Google's Antigravity CLI (gemini-cli's replacement) stays internal/experimental — an upstream bug drops subprocess stdout — so the public v1 transports are claude-cli, codex-cli, anthropic-api, and openai-compatible. docstube servers never receive source, prompts, docs, paths, or project names. Non-interactive agent invocations, declared writable roots, cache by prompt+input hashes, record/replay in CI.

Harness posture (product-level): **codemap-backed evidence tools are the primary exploration
surface** (semantic symbol search/read, example/test lookup, snippet and draft preflight), with
the generic read tools kept as escape hatches; all content-bearing tool results emit evidence
handles. **Generated output is excluded from agent read roots** — prior content enters only
through explicit labeled channels (the prior version of the *same* page for diff-edit repair;
neighbor-page summaries in the context pack). PROVISIONAL: the prior-docs access policy is
settled by the eval queue (§4.1 "Evals"), not by argument.

### 3.7 Cloud ↔ client contract

Designed in v1 (API shape, auth, what syncs — and what never syncs: source, prompts, docs content). Hosted at launch: **account registration + waitlist/interest capture only.** Everything else is local + GitHub Action.

### 3.8 Failure-mode taxonomy (private)

Internal spec, v1: every failure class → detection mechanism → resulting trust state. Verifiers and flags are organized around it. Classes include: factual claims, code samples (compile + runtime), structure (links, orphans, duplication), audience/quality, omission/coverage, tribal knowledge, system-level (build-system misidentification, partial coverage on large repos, model output-format failures, provider-capability mismatch). **Kept private** (acquirer value). The telemetry/classification of real user errors is v2 with hard privacy design (§4.4).

---

### 3.9 First run, local UI & wizard

#### 3.9.1 Entry: bare `docstube` is context-aware
No config → opens the browser directly into first-run setup; config present → opens the
dashboard. TTY-safe: non-interactive shells print the URL instead; `--no-open` is always
available. The UI is a single-page localhost web app (not a TUI). Surfaces: setup wizard ·
generation dashboard · review UI · flag queue. Keystones: the **NavTree** is one component reused
across all surfaces (IA editing → progress → review navigation); **no node-graph pipeline canvas**
(considered, rejected).

#### 3.9.2 Setup wizard: four adaptive phases over an onboarding session
The wizard works over an **onboarding-session draft** — autosaved, functional *before* committed
config exists; agent-backed setup steps accept the draft directly. Four phases (details behind
progressive disclosure: components, theme tokens, per-role models, locales):

1. **Scope** — project context (extracted from README/manifest — extracted, never generated),
   docType archetype + the explicit fields it fills (§3.9.5), personas with per-page primary
   persona defaults, optional sources (OpenAPI/AsyncAPI; existing docs as reference context via
   importers — claims unverified until re-grounded).
2. **Agent & budget** — provider detection finds installed CLIs and credential env vars; exactly
   one viable provider → **preselected with visible rationale** ("Claude CLI — installed, logged
   in") plus a tiny live preflight call so auth failures surface in setup, not mid-run; multiple
   viable → explicit choice with comparison; docstube never silently ranks one subscription/API
   over another.
3. **Docs plan** — segmented control of agent-generated IA proposals with one-line rationales +
   editable NavTree (drag reorder/reparent, inline rename, add/remove; selecting a node shows its
   **page brief**, which seeds the writer; any edit forks to "Custom"). IA nodes carry a
   **primary persona** (wizard infers defaults: getting-started → newcomer persona,
   plugin-authoring → integrator; hand-editable). Theme ("Design it here" token editor with live
   miniature preview, or "Match my existing project") and site metadata live here behind
   disclosure.
4. **Generate / preview** — **the estimate IS the Generate button**: it shows the work plan
   (pages × tasks × locales × retries) and the cap in transport-appropriate units — dollars for
   API billing, **plan-window percentage** for subscription CLIs, tokens/time for local models.
   Dollar figures never appear when a plan signal exists; this copy gets first-class UX
   attention. First click = approval; later runs are governed by the cap without re-asking.
   Generate atomically preflights, commits config, runs the pipeline, emits the site, and lands
   on the live preview.

Pre-fill is a **deterministic detection engine** (<1s, no agent calls: manifest/README/OpenAPI/
framework sniffing) — confident detections pre-fill, ambiguous fields stay blank. The engine is a
shared module (also serves `doctor`, `audit`, language-pack detection).

#### 3.9.3 Generation dashboard
Principle: **"the waiting room is the review room"** — finished pages stream in reviewable while the run continues. NavTree in progress mode (`queued → writing → checking → judging → retrying → passed / flagged`, findings counts, per-page cost, live over WebSocket). Per-page **CI-style step timeline** (each step expands to the actual agent output, reviewer criteria results, deterministic-check results, retry diffs) — a **pure renderer over SQLite job/findings state**: identical after resume. Live preview pane renders real production output as pages land. Cap-freeze banner: frozen work is staged, publish waits for plan completion (§3.5).

#### 3.9.4 Review UI
Production-rendered preview. **Feedback anchors to entities** (§3.1): element/block, section, page, whole-docs — addressed by stable entity IDs. Feedback handling is governed (§3.10). Actions per page: regenerate · approve — **approval is never a shipping gate** (auto-merge default, §3.3); required human attention lives only in the flag queue.

#### 3.9.5 Config & round-trip
`docstube.yml` at repo root = single source of truth, **intent only**. The wizard is one editor among others: reads → pre-fills → writes back through a **comment- and formatting-preserving YAML document API** (hard requirement — hand annotations must survive). Config shape = Zod schema → generated JSON Schema, shipped + registered on SchemaStore; same Zod validates at runtime with human-readable errors. Everything is files ⇒ **an agent can configure a project end-to-end without the wizard** ("IaC for docs"). **Secrets never in config** — env/keychain only. No reserved-but-ignored config blocks — every field in the schema does something.

**docType is a preset layer, not a control layer.** The enum is a richer archetype set covering
real repos (library, cli-tool, framework, saas-product, self-hosted-app, api-service,
internal-tooling, monorepo-mixed — final list at implementation) with multi-signal detection
(exports, bin entries, frameworks, README shape, publish state — never just repo privacy). The
archetype fills **defaults** for the explicit, overridable fields that actually drive behavior —
`visibility` (public | internal docs), `productKind`, `coverage`, suggested personas. The pipeline
branches only on the explicit fields; docType remains the one-word shorthand for prompts and UX.
The wizard shows the inference with evidence and explicitly asks the one thing code can't reveal:
**"are the docs public?"** (kills the private-repo→internal-docs misclassification).

#### 3.9.6 Cross-cutting UI principles
Explainable quality scores (criteria results + deterministic outcomes + finding severity; never an opaque number). Resumability first-class (timelines are pure SQLite renderers). PostHog opt-out telemetry with the strict never-send list.

### 3.10 Knowledge & feedback

**Tribal knowledge has durable semantic identity: KnowledgeNeed + KnowledgeFact.** Needs and
Facts are records with stable IDs, authorship, status, and supersession (replacing
question-text-hash files). Dedup key = **subject + kind-of-missing-fact (slots)**; text similarity
only *suggests* merges in the queue, never silently discards. Facts bind to code two ways: the
durable entity thread (identity threading, §3.1 — survives refactors, no re-ask) plus the
answer-time revision fingerprint (material change → `needs-revalidation`: pages flagged, ONE
targeted re-ask). Committed knowledge is a public data format at release. Capture is
**non-blocking**: generation never waits — flag + proceed.

**Auto-answer agent.** Before any human is interrupted, a researcher-role agent with its own
harness and budget partition attempts the answer: deeper code research plus web search when the
subject is external (platform limits, third-party behavior). Rules: AI-produced facts carry
`origin: ai` and MUST cite evidence (source URL or code refs) — rendered as cited external facts,
**never "maintainer-attested"**; an uncited confident answer counts as failure and escalates.
Needs are classified external-world / derivable (auto-answerable) vs **intent-policy (human-only —
AI never invents project intent)**. Escalated questions carry the auto-answerer's research so
humans answer faster. Web search only on transports that support it; external facts also flip to
needs-revalidation (revalidated when citing pages regenerate — no crawler in v1).

**GitHub is an actionable answer surface.** The Action posts open questions as a comment thread;
replies from users with repo write access using an explicit **`/answer` convention** are ingested
as attributed answers on the next Action run (pull-based — no webhooks or bot infrastructure).
CLI and local-UI answering remain.

**Answers/feedback causally invalidate exactly their pages.** Every generation unit records
IDs+hashes of consumed knowledge facts, instructions, criteria, glossary entries, and config/IA
fragments; changing any marks exactly the dependent units dirty. The moment a maintainer answers
a question or accepts feedback, a diff-edit task runs on exactly the affected pages —
answer-to-effect in minutes, no dirty queue. Answers move `answered → propagation-pending →
applied` with visible status ("answer saved; 2 pages regenerating"). Broad-scope changes produce
an explicit budgeted backlog, never silent waiting.

**Feedback storage is governed.** Immutable FeedbackEvent records first; categorization emits
typed, scoped proposals (intent, scope, affected consumers, canonical wording, confidence) that
may route to multiple consumers (one rule can feed both writer instructions and review criteria).
**Entity/page scope by default, applied immediately; project-wide promotion is an explicit user
choice.** Learned criteria compose with built-ins (never replace them); glossary feedback writes
through the typed glossary editor. **Config-category feedback** ships as a validated YAML patch
preview via the comment-preserving Document API — a diff with one-click apply, never auto-applied
(config is the user's hand-owned file).

### 3.11 State model (committed vs local)

**Committed, travels with the repo** (the lockfile pattern — derived state committed for
determinism and branch-correctness): `.docstube/manifest/` shards, config family,
criteria/instructions, knowledge records, structural findings, the generated site.
**Machine-owned committed state is canonical sorted-key JSON** (compact, byte-stable when content
is unchanged → minimal diffs); the human surface is the **semantic delta rendered in the PR
summary** ("page X: 3 claims re-verified, 1 added; de: stale→ready"). Human-owned files
(`docstube.yml`, `ia.yml`, glossary, criteria, instructions) stay YAML. **Local, rebuildable,
never committed:** `db.sqlite` (a derived view, rebuilt from manifest + repo), `cache/`, `runs/`
(in CI, run journals upload as Actions artifacts). CI flow: checkout → fingerprint diff vs
committed manifest → reconcile affected → PR carries docs + manifest + flags atomically, gated by
the PublicationDecision (§3.3).

**A docset IS an initialized directory.** docstube operates on the directory where it was
initialized: repo root → one docs site for everything; per-package docs → run init inside that
package. No multi-docset machinery, no docset abstraction in config or state. Rule: an outer
project **excludes nested docstube project roots** from its own scope (no double documentation);
nested projects are otherwise fully independent. **Cross-project overview pages are an explicit
non-goal for v1** — docstube documents one repository; cross-repo aggregation waits for a real
design for cross-repo provenance and staleness.

## 4 · Feature spec

RFC-2119 keywords (MUST/SHOULD/MAY) used deliberately.

### 4.1 0.1.0 — ships at launch

**Verification & proof**

| Feature | Spec |
|---|---|
| Claim ledger + coverage linter | §1.2, §3.5. The writer-emitted ledger is the trust denominator; the linter blocks silent omission |
| Extended deterministic verifiers | MDX compile + component props, tsc, pyright, javac, import/path resolution, internal+external links, D2 render, glossary rules, frontmatter/IDs, API-ref consistency, shellcheck for bash blocks, JSON/YAML samples vs schema, config examples vs Zod/JSON-schema, curl examples vs OpenAPI spec, env-var existence, CLI flag validity. Claim-class **predicate verifiers** (default-value comparison, execution assertions) are the v1.x roadmap — until then value/behavior claims report `source-linked`/`no-checker-available`, honestly |
| Snippet runtime execution | Code samples MUST execute (doctest-style); compile ≠ works. **Execution counts as checked; the evidence records the environment fingerprint** (OS, runtime versions, `sandbox: none`). Sandboxed evidence supersedes when the OS sandbox ships (post-0.1.0) |
| Verified diagrams | D2 only. 0.1.0 scope stated exactly: **verified = syntax + node names checked against the codemap**; edge grounding waits for the relations graph (v1.x, with predicate verifiers). Layout: ELK default, dagre fallback, TALA opt-in only |
| `docstube audit` | **Stale public-reference checker** for arbitrary existing docs sites (Mintlify/Docusaurus/GitBook/MD/MDX): pages scanned, identifiers checked, missing/renamed reported; behavioral claims excluded from the denominator. The GTM weapon, framed honestly (§1.3) |
| Inline per-claim citations | §3.2; "Files consulted" is lineage, not evidence |
| Trust states | Three-axis vocabulary (§1.2) in shard + UI; no proven/scored/out-of-domain on any public surface |
| Coverage ratchet | Coverage is a **ratchet over explicit obligations**: `documented` requires a claim/entity reference (never a mere file read); statuses `documented · generated-reference-only · intentionally-omitted · not-public-for-docs · unassigned`; IA pages own source scopes so new symbols route to candidate pages; 100% absolute coverage is an opt-in release policy. Doc-type-conditional via the explicit `coverage` field |
| Verification badge | Static badge at launch; badge = 100% of ledger claims checked (§1.2); live endpoint is Cloud |
| AssuranceProfile + support matrix | §1.1, §2: versioned per-project assurance declaration; generated supported/preview/unavailable matrix consumed by website, wizard, doctor, Action |

**Autonomy**

| Feature | Spec |
|---|---|
| Auto-merge by default | §3.3. PRs annotated with the verified delta; fail-closed PublicationDecision; output-inventory allowlist; no-new-debt policy; recorded waivers; approval-assisted labeling under plain GITHUB_TOKEN |
| Flag queue | Exception triage only — never page-by-page approval |
| Knowledge system | KnowledgeNeed/KnowledgeFact + auto-answer agent + `/answer` GitHub ingestion + immediate targeted regeneration (§3.10) |

**Generation quality**

- Primary-persona gating (§3.5) — one gating review per page; secondary advisory/sampled; one evidence-fed risk critic per page.
- Depth/page-count policy — IA-level control of granularity.
- Anti-slop prose lints — deterministic style checks (banned AI-isms, repetition, sentence-variance).
- Changelog generation — same verified pipeline over git history; optional "why" via user-owned MCP sources (Jira/Linear).

**Structural quality** (the founder's cross-page consistency feature — supersedes the old
claim-contradiction "topology pass" framing)

- The real failure modes are **structural**: within-page (two sections covering the same topic,
  examples in the wrong section) and across sibling pages/navigation (5 of 8 "compute resources"
  pages have a Pricing section, 3 don't). Not lie-grade — quality a human would spot.
- Committed **StructuralFinding** records (stable semantic key, code, entity|nav-group scope,
  detector deterministic|ai-assessed with id/version/model, impact, status
  open|resolved|suppressed, evidence, repair targets, scope fingerprint) — separate from verifier
  results, flags, and the claim ledger. A dedicated structure pass over the staged site builds a
  **StructuralSnapshot**; deterministic detectors emit candidates; targeted AI assessment
  adjudicates applicability; within-page judgment rides the single risk critic.
- **Flagship detector:** sibling shared-facet asymmetry (outline matrix → ≥60% threshold summons
  the group assessor → per-missing-page expected | not-applicable | uncertain → one group finding
  targeting only 'expected' pages). Plus deterministic outline integrity and within-page
  duplicate-section / misplaced-example candidates. A planted eval ships.
- Evidence ladder: explicit ia.yml rule → deterministic finding; accepted profile →
  deterministic; AI-derived plan conformance → labeled AI-derived; inferred sibling convention →
  candidate only + per-page AI applicability; uncertain → no finding. Conservative 0.1.0
  candidate rules: cohort ≥ 4, same profile, source locale only, no inference across mixed roles.
- **ALL structural findings are non-blocking in 0.1.0** (even explicit-rule violations). They are
  committed work items: dashboard/NavTree counts, review-UI anchors, a separate PR-summary
  section ("Structural quality: 3 open · nonblocking") — never the flag queue. Naming:
  "AI-assessed structural inconsistency", never "verified defect". No reader-facing structure
  affordance on the site. `refine` consumes them under the Pareto gate (§3.5).

**Site & agent-readiness**

- **Canonical machine corpus, everything else a projection:** one corpus with resolved IA/routes,
  page/entity IDs + revision, locale + publication state, normalized Markdown (via per-component
  `renderToMarkdown`), claim ledger with dispositions, optional evidence detail. Projections:
  llms.txt (discovery map) · per-page `.md` twin at every doc URL (normalized content + minimal
  trust metadata) · llms-full.txt (only under a documented size threshold, else split by IA
  section) · MCP as a query/read adapter.
- **MCP posture 0.1.0: local repository tool** (consistent with deployment = local artifact).
  Honest tools — `search_docs`, `read_page`, `read_structure` — over a precomputed index;
  ready-to-paste client config emitted. A public MCP endpoint waits for a deployment adapter.
- **Every theme component contracts BOTH `renderToHTML` and `renderToMarkdown`** — the Markdown
  twin is the agent/human plain channel and applies to all components, not just Claim.
- **Reader trust UX:** chip **"Verified · 23/23 checked"** — brand word + literal denominator;
  green reserved for 100%; partial pages show "18/23 checked · 2 issues" without the brand word;
  separate rows for "AI-reviewed for *persona*" and translation fidelity. Click → popover:
  denominator, evidence mix, unresolved dispositions, last-checked commit/date, definition of
  "checked". Positive section chips disappear (exceptions only). A generated `/verification/`
  trust-report page ships (methodology, coverage, unresolved issues). **Evidence UI: quiet
  default, loud exceptions** — checked claims visually quiet (hover/click popover + page-level
  "show evidence" toggle); unchecked / contradicted / needs-input claims always visibly marked.
  Private repos default to link/path-only evidence; excerpt embedding is policy opt-in.
- **Navigation: the emitter consumes ia.yml** — a resolved nav tree (group|page kind, route,
  ancestry, per-locale availability, active state, prev/next, exception markers) replaces
  slug-prefix reconstruction. The `sectioned` layout is removed for 0.1.0 — one excellent nested
  layout (collapsible groups, real home page, breadcrumbs, prev/next, related links); tabs return
  later as another rendering of the same tree. Locale routing goes through one route matrix
  (pageId × locale) resolving to ready | stale | source-fallback | unavailable with
  reader-visible explanations.
- **Search is an emitter-owned contract:** `data-pagefind-body` on the article only;
  nav/TOC/proof-chrome/footers ignored; metadata (pageId, IA section, locale, publication state);
  default locale-scoped with an explicit all-languages mode; source-fallback pages excluded from
  localized coverage; breadcrumbs + section excerpts in results. Pagefind baseline (world-class
  custom search is Cloud).
- AGENTS.md emitted and kept fresh. Retained: sitemap/canonical/OG/structured data; FAQ/AEO
  guidance; footer credit default-on, disableable.
- **Versioned docs are CUT from 0.1.0** — `latest` only; no cut command, no switcher, no frozen
  shards. The complete snapshot lifecycle ships whole as a v1.x headline (§4.2). Config keeps
  `versions.current` for forward-compat.

**i18n — ships in 0.1.0** (founder call, explicitly kept)

Translations are **always AI-generated by the pipeline** — no human translation workflow exists
or is planned.

- **Partial locales serve source fallbacks:** an untranslated or failed page renders the fresh
  source content under the locale route with a visible "not yet translated" banner; nav shows
  everything with untranslated pages marked; stale-but-verified translations stay reachable with
  a "content updated since translation" warning. No 404s, no hidden locales.
- **Translation assurance = one bilingual fidelity review per page-locale revision** (meaning
  preservation, omissions/additions, negation/quantity changes, terminology, claim anchors
  against normalized source units). Persona reviews are inherited from source, never rerun per
  locale. Same-model fidelity review is acceptable (the assurance record notes the model). One
  correction cycle on failure, then fallback.
- **Two-dimension proof UI:** source correctness (language-independent) and translation assurance
  (fidelity-reviewed / pending / fallback) are separate dimensions, never collapsed.
- **Strict isomorphism:** locales are renditions of one canonical structure — same entity and
  claim IDs, localized anchors, code blocks byte-identical by construction; the canonical claim
  ledger lives in the source locale. No locale-specific content in v1.
- **Translation failures are non-blocking for auto-merge:** failed page-locales serve the
  fallback, report as a localization-coverage finding ("49 ready · 1 failed"), and never hold a
  source correction hostage. Persistent failures dead-letter (retried on content/glossary/policy/
  model change or on request).
- **Terminology profiles: auto-committed, no human gate.** Adding a locale bootstraps a committed
  per-locale terminology profile (translate-to / keep-source / forbidden variants per glossary
  term) in two one-time calls; entries carry `origin: ai`, user edits carry `origin: user` and
  win permanently.
- Cost model: 2 model calls per page-locale initially (translate batch + fidelity), 0 for
  unchanged pages; code-only changes cost zero localization calls.

**Inputs**

- **OpenAPI/AsyncAPI ingestion** as first-class source next to code (enables curl/endpoint verification; unlocks API-company public docs).
- **Migration importers as context**: Mintlify / GitBook / ReadMe / Confluence → reference context (tone, structure, tribal knowledge). Imported claims are **unverified until re-grounded** against source. Never as-is migration.

**Scale & languages**

- Language packs shipping v1: **TypeScript, Python, Java** — with the support matrix labeling any
  below-assurance-depth surface as **preview** (§2). Language-pack plugin interface designed for
  Go/Rust/C#/PHP (post-v1 in that order).
- Monorepo model: **docset = initialized directory** (§3.11); no multi-docset machinery.
- Large-repo hardening (⚠ design doc required): token budgets, chunked codemaps, partial coverage as **declared state**, never silent truncation.

**Ops & distribution**

- **Deployment: local artifact only for 0.1.0.** docstube stops at the built static site; a
  first-class **"Deploying" docs page** covers GitHub Pages / Netlify / Vercel / S3 patterns. No
  deployment surface is owned or maintained; no first-party deployment adapters ship. (The
  GitHub Action keeps docs current in the repo; it does not publish hosting.) Site auth therefore
  belongs to the user's hosting; SSO is Cloud.
- CLI: bare `docstube` (context-aware, §3.9.1) · `generate [--explain|--ci|--fresh]` · `refine
  [page] [--max-rounds]` · **`audit`** · `validate` · `check` · `status` · `doctor [--ci --json]`
  · `upgrade [--check|--to]` · `plugin` (scaffold via skill) · `help` · `version`. `check` kinds
  MUST derive from registered verifier plugins (open enum, §3.4) — not a hardcoded list.
- Config: docstube.yml (typed, comment-preserving) · ia.yml (schema v2: explicit `group | page`
  kinds, stable groupId, primaryPersona, optional structureProfile / consistency rules /
  structuralExceptions; AI-derived profiles are derived state — ia.yml holds only user intent) ·
  glossary.yaml · `.docstube/` (manifest shards, criteria, instructions, knowledge, db.sqlite,
  cache, runs) · plugin manifests.
- npm package + standalone binaries. PostHog opt-out telemetry with strict never-send list.
- Minimal hosted: registration + waitlist.
- Autonomy ladder published as public content. Dogfood docs rebuilt reader-first before launch
  (reader jobs before implementation names); the dogfood site is the permanent screenshot.

**Evals**

- **The eval queue is a first-class deliverable:** policy questions that argument cannot settle
  get real experiments — a suite of ~10+ live end-to-end generation runs (real provider APIs,
  secrets-gated workflow, **never CI**) that A/B a policy and score outputs. First registered
  experiments: (a) prior-docs access policy (§3.6), (b) context-pack composition vs on-demand
  exploration balance. Plus the planted-defect conformance suite (§1.1) and the planted
  structural-quality eval.

### 4.2 v1.x — designed now, ships shortly after

| Item | Spec |
|---|---|
| **Versioned docs** | The complete lifecycle ships whole: current version live from HEAD, past versions frozen snapshots cut at release time; cut anytime — never waits on localization; snapshots record which pages fell back; **sealed + explicit repair** (`docstube version repair <label>` consciously backfills, recorded); new-locale backfill targets current only. Version is already an address dimension; the half-built cut/state code is parked, not deleted |
| Richer predicate verifiers | Execution assertions, schema validation, signature comparison beyond values — flips remaining behavior claims from source-linked to checked (§3.2; the minimal value-predicate verifier ships in 0.1.0) |
| Diagram edge grounding | Relations graph; extends 0.1.0's syntax + node-name checking |
| Sandboxed snippet execution | OS sandbox; supersedes environment-fingerprinted host execution evidence |
| Public MCP endpoint | After a deployment adapter exists |

### 4.3 v1 — architect-only (contracts now, ship later)

| Contract | Design now |
|---|---|
| Signed provenance manifest | Tamper-evident per-entity record {source, commit, check, state, signature} |
| Multi-language sample variants | Entity model supports variants (§3.1) |
| SSO / access-control hooks | In the Cloud contract |
| Remaining language packs | Go / Rust / C# / PHP behind the pack interface |
| Cloud contract | §3.7 |

### 4.4 V2 / fast-follow

- **Autonomy policy engine** (configurable auto-merge/exception rules; replaces the hardcoded
  0.1.0 rules; introduced as a real config surface when it ships — no reserved block before).
- **Failure-registry telemetry**: classify real user errors via the user's own AI; hard privacy design (classes + counts only, never content; visible opt-out).
- **Feedback → autonomous refinement**: cluster + threshold + auto-apply into instructions/criteria (removes the human from the learning loop).
- Non-code knowledge via user-owned MCP sources, generalized (any "why" source, with provenance).
- Multi-language code samples (one canonical example → verified per-language variants).
- Structural-quality deferrals: site-wide semantic duplication, nav-membership judgment,
  prerequisite flow, learned profiles, per-locale assessment, cross-page claim contradiction.

### 4.5 Cloud

World-class custom docs search (the assumed pillar; likely Stacktape-deployed) · cross-repo Ask agent · docs-gaps-from-MCP-queries loop · fleet docs-health dashboard · SSO/governance/audit · analytics (as a plugin) · Slack/Discord answer bot · Ask-AI site widget · live badge endpoint. Entry ~$10–15k/yr (open-core norm). Cloud integrates as **plugins** over the same API.

---

## 5 · Removed (decided against, with reasons)

| Item | Reason |
|---|---|
| `refresh` as a command | `generate` is the idempotent reconciler; a second maintenance verb was a duplicate concept. Removed outright, no alias |
| Versioned docs in 0.1.0 | Cut whole to v1.x (§4.2) rather than shipped half; latest-only at launch |
| `sectioned` layout | One excellent nested layout for 0.1.0; tabs return later as another rendering of the same nav tree |
| Reserved `screenshots` config object | Fake affordance; screenshot capture stays out of scope with no config stub |
| Reserved `autonomy` config block | Fake affordance; the policy engine introduces its config when it ships (v2) |
| proven / scored / out-of-domain as public vocabulary | Replaced by the three-axis trust vocabulary + dispositions (§1.2, §3.2); the ladder conflated correctness with editorial review |
| Post-hoc claim extractor for generated pages | The writer emits the ledger; extraction survives only inside `audit` for foreign docs |
| Per-persona review multiplier | Primary persona gates; secondary advisory/sampled; correctness left persona reviews entirely |
| Flat page-footer sources list | Inline per-claim citations; "Files consulted" is lineage, not evidence |
| "Defects per 100 claims" audit framing | Gameable denominator; audit reframed as stale-reference checking, defect rate over *checked* claims (PROVISIONAL) |
| Question-text-hash knowledge files | Replaced by KnowledgeNeed/KnowledgeFact records (§3.10) |
| First-party deployment adapters (incl. GitHub Pages integration) | 0.1.0 stops at the local artifact + a "Deploying" docs page; no hosting surface owned |
| Section fan-out / assembler writer | One writer per page, always; revisit only with eval evidence |
| Dry-run / plan mode as a gate | `generate --explain` is a non-generative preview, not an approval step; PRs show the delta |
| One-command rollback | Git revert covers it |
| Flag-rate telemetry (as a feature) | Cut; flags are visible per-run anyway |
| "Was this helpful?" widget | Needs a backend; Ask-AI query mining (Cloud) is strictly richer signal |
| TALA as default layout | Proprietary licensing incompatible with MIT default |
| Public failure-mode registry | Kept private — acquirer value; audit reports carry the marketing |

## 6 · Boundaries (out of scope)

Screenshot capture (no config stub) · native UI screenshots · Mermaid (D2 only) · docstube-operated free hosting · deployment/hosting surfaces in 0.1.0 (§4.1 Ops) · cross-project overview pages (§3.11) · marketing website work · agent adapters beyond the built-in four (codex/claude CLIs + Anthropic-/OpenAI-compatible APIs) · hosted backend beyond registration/waitlist.

## 7 · Open design questions

Most of the original §7 questions are resolved in ARCHITECTURE.md and the
`knowledge/design/*-v2.md` decision records. Still genuinely open:

1. Final docType archetype list (fixed at implementation; the preset-layer mechanism is decided, §3.9.5).
2. Verifier capability declarations — the exact schema expressing claim-class obligations (direction set in §3.2; schema is architecture work).
3. Large-repo hardening — budgets, chunking, declared-partial-coverage semantics (design doc required).
4. `audit` claim extraction on arbitrary/foreign docs — parsing + matching approach (design doc `knowledge/design/audit.md` before build).
5. Prior-docs access policy and context-pack composition — **settled by the eval queue**, not by argument (§4.1 Evals).
6. Depth/page-count policy — full spec at wizard-IA implementation time.

## 8 · Metrics

- **Product metrics:** autonomous completion rate · interventions per 100 changes ·
  verified-claim coverage · maintenance latency · cost per page.
- **Audit metric:** stale public references found (pages scanned, identifiers checked,
  missing/renamed). PROVISIONAL: defect rate = defective claims / **checked** claims, with
  extraction coverage and unresolved counts reported separately.
- **Coverage:** the obligation ratchet (§4.1), conditioned on the explicit `coverage` field.
- Release economics SLO (PROVISIONAL): single-symbol commit regenerates ≤5% of pages p50 / ≤15%
  p90; body-only refactor regenerates 0.

## 9 · Decision log

### 2026-07 initial session

| Decision | Reasoning |
|---|---|
| L4 as design goal (overriding research rec of "L3 default + dial") | Founder call; credibility earned via failure-mode enumeration + verification, not via keeping a human gate |
| Positioning C: L4 vision + verification mechanism | L4 is the category claim; verification is why it's believable |
| Ladder public, registry private | Ladder = pure positioning; registry = engineering asset + acquirer value |
| Segments: public product docs + internal wikis; OpenAPI v1 | Research-confirmed whitespace; public docs leak without OpenAPI |
| Auto-merge by default | Honest L4 posture; exceptions hardcoded now, policy engine v2 |
| Unified entity model | One schema serves evidence, trust states, feedback, regeneration |
| Plugin kernel + authoring skill | Collapses plugin cost to a prompt; first-party dogfoods the API |
| `audit` handles arbitrary docs | The GTM play requires the hard version |
| v1 hosted = registration/waitlist only | Local-first launch, funnel open, no premature backend |
| Wizard-first onboarding; deterministic pre-fill | Humans set intent once upfront; agent inference too slow for pre-fill |
| State: manifest committed (lockfile pattern), sqlite never committed | Branch-correct provenance, backend-free CI, no binary merge conflicts |
| Tribal-knowledge capture is non-blocking | Blocking generation on human answers would reintroduce supervision |

### 2026-07-19/21 design-review adjudication (Sol review; binding, folded into this document)

Full decision records: `knowledge/design/trust-model-v2.md`, `i18n-lifecycle-v2.md`,
`pipeline-v2.md`, `release-scope-v2.md`, `harness-state-v2.md`, `dx-knowledge-v2.md`,
`quality-ci-reader-v2.md`.

| Decision | Record |
|---|---|
| Writer-emitted claim ledger; badge = 100% checked; class-appropriate evidence; editorial review a separate axis; inline citations; identity-threading hybrid; page-level regen scope | trust-model-v2 |
| Three-axis trust vocabulary; proven/scored/out-of-domain leave public surfaces; `structural`→`code-structure`; audit as stale-reference checker; support matrix; AssuranceProfile; L4 marketing stays with honest in-product copy | quality-ci-reader-v2 |
| `generate` = idempotent reconciler; refresh removed; staged atomic publish on freeze; typed fingerprint ladder + diff-edit repair; refine Pareto gate; `--explain` preview | pipeline-v2 |
| Versioning cut from 0.1.0 (v1.x whole); primary-persona gating; immediate targeted regeneration; deployment = local artifact only | release-scope-v2 |
| i18n stays in 0.1.0; source fallbacks; fidelity review; strict isomorphism; non-blocking translation failures; auto-committed terminology profiles | i18n-lifecycle-v2 + quality-ci-reader-v2 |
| Evidence tools primary; PageContextPack additive (HIGH-RISK); one writer/page; inline `<Claim>` markers; Markdown twin via renderToMarkdown; generated output out of read roots (PROVISIONAL, eval-gated); risk critic; unrun reviews nonblocking; docset = initialized directory; canonical-JSON manifest shards | harness-state-v2 |
| Context-aware bare `docstube`; four-phase wizard over onboarding session; provider preselect + preflight; estimate-is-the-button spend UX; docType preset layer; KnowledgeNeed/Fact; auto-answer agent; `/answer`; governed feedback; config patch preview | dx-knowledge-v2 |
| Fail-closed PublicationDecision; output-inventory allowlist; no-new-debt; coverage ratchet; waivers; auth honesty; one reusable workflow; structural findings all non-blocking; ia.yml schema v2; reader trust chip + quiet evidence UI; canonical machine corpus; local MCP; nav from ia.yml; sectioned removed | quality-ci-reader-v2 |

## 10 · Knowledge index

Research artifacts live in `knowledge/research/`; design decision records in `knowledge/design/`
(the `*-v2.md` files are the adjudicated Sol-review decisions folded into this document on
2026-07-21 — they remain decision records, not parallel specs).

1. `research/01-competitor-feature-mining.md` — competitor features, demand themes.
2. `research/02-segment-strategy.md` — autonomy-ladder × purpose competitor map, segment analysis.
3. `research/03-l4-feature-plan.md` — DeepWiki-ecosystem mining, L4-lens feature plan.

Pitch deck (`docstube-pitch-deck.md`) is a sibling artifact; keep claims consistent with §1–§2 (esp. "flagged, never silently wrong", no zero-hallucination claims).
