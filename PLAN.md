# docstube — Implementation Plan

> **Audience:** a coding agent (and human contributors) implementing docstube from scratch.
> **Status of this document:** the consolidated, decided plan. Items marked **⚑ default** were
> chosen by the planning process without explicit founder sign-off — implement as written unless
> overridden. Items marked **TBD** are intentionally not designed yet — do NOT implement them;
> only reserve the noted extension points.

---

## 1. What docstube is

docstube is an **open-source (MIT) CLI** — with a localhost web UI and a GitHub Action — that
reads a codebase and generates **verified, audience-targeted, always-current documentation**.

- A **writer agent** reads the actual source and drafts each page as MDX.
- **Reviewer agents** (one per user-defined persona) check fit for the audience.
- **Verifier agents** + **deterministic checks** (compile code samples, resolve imports, validate
  links/MDX/diagrams) fact-check it. Pages don't pass until they clear the gate.
- Output is a polished docs site (custom Astro + React theme) the user fully owns.
- When code changes, only affected pages regenerate (symbol-level provenance).
- It runs on the **user's own coding agents** — `claude`, `codex`, `gemini` CLIs using their
  existing subscriptions, or direct API keys — with configurable usage caps.

**Use cases:** internal engineering docs; external/library/product docs; LLM context
(`llms.txt`, MCP).

**Business context (affects architecture only at one seam):** everything in this plan is free
and MIT. A hosted paid tier (remote state, smarter semantic regeneration, team features) comes
later; the OSS core must define a clean provider seam for it (§13.4) but its internals are out
of scope.

## 2. Goals and non-goals

**Goals (this plan):** the full OSS product, built as one full-scope effort (§21 gives the build order): generation pipeline,
wizard + review UI, deterministic verification, incremental updates, GitHub Action, theme +
component registry, glossary, D2 diagrams, API reference extraction for TS/JS + Python,
llms.txt, evals, telemetry.

**Explicit non-goals / exclusions:**
- **Screenshot capture — TBD.** It WILL exist (agent-driven wizard that boots the user's dev
  server, drives it into states, captures via Playwright, replayable "capture plans",
  `storageState` auth, Storybook-story capture, form-state control + element-level clips,
  secrets isolation, image masking) but the exact mechanism is still being
  designed. **Do not implement.** Reserve only: a `screenshots:` key in the config schema
  (accepts an object, currently unused), a `Screenshot` component name in the registry namespace,
  and the principle that Playwright will be an optional, lazily-installed capability — never
  bundled into the binary.
- Hosted backend internals (only the client-side seam is specified).
- Additional coding-agent adapters beyond the four built-ins (e.g. open-weight-model CLIs) —
  **TBD**; the adapter registry and the open `agent` identifier (§8) keep this additive.
- Native-UI screenshots, versioned docs, docs i18n — out of scope.
- Mermaid — deliberately not supported; D2 is the single diagram dialect (§14.4).

## 3. Architecture overview

Four layers:

1. **Core engine** (`@docstube/core` + friends): CLI → Orchestrator (page-by-page durable state
   machine, resumable, cap-aware scheduler) → Agent adapters (official vendor CLIs + direct API)
   → Agent roles (writer / reviewer / verifier over a shared structured-findings contract) →
   State & provenance (SQLite + `.docstube/`) → Deterministic verifier registry → Incremental
   engine (StateBackend seam).
2. **Local control plane**: Hono server + Vite/React SPA (setup wizard + review UI), tRPC + WS.
3. **Output artifact**: user-owned Astro docs site; theme + component registry source is
   generated into the user's repo so the docs site is self-contained and deployable to any static
   host. docstube can later update that generated theme code without regenerating content.
4. **GitHub Action**: wraps `docstube update`; opens PRs with only the affected pages.

## 4. Monorepo & stack

| Area | Decision | Notes |
|---|---|---|
| Language / runtime | TypeScript on Node (current LTS) | |
| Package manager | pnpm workspaces **⚑ default** | + Changesets for versioning/release |
| CLI binary | `@yao-pkg/pkg` | GitHub/install-script distribution is standalone and does not require user Node |
| CLI startup | lazy-load command modules (dynamic `import()`); heavy deps never on hot path; `NODE_COMPILE_CACHE`; bundle with tsdown/Rolldown | "snappy CLI" requirement |
| DB | better-sqlite3 + Drizzle | revisit `node:sqlite` when stable |
| Schemas/contracts | Zod everywhere | config, agent I/O, registry props, tRPC |
| Config | **`docstube.yml`** (YAML) + generated JSON Schema | see §5; supersedes the earlier `docstube.config.ts` idea |
| Local server | Hono | |
| Local API | tRPC + WebSocket progress events | |
| Hosted seam | tRPC, frozen `v1` router namespace, `.d.ts` snapshot diffed in CI; plain JSON wire (no superjson) | oRPC is the documented fallback if discipline chafes |
| Web UI | Vite + React + Tailwind | |
| Docs output | custom Astro + React theme; Pagefind search **⚑ default** | |
| Diagrams | D2 via `@terrastruct/d2` (WASM; dagre/ELK; sketch mode) | build-time dep of theme pkg only (~200 MB); MPL-2.0 |
| Tests | Vitest; record/replay agent fixtures in CI; separate gated live+eval workflow | CI never calls real agents |
| Lint/format | Oxlint + Oxfmt | fall back to Prettier/Biome without ceremony if Oxfmt (alpha) bites |
| Telemetry | PostHog, opt-out, anonymous | §18 |

**Workspace layout.** Reusable/published units live in `packages/`; runnable surfaces live in
`apps/`.

**Packages** (`packages/`): `contracts` (S0 Zod schemas, shared types, IDs, result taxonomies,
and public contract snapshots), `core` (orchestrator, pipeline, config loading, state, local
server wiring), `agent` (intended future standalone package once the adapter contract is stable),
`verifiers`, `codemap` (tree-sitter structural map + language plugins), `extractors`
(API-reference extractors), `theme` (internal source for generated/ejected theme code), `skills`
(shipped SKILL.md sources).

**Apps** (`apps/`): `cli` (the published `docstube` npm package and binary entry source),
`local-ui` (Vite/React localhost control plane), `github-action`, and `web` (public marketing website). The `web` app is kept in
the workspace so shared tooling and dependency policy apply, but its implementation is handled
by another agent/workstream; product implementation agents should not spend project-build time
on marketing-web features unless explicitly assigned.

**Publishing policy.** Initial public npm publishing is intentionally narrow: publish `docstube`
only. Internal workspace packages stay private until a concrete external contract exists.
`@docstube/agent` is the likely next public package, but not before S0/S3 adapter contracts have
stabilized. The generated docs theme is vendored/ejected into user repos, so `@docstube/theme`
is not required as a public runtime dependency in v1.

## 5. Config: the `docstube.yml` family

Declarative, typed, machine- and agent-writable ("IaC for docs"). One source of truth, three
consumers:

1. **Zod schemas** in `@docstube/core` define every config shape.
2. **JSON Schema generated** from them, shipped in the package and registered on SchemaStore →
   editor autocomplete/validation with zero setup.
3. The **same Zod schemas validate at runtime** (`docstube validate`, and on every run) with
   precise human-readable errors.

**Hard requirement:** programmatic edits (wizard round-trip) use a comment- and
formatting-preserving YAML editor (the `yaml` package's Document API). The wizard reads
`docstube.yml` → pre-fills → writes back without destroying user comments.

Reference shape (illustrative, not exhaustive):

```yaml
# docstube.yml
docsType: external-library            # internal | external-library | external-product
site:
  title: My Project
  description: One-line tagline        # + logo, favicon, og-image, base URL (SEO/meta)
context: |
  Short free-text project context.
sources:                               # import / starting context — code stays ground truth (§9.1)
  reference:                           # → feeds docs writer + IA
    - { type: files, path: ./old-docs/ }
    - { type: files, path: ./openapi.yaml }
    - { type: git,   repo: git@github.com:acme/docs.git }   # Mode 2: private clone (token from env)
    - { type: mcp,   server: confluence }                   # Mode 1: user's own connector
  intent:                              # → feeds changelog "why" (offered, not forced)
    - { type: mcp,   server: jira }
    - { type: files, path: ./docs/adr/ }
personas:
  - id: junior-dev
    description: Mid-level dev, no AWS experience
agents:                                # agent ids are open — resolved via the adapter registry (§8)
  writer:   { agent: claude, model: opus }
  reviewer: { agent: codex,  model: gpt-5-mini }
  verifier: { agent: codex }           # verifier family MUST differ from writer by default
usage:
  cap: 80%                             # freeze threshold; approximate by design
layout: sectioned                      # single-tree | sectioned
theme:
  preset: default
  tokens: { accent: "#6c5ce7", radius: 8px }
components:
  enabled: [Callout, CodeGroup, FileTree, Diagram, ApiReference]
structure: ./docs/ia.yml               # references, not inlined
glossary: ./docs/glossary.yaml
output: ./docs-site                    # scaffolded Astro site dir
seo:
  siteUrl: https://docs.example.com    # enables canonical URLs + sitemap; meta/OG/FAQ on by default
changelog:
  range: tags                          # how to pick the version range
  sources: [{ type: mcp, server: jira }]   # optional "why" context (user's own MCP server)
# screenshots: {}                      # RESERVED — TBD capability, schema accepts object, unused
```

**In config:** intent only. **Never in config:** pipeline state, scores, provenance (→
`.docstube/` SQLite), generated MDX (→ content dirs), **secrets** (→ env / OS keychain, always).
Large declarative content-like files (`ia.yml`, `glossary.yaml`) are separate, referenced,
schema-validated files.

## 6. CLI & UX flows

Commands (citty + @clack/prompts):

- `docstube generate` — starts local server, opens the wizard (§7), runs the pipeline.
- `docstube generate --yes` — **zero-question mode**: infer doc type from repo signals, default
  persona, auto-pick the top IA proposal and default theme, straight to the dashboard. The
  first-contact path and the CI/dogfood path.
- `docstube update` — incremental run: resolve dirty pages → regenerate → report (used by the
  Action).
- `docstube validate` — config-family validation (deterministic; agent-runnable).
- `docstube check <d2|mdx|snippet|config> <file>` — single deterministic check; also invoked by
  agents from skills to self-verify (§9).
- `docstube telemetry <enable|disable|status>`.

All long runs are **resumable**: re-running continues from durable state; `--fresh` discards.
Pipeline progress streams to both terminal and web UI.

**Usage caps:** read the vendors' local usage logs (ccusage-style; depend on or vendor that
approach) to estimate remaining budget; **freeze** the pipeline at the configured cap and persist
a resumable state; surface clearly that the estimate is approximate (other account usage is
invisible; windows are rolling) and freeze with margin.

## 7. Web UI control plane

One SPA, three surfaces, sharing one keystone component: the **NavTree** — a multi-level,
expandable tree mirroring the future site navigation, rendered **in normal layout flow** (a form
widget, not an absolutely-positioned canvas). It is deliberately reused in three modes — IA
editing, generation progress, review navigation — so the user manipulates the same mental object
from setup through review. **⚑ default** (the unification).

### 7.1 Setup wizard
Doc type → project context → personas → optional **sources** (existing docs as context; typed
list, see §9 "External sources"; full migration-import is TBD — do not build) → **IA proposals**:
a segmented control of proposals ("A: task-oriented · B: by-module · C: user-journey", each with
a one-line agent rationale) above an **editable NavTree** — drag to reorder/reparent, inline
rename, add/remove nodes, per-node page brief shown on select (the brief is what seeds the
writer); any edit forks the proposal into "Custom"; for the `sectioned` archetype the top-level
nodes render as section tabs, matching the final site → theme (two modes: **"Design it here"** —
token editor with a **persistent miniature preview**: a real sample page in a scaled-down iframe
beside the controls, CSS-variable updates applying live; **"Match my existing project"** — an
agent extracts tokens from Tailwind config/CSS variables/token files, then drops into the same
editor for confirmation; URL-scraping fallback is a stretch goal) → site metadata (title,
description, logo, favicon) → component selection → start. Wizard writes `docstube.yml` +
`ia.yml` (round-trip preserving comments). *(Screenshots step: omitted — TBD.)*

### 7.2 Generation dashboard
Runs can take **hours** on rate-limited subscriptions, so the dashboard is built on one
principle: **the waiting room is the review room** — finished pages stream in for review while
the rest generate. Elements:

- **NavTree in progress mode**: per-page status (queued → writing → checking → judging →
  retrying → passed / flagged), findings counts, and per-page cost, live over the WS channel.
- **Per-page CI-style step timeline** (GitHub-Actions-run pattern): each step expands to show
  exactly what the agent returned — writer output, every judge's criteria results and issues,
  deterministic check results, retry diffs. The timeline is a pure renderer over the SQLite
  job/findings state → refresh-safe and identical after resume.
- **Live preview pane**: the selected/most-recent page renders as production output the moment
  it lands; review + feedback (§7.3) is available immediately on passed/flagged pages.
- **Cap-freeze banner**: what froze, estimated window reset, resume button (+ auto-resume
  option). The terminal shows a compact textual mirror (pages done/total, current step, cost)
  for non-browser runs.
- **Deliberately not a node-graph canvas.** React Flow was evaluated and rejected: the
  per-page pipeline is linear and identical across pages, so a graph canvas adds spectacle but
  worse scannability/density than tree + timeline, plus pan/zoom friction. React Flow remains
  the noted candidate for a later **provenance explorer** (pages ↔ symbols), where a real graph
  *is* the content.

### 7.3 Review UI
Renders generated pages exactly as production (the real Astro output in an iframe) with an
element-selection overlay (react-grab-style). User clicks any element → leaves feedback → a
categorizer agent routes it (§10.6): criteria amendment, writing-instruction amendment, glossary
entry, or config change — applied on the next run. Feedback scopes: element/section, page, whole
docs. Navigation is the **NavTree in review mode** (findings badges per node); per page it shows
findings, pass/flagged state, and approve/regenerate actions.

## 8. Agent adapter layer

`@docstube/agent` defines one interface; implementations:

- **Codex adapter** — reference implementation. `codex exec` with `--json` (JSONL events) and
  `--output-schema` for structured findings. Most automation-friendly; auto-approve configured
  explicitly; `--skip-git-repo-check` where needed.
- **Claude adapter** — `claude -p` / `--print` with `--output-format json` (and `stream-json`
  for tool-event observation), explicit permission flags (never hang waiting for interactive
  approval), pinned version detection.
- **Gemini adapter** — supported but treated as **volatile** (platform migration mid-2026);
  pin versions, degrade gracefully.
- **Direct API adapter** — API-key based, **fully in scope** (enterprises often prefer metered
  API billing; also the path around subscription ToS constraints and the right mode for CI).
  Must support **configurable endpoints**: provider presets plus a custom `baseUrl` + model name
  for OpenAI-compatible and Anthropic-compatible APIs — which is what makes self-hosted and
  open-weight models largely a *configuration* matter later, not new code.

**Extensibility — additional coding agents (TBD).** Further agents beyond the four built-ins —
e.g. open-weight-model CLIs (Qwen Code, DeepSeek-based tools) or self-hosted serving stacks —
are explicitly anticipated but **not designed now; do not implement**. Two architectural
guarantees are made today so adding them later is additive, never breaking:
1. The `agents.*.agent` config field is an **open identifier validated at runtime against the
   adapter registry — not a closed enum in the Zod/JSON schema.**
2. The `AgentAdapter` interface in `@docstube/agent` is the sole extension point; the registry
   is designed so new adapters (including, later, third-party adapter packages) register without
   touching core.

**Permissions & sandboxing (first-class adapter contract):** every invocation declares
**writable roots** (the docs output dir + `.docstube/` scratch only) and read-only source;
non-interactive/auto-approve flags are mandatory (a hung permission prompt is a bug);
per-adapter mapping to vendor permission/sandbox flags. Enforcement depth varies by vendor, so
docstube adds its own **post-run guard**: after every agent step, a `git status` check verifies
no source file outside the writable roots was mutated — a dirty tree outside allowed paths
fails the step. **Before S3 begins, re-verify all vendor CLI facts (flags, JSON modes, MCP
support, subscription terms) from primary sources** — they are perishable.

Cross-cutting requirements: parse only structured JSON/JSONL output (never scrape human text);
pin + detect CLI versions at runtime; per-vendor rate-limit handling; robust timeouts with child
process kill; **content-addressed caching of every agent step** keyed by
`(prompt hash, input file hashes, model id, adapter version)` — this is what makes resume,
retry, and reproducibility cheap. Mock + record/replay adapter for tests.

**ToS reality (document in README and adapter docs):** invoke **official vendor CLIs only**,
never reimplemented harnesses. Anthropic restricts third-party subscription harnesses and is
moving headless subscription use to separate Agent SDK credits (June 2026); Codex is the most
permissive; Gemini is migrating platforms. Hence: Codex as reference/default recommendation,
API-key adapter as the universal fallback.

## 9. Context engineering: skills vs prompts

Four channels with different cost/guarantee profiles — **the prompt is for the task, the
contract, and the index; everything else is addressable.**

| Knowledge | Channel |
|---|---|
| Page brief, IA position, personas, output contract, hard invariants (~10 lines), component **index** (names + one-liners of enabled components), pointers to skills/files | **Prompt** (always read, guaranteed) |
| Component **reference** (props schemas, examples, when-to-use), D2 authoring guide + validation script, writing/style conventions | **Skills** (SKILL.md; metadata ~50 tokens always visible, body on demand) |
| Full IA tree, glossary contents, prior page version | **Files** referenced by path |
| D2/MDX/snippet/config validity | **Executables** (`docstube check …`) — knowledge lives in the compiler, not in context |

Principles (all implemented, all measured):

1. **Index in prompt, body on demand.** For correctness-critical material, the prompt explicitly
   instructs reading the skill ("before using a component beyond Callout/CodeBlock, read
   docstube-components") — instructed reading, not hopeful description-matching.
2. **Executables beat prose.** Skills teach idioms + point at `docstube check`; agents iterate
   against ground truth in their own loop.
3. **Lean-first with deterministic backstop.** First attempt = minimal context. If the
   deterministic gate catches a context-miss (unregistered component, invalid props, broken D2),
   retry with the full reference inlined. Misses cost one cheap retry, never a wrong page.
4. **Role-scoped materialization.** Reviewers/verifiers never receive writer skills. The
   components skill is **generated per project** from registry metadata × the `enabled` list.
5. **Adapters own delivery policy; evals own truth.** Skill paths differ per agent
   (`.claude/skills/`, `.agents/skills/`, Gemini's dir) — materialized at run start, gitignored,
   cleaned up. **Materialization is
   non-destructive**: docstube writes only into a namespaced subfolder (`docstube-*`) with an
   ownership marker file, never overwrites or deletes files it doesn't own, and cleanup
   removes only marker-owned entries. If an agent's skill activation proves unreliable, its adapter inlines bodies
   instead. Eval suite runs context ablations (skill-on/off, index-vs-inline); **retry rate is
   the health metric** that promotes/demotes content between tiers.

The user's own `AGENTS.md`/`CLAUDE.md` will auto-load into runs — accepted as-is for now.

Shipped skills: `d2-diagrams` (guide + few-shot + validation script), `docstube-components`
(generated), `docstube-writing`. The `d2-diagrams` skill is **also published standalone** to
skills directories/marketplaces with docstube attribution (top-of-funnel).

### 9.1 Import / starting context (existing docs + intent sources)

**Purpose.** "Import" pulls in existing material as *starting context* — it helps the writer
make better decisions and seeds the initial navigation, but it never bypasses verification. It
is **scaffolding, not foundation**: most valuable on first generation (shaping the IA and first
drafts) and intentionally **decaying** in relevance as docstube's own verified docs surpass the
old ones.

**Two kinds of context (same loaders, different consumers):**
- **Reference context** (what the docs should *say*): existing docs, READMEs/Markdown, internal
  wikis, and **OpenAPI/Swagger specs** (gold-standard structured input for API docs). → feeds
  the **docs** writer + IA proposer.
- **Intent / "why" context** (why things shipped): **Jira, Linear, GitHub Issues, PR
  descriptions, ADRs**. → feeds the **changelog** pipeline (§15.5). Poor for the docs body, ideal
  for explaining a release.
Both are **offered to the agent, never forced** — consistent with §9 (knowledge is made
available; the agent pulls what it needs).

**Three delivery modes, organized by who handles credentials** (a typed `sources:` list in
config):

| Mode | Where the data is | Credentials | docstube's job |
|---|---|---|---|
| **1. User's MCP** | behind a connector the user already runs (Confluence, Jira, Linear…) | the user's MCP server owns auth — **not docstube's concern** | enable it on the run; prompt the agent that it may consult it |
| **2. docstube fetches** | a private remote (private git repo, authenticated export) | **request a token / SSO from the user** | fetch/clone with provided creds, then digest |
| **3. Already on disk** | the repo being documented, or another local repo | none | read files (a glob) |

Notes: **Mode 1** needs no integration code — all three vendor CLIs speak MCP, so docstube
implements **no MCP client**; it just enables the user's own servers (this is the right path for
anything behind serious enterprise auth). **Mode 3** is the common case (most "docs" are a README
plus a few `.md` files). **Mode 2** is, for v1, **authenticated git/URL fetch (private repo
clone with a token)** — the realistic 90%; deep SSO flows to arbitrary platforms are "later, only
if asked," since such systems are better reached via Mode 1. **Website/HTML scraping is
explicitly out of scope** — docs are generated *from* a source (Markdown/MDX/OpenAPI) the user
can point at directly, so recovering HTML is solving a non-problem.

**Lifecycle — digest, not copy, not RAG.** On import, raw content is fetched into a temp
location for that run and **discarded after**; an agent distills each source into a **structured
digest** — key facts, terminology/glossary candidates, the old navigation structure, and notable
claims, each with provenance — and *that* persists in `.docstube/` (small, re-feedable on later
runs, explicitly labeled "what the old source said at import time," so it decays gracefully).
**No permanent verbatim copy** (it goes stale and competes with the real docs for "truth") and
**no vector/RAG index** — a bounded, front-loaded body of text doesn't justify that machinery,
and this matches the agentic-over-RAG decision in §12 (heavy semantic retrieval stays a
hosted-tier concern, out of the free core).

**Credential rule (Mode 2).** Any token or login is used only for the fetch and lives in
env/keychain — never in config, the digest, state, transcripts, telemetry, or generated output
(same iron rule as screenshot creds, §19).

**Provenance & freshness.** MCP/remote reads are observed through the same tool-event stream as
file reads and recorded as **external dependencies**; since external content can't be hash-diffed
like code, pages depending on it are swept by the periodic re-verification pass (§13.3).

**Conflict rule: code is ground truth.** Imported material is *untrusted, possibly-stale input*
— it informs structure, terminology, and intent but is never authority. When it contradicts the
code, the code wins and the discrepancy surfaces in the **drift report** ("your existing docs
disagree with your code in N places") — a near-free byproduct of verification and a strong
launch artifact. Importing therefore *improves on* the old docs by catching their errors rather
than laundering them forward. Full migration-import (content reuse, URL/redirect preservation,
platform importers) remains **TBD**; this framework is **context-only**.

## 10. Pipeline

### 10.1 Orchestrator **⚑ default**
Page-by-page durable jobs in SQLite (job table: page id → steps → status → attempt counters).
In-process scheduler with configurable concurrency, gated by the usage-cap monitor. Every step
is resumable via the content-addressed agent cache. Run transcripts stored under
`.docstube/runs/` (gitignored). The orchestrator keeps **per-page and per-step token/cost
accounting** (adapter JSON cost fields + local usage logs) as first-class state — it powers the
cap monitor, per-page retry/refinement budgets, run reports, and the eval suite's cost metrics.
Scheduling is **depth-first**: complete pages end-to-end before fanning out, prioritizing a
small first batch so the dashboard shows a finished, reviewable page within minutes —
**time-to-first-page** is a tracked metric.

### 10.2 Roles
- **Writer**: receives prompt brief + seed file list (from the codemap, §12) + skills; reads
  more via its own tools; emits the MDX page + structured metadata (proposed glossary terms,
  per-section source citations).
- **Reviewers**: one per persona. Input: the page (file), the persona definition, and that
  persona's **criteria checklist**. Output: structured findings.
- **Verifiers**: factual-accuracy and completeness checks against source. **Default: verifier
  model family ≠ writer model family** (cross-vendor judging, free with the adapter layer).
  Use smaller/cheaper models for mechanical reviewer criteria where configured.

### 10.3 Findings model (no raw 1–10 scores)
Judges return **criteria-anchored findings**, not holistic numbers:

```json
{ "findings": [
  { "criterion": "terms-explained", "pass": false,
    "issues": [{ "text": "'idempotent' unexplained", "severity": "major", "location": "§2" }] }
]}
```

Severity is **categorical and consequence-anchored** (definitions fixed in the criteria, not
invented per-run): `blocker` = factually wrong / broken sample; `major` = misleading or missing
key info; `minor` = polish.

**Criteria checklists**: docstube ships defaults per doc type; the wizard **generates
persona-specific criteria from each persona definition**; users edit them; they're versioned
under `.docstube/criteria/` (committed). Human feedback amends them (§10.6).

### 10.4 The gate
`pass = all deterministic checks pass AND zero open blockers AND zero open majors` (threshold
configurable). A derived numeric score (weighted count of open issues) exists **only** to rank
pages for refinement order — never to gate.

### 10.5 Retry & refinement
- On failure: feed the **specific findings** back to the writer; cap iterations (default 2) and
  per-page cost against the budget; **never accept a revision that regresses** vs its
  predecessor (pairwise compare new vs old for refinement decisions).
- Pages that still fail **ship flagged for human review** — never block the whole run
  (graceful degradation, everywhere).
- **Refinement mode** (`docstube refine` **⚑ default** name): re-runs worst-ranked pages first,
  budget-bounded.

### 10.6 Feedback subsystem
Review-UI feedback → categorizer agent → routed to exactly one home: a criteria amendment
(persona checklist), a writing-instruction amendment (`.docstube/instructions/`, committed), a
glossary entry, or a config change. All versioned; all applied next run. This is the only
mechanism for persistent feedback — no ever-growing prompt blob.

### 10.7 Stable identifiers (S0 contract)
- **Page IDs**: every IA node carries an immutable `id` (in `ia.yml`), independent of
  title/slug. Jobs, provenance, findings, feedback, and cross-references key off it; slugs are
  derived and renameable (with redirects) without breaking identity.
- **Section IDs**: generated pages carry stable per-section IDs via a defined MDX marker
  convention + page frontmatter schema (both S0 contracts). On regeneration, the writer
  receives the previous page and **must preserve existing section IDs** for surviving
  sections; new sections get new IDs. A deterministic check enforces presence + uniqueness.
  Section IDs anchor per-section provenance citations, per-section feedback, and future
  surgical regeneration.
- **Element-level identity is deliberately NOT durable.** Arbitrary elements can't keep
  identity across LLM regeneration without absurdly constraining the writer. Element feedback
  is captured as *section ID + ephemeral descriptor* (component type/index + text snippet at
  capture time) — durable only as context inside the routed feedback record. This is
  sufficient because feedback's durable form is the routed artifact (criteria/instruction/
  glossary/config), not an annotation pinned to an element.

## 11. Deterministic verifiers

Pluggable registry (`@docstube/verifiers`), run after each page generation, **before** any LLM
judge spends a token; their failures are hard gates and drive the escalating-retry loop:

- MDX compilation (broken JSX/components is a known failure class).
- Registry props validation — generated MDX component usage validated against Zod props schemas.
- Code-sample compilation/type-check: `tsc` (TS/JS), `pyright` (Python).
- Import/API resolution: imports in samples must resolve against the real package/codebase
  (anti-hallucination check #1).
- Link checking (internal + external).
- D2 compilation (via `@terrastruct/d2`).
- Vale prose linting **⚑ default** (style/terminology), config shipped with the theme.
- Glossary integrity: referenced terms exist; duplicate/orphan detection.

**Execution model & failure taxonomy (S0 contract).** v1 verifiers are **static-only** — code
samples are type-checked and import-resolved (tsc, pyright), never *executed*; doctest-style
execution is a future capability. This keeps the sandbox burden low; remaining hygiene:
per-check timeouts, temp-dir isolation, no network during checks. Every check returns a
structured result from a fixed taxonomy: `pass` / `fail` (gates, with finding) / `warn`
(non-gating) / `skipped` (unsupported language/feature — never a failure) / `error` (the
verifier itself crashed — logged + telemetry, retried once, never counted as a page failure).
Each verifier ships with fixture repos exercising all five outcomes.

## 12. Code understanding (`@docstube/codemap`)

- **Tree-sitter structural map**: files → symbols (functions/classes/exports) → imports/refs,
  stored in SQLite (nodes + edges + per-symbol **normalized hash**: signature + structural AST,
  excluding comments/whitespace/local names). Incremental re-parse on file change.
- Used to: (a) ground IA proposals, (b) **seed** each page's writer with candidate files,
  (c) anchor symbol-level provenance.
- **Language tiers**: any codebase works (agents read anything; unsupported languages fall back
  to file-level provenance + LLM-only verification). **Tier-1: TS/JS and Python** — full
  treatment: tree-sitter queries, deterministic verifiers, API extraction. Implementation order:
  TS first (dogfood target), Python immediately after, both in the initial release.
- **Per-language plugin interface** (queries + verifiers + extractor) designed to be
  contributor-friendly — this is the community's natural contribution surface.

**API references are extracted, never LLM-written**: TypeDoc/TS compiler API (TS/JS) and griffe
(Python; static, no user-code import) → normalized into one unified schema → rendered by the
`ApiReference` registry component. The LLM writes only surrounding prose (descriptions, examples
— verified like all prose). Signature changes update the API tables deterministically with
**zero tokens**.

## 13. Provenance & incremental updates (free tier)

### 13.1 Capture (dual, cross-checking)
Provenance = **seed set ∪ observed reads**. Observed reads come from adapter tool-call event
streams (Claude `stream-json`, Codex `--json`); where observation is unreliable (Gemini), the
seed set is the floor. Writers also emit per-section source citations (precision signal).

### 13.2 Detection
On change: resolve the diff to symbols via the codemap; compare **normalized hashes** — comment
reformatting and local renames produce no trigger.

### 13.3 Regeneration (free tier)
Changed symbol → affected pages (provenance lookup) → **page-level regeneration**. A separate
**topology pass** on structural events (new/deleted public symbols or files) proposes page
create/delete/move — surfaced as a PR, never silent. Periodic full re-verification pass
(configurable) catches drift the provenance graph can't see. **Bias rule: under uncertainty,
regenerate or flag — never silently leave a page stale.**

### 13.4 The StateBackend seam
```ts
interface StateBackend {
  // Async from S0 (the remote implementation crosses the network); versioned via a
  // capabilities handshake so old clients and new backends negotiate cleanly.
  capabilities(): Promise<{ version: string; features: string[] }>
  resolveDirty(manifest, changedSymbols): Promise<{ dirtyPages, reasons }>
  pushState(runId, state): Promise<void>
  pullState(runId): Promise<state>
  recordOutcome(event): Promise<void>   // fire-and-forget semantics, still awaitable
}
```
`LocalBackend` may be synchronous internally (better-sqlite3) but conforms to the async
contract. A single contract test suite runs against every implementation.
`LocalBackend` (default, fully functional, this plan). `RemoteBackend` (hosted tier, later):
same interface over the tRPC `v1` frozen contract; auth via API token; version header;
**graceful fallback to LocalBackend when unreachable**. Section-level semantic regeneration and
learned relevance gating are hosted-tier concerns — out of scope here.

## 14. Output artifact

### 14.1 Site & theme delivery
`docstube generate` scaffolds a self-contained Astro site into `output:` containing content,
config, token overrides, and the generated theme/component source needed to build the site. The
theme package in this monorepo is an internal source/template for that generated code, not a
required public dependency of the user's docs site. Theme updates happen when the user installs
a newer docstube and runs a dedicated theme/update command, or when the GitHub Action runs a
newer docstube version (for example `latest`) with automatic theme updates enabled. Updates must
avoid regenerating documentation content unless explicitly requested. Static output; user-owned
deploy to any static host — the wizard and docs ship **first-class deploy recipes**, including
Stacktape (`hostingContentType: 'astro-static-website'`), optionally scaffolding a ready
`stacktape.yml` for the docs site. The theme renders a small **"Generated by docstube" footer
credit** — default on, disableable via `theme.attribution: false` — the standard OSS virality
channel.

### 14.2 Layout archetypes
Invariant: left nav + right in-page TOC. Two archetypes, chosen by the IA step, declared in
`ia.yml`: **single-tree** (classic sidebar) and **sectioned** (top nav — e.g. Guides | API |
Examples — each section owning its sidebar tree). Plus `landing` and `full-width` page layouts.
No free-form layout composition.

### 14.3 Component registry (the contract)
Every component declares: Zod props schema + description + when-to-use / when-not-to-use +
usage example. That metadata is simultaneously: the theme's render contract, the generated
`docstube-components` skill, the deterministic props verifier, and the wizard's selection list.
Users can register custom components (with descriptions) that the agent is then told to use.

Built-ins: `Callout` (info|tip|warning|danger variants), `CodeBlock`, `CodeGroup`,
`Terminal`, `Card`+`CardGrid`, `Steps`, `Tabs`, `FileTree`, `PreviousNext`, `Divider`,
`ComparisonTable`, `ParamTable` (anchorable params), `DecisionTree`, `Badge`, `ApiReference`,
`Diagram`, `Term`. (`Screenshot` — name reserved, TBD.)

### 14.4 Diagrams: D2 only
Source is **text in MDX — never AI-generated canvas JSON** (verifiable, diffable, editable).
Agents write D2; `docstube check d2` (and the skill's bundled script) validates with compiler
errors in the agent's own loop; theme compiles to SVG at build via `@terrastruct/d2` (dagre/ELK;
**sketch mode on by default** for the hand-drawn look; TALA unavailable in WASM — documented
limit). Diagrams make factual claims → verified like prose.

### 14.5 Glossary
`glossary.yaml` (content, committed, user-owned): term → short tooltip definition (+ optional
long form, aliases). Writers and persona reviewers **propose** entries (an "unexplained term"
finding can be resolved by adding an entry — a global fix); definitions are fact-checked.
**Linking is build-time** (remark plugin): first occurrence per page, never in code/headings/
links, alias/plural matching, escape syntax for false positives — adding one entry retroactively
upgrades every page with zero regeneration. Renders via `Term` (dotted underline + tooltip,
keyboard-accessible); auto-generated Glossary page; feeds llms.txt.

### 14.6 LLM-ready output
`llms.txt` + `llms-full.txt` are generated at site build; an MCP server serving the docs is
part of the same output surface.

### 14.7 SEO & AEO
Two layers, both in scope. **Technical (automatic, in the theme/build):** per-page meta tags,
`sitemap.xml`, canonical URLs, Open Graph / social-card images, and structured data — ordinary
SEO hygiene, cheap because Astro static output is already fast and crawlable. **Content
(the writer agent produces it):** AI assistants disproportionately quote question-and-answer
shaped content, so the writer is guided to use **question-style headings** ("How do I…",
"Why does…") with a one-sentence answer directly under each before the details, and to add a
short **FAQ section** (real developer questions, phrased as the persona would ask them) where
appropriate. FAQ answers are claims like any other prose — fact-checked by the verifiers, so the
AEO content carries no trust compromise. (`llms.txt` above is the machine-readable half of AEO;
this is the human-readable half.)

## 15. GitHub Action

Wraps `docstube update`: checkout → codemap diff → `StateBackend.resolveDirty` → regenerate →
**open a PR** (never push silently) with changed pages + a summary of reasons. Idempotent;
re-runs converge. Agent credentials/API keys come from runner secrets. Concurrency: per-run
worktrees / atomic job claims — parallel runs must not corrupt shared state. The **portable
manifest** (committed) is the state shared between local runs and CI; the SQLite binary is not
committed.

## 15.1 Release distribution

Two install paths are supported:

1. **npm:** the `docstube` package is published as a Node-based CLI for users who already use
   Node/npm/pnpm. It requires the declared Node LTS baseline and runs the compiled JS CLI
   directly. It does **not** download or wrap the standalone binary.
2. **Standalone binary:** GitHub Releases contain `@yao-pkg/pkg`-built binaries for Linux x64,
   Linux arm64, macOS x64, macOS arm64, and Windows x64, plus checksums and install scripts.
   This is the canonical path for non-JS/TS projects and does not require Node on the user's
   machine.

Stacktape-hosted install scripts are the canonical public URLs, e.g.
`https://installs.docstube.dev/linux.sh` and `https://installs.docstube.dev/windows.ps1`. Those
small scripts download binaries from GitHub Releases. The same scripts are uploaded to each
GitHub Release for transparency and reproducibility. Binaries stay hosted on GitHub Releases
unless bandwidth/control becomes a reason to move them.

Deployment infrastructure lives in root `stacktape.ts`: a static hosting bucket for
`installs.docstube.dev`, a static hosting bucket for the public `docstube.dev` website, and a
small public install-events Lambda behind `events.docstube.dev`. The install-events backend is
open-source for transparency, but PostHog credentials are injected through Stacktape secrets and
never committed.

Release workflow: one validation job runs before release artifact creation; platform binary
jobs depend on it and do not repeat full validation; the release job sets versions, publishes
the `docstube` npm package with provenance, creates the GitHub Release, uploads binaries,
checksums, and install scripts, and prepares/publishes the Stacktape-hosted scripts once that
hosting bucket is configured. The release workflow is allowed to rerun validation even if `main`
is already green because it creates privileged, immutable artifacts.

## 15.5 Changelog generation

A second use of the existing pipeline, pointed at history instead of a code snapshot. Given a
range (two refs/tags), a writer agent reads the **git history**, groups changes, and writes a
human-readable changelog; verifiers fact-check each entry **against the actual diffs** (same
trust mechanism as docs). The **"why" context** arrives through the MCP pass-through (§9.1) —
the user's own Jira/Linear/issue-tracker MCP server, enabled on the agent run, no new
integration code from docstube. Two output flavors fall out naturally: a standard release
changelog, and a **"what changed in your docs"** summary that ties a release back to the pages
docstube regenerated. Output is MDX in the docs site (and feeds `llms.txt`). Config: a
`changelog:` block (range strategy, grouping, optional MCP sources); runnable on demand and from
the GitHub Action. Code remains ground truth — the diff wins over any tracker note that
contradicts it.

## 16. `.docstube/` layout **⚑ default**

```
.docstube/
  db.sqlite          # state, jobs, provenance graph, findings   (gitignored)
  cache/             # content-addressed agent step cache        (gitignored)
  runs/              # transcripts/logs                          (gitignored)
  manifest.yml       # portable provenance/state manifest        (committed)
  criteria/          # per-persona + per-doc-type checklists     (committed)
  instructions/      # feedback-derived writing instructions     (committed)
```
Content (`docstube.yml`, `ia.yml`, `glossary.yaml`, MDX, the site) lives outside `.docstube/`.
SQLite schema is versioned and migratable (Drizzle migrations).

## 17. Testing & evals

1. **Deterministic CI (every PR):** Vitest unit + integration; agents via the record/replay
   adapter (fixtures recorded from real runs, replayed in CI). Lint, typecheck, build matrix
   (Linux/macOS/Windows). **CI never calls real agents.**
2. **Live + eval suite (separate workflow, secrets-gated, nightly/manual):** real `codex exec` /
   `claude -p` against small fixture repos; evals scoring generated pages — deterministic-gate
   pass rates, judge-vs-human-gold-set agreement (calibrates the criteria), context ablations
   (§9.5), skill-on/off comparisons, D2 generation cases. Harness: promptfoo or evalite
   **⚑ default — pick one at project start and commit**.
3. **Dogfood workflow:** docstube generates docstube's own docs and deploys to docstube.dev —
   the permanent real-world e2e and the credibility artifact.

## 18. Telemetry

PostHog; **opt-out**; disclosed meaningfully on first run; documented exactly; respects
`DO_NOT_TRACK`; `docstube telemetry disable` + env + config. Collected: command invocations,
error types, durations, adapter/model choice, retry rates. **Never:** code, repo contents,
prompts, paths, project names, generated content.

Installer telemetry is narrower than runtime CLI telemetry. Install scripts may report
started/succeeded/failed, version, platform, installer name, source, duration, and a coarse
error kind to `events.docstube.dev`; they must not send paths, usernames, hostnames, shell
arguments, repository data, or source content. Events are forwarded server-side to PostHog as
anonymous events without person profiles and with GeoIP disabled where supported. Installer
telemetry is best-effort and must never fail installation.

## 19. Security & privacy

- Secrets (agent API keys; later screenshot creds) live in env / OS keychain — never in config,
  state, transcripts, telemetry, or anything sent to a remote.
- The local control-plane server binds to `127.0.0.1` only and requires an ephemeral session
  token (embedded in the auto-opened URL) — the wizard/review UI must not be reachable by other
  machines or other local users.
- The Action consumes secrets only from the runner's secret store.
- The hosted seam transmits hashes/manifests, not source (when it exists).
- **Privacy wording rule (docs, README, marketing):** docstube never sends source to docstube
  servers — but source context *is* sent to the user's **chosen AI provider** via their own
  agents/API keys, exactly as in their normal agent usage. Never claim "your code is sent
  nowhere"; claim "never to us; only to the provider you already use, on your own credentials."
- `SECURITY.md` + GitHub private advisories (already in the repo bootstrap).

## 20. OSS project management

Already bootstrapped (README, LICENSE MIT, CONTRIBUTING, CoC, SECURITY, issue/PR templates).
Additionally:
- `AGENTS.md` canonical, `CLAUDE.md` symlinked; keep in sync with this plan's locked decisions.
- Conventional Commits + Changesets; release workflow publishes the `docstube` npm package,
  standalone binaries, checksums, and install scripts. Other workspace packages stay private
  until deliberately promoted.
- CI as in §17; plus schema-snapshot diff job for the hosted tRPC contract (§4).
- Contributor surfaces by design: language plugins (§12), verifier plugins (§11), registry
  components (§14.3), adapters (§8). Label and document these as the on-ramps.
- Standalone published packages later, once stable: likely `@docstube/agent` and the
  `d2-diagrams` skill.

## 21. Build approach: full scope, one agent, sequential

There are **no milestones and no phased releases** — the product is built as a single effort by
**one coding agent working sequentially**, and **released all at once**. Everything in this
document is in scope except items explicitly marked **TBD** (§2: screenshot capture,
migration-import, hosted-backend internals, additional agent adapters, and a
docstube-operated free-hosting offer for OSS projects — parked for future design sessions,
together with premium pricing). TBD items stay out not for sequencing reasons but because they are undesigned:
do not improvise them.

**No phased releases ≠ no internal gates.** Each step S0–S9 has internal acceptance criteria
and must close with fixture/demo proof before the next begins. Gates are engineering
checkpoints, not public launches.

**Step 0 — freeze the contracts.** Contracts-first remains the highest-value ordering rule even
for one agent. The S0 contract set: the Zod config-family schemas (`docstube.yml`, `ia.yml`,
`glossary.yaml`), the **findings** schema, the **criteria-checklist** schema, the **feedback
record** schema, the **provenance manifest** schema (`manifest.yml` — it crosses the local/CI
boundary), the **normalized adapter event** schema (tool-use + cost events across vendors), the
**cache-key derivation spec**, the **deterministic-check result taxonomy** (§11), the
**generated-page frontmatter + section-ID marker convention** and **page/section ID rules**
(§10.7), the async versioned `StateBackend` (§13.4), the `AgentAdapter` interface (incl.
permissions contract, §8), the registry component-metadata schema, the tRPC routers, and the
`.docstube/` Drizzle schema. Every later step then codes against stable interfaces and is
testable with mocks/fixtures before its dependencies exist.

**S0 acceptance criteria (the first gate):**
1. Every S0 schema implemented in Zod with exported types + valid/invalid fixture tests.
2. JSON Schema generated for the config family, snapshot-tested; the reference `docstube.yml`
   in §5 validates against it.
3. YAML round-trip test: programmatic edit of a commented `docstube.yml` preserves comments
   and formatting.
4. tRPC routers typecheck; the `AppRouter` `.d.ts` snapshot + CI diff job exist.
5. Drizzle migrations create a fresh DB; migration test passes.
6. Async `StateBackend` contract test suite passes against a `LocalBackend` stub (the same
   suite the future `RemoteBackend` must pass).
7. `AgentAdapter` contract test passes against the mock/record-replay adapter; one recorded
   fixture round-trips through it.
8. Page/section ID validators exist; uniqueness/presence checks run.
9. **Packaging smoke job** (runs in CI from S0 onward): @yao-pkg/pkg builds a minimal CLI with
   better-sqlite3 + one lazy dynamic import for Linux/macOS/Windows — packaging risk is proven
   early, not discovered at S8.
10. **Walking skeleton (S0 exit demo):** fixture repo → replay adapter emits canned writer
    output → one deterministic check → state lands in SQLite → page renders to HTML via a
    minimal MDX compile (full theme comes in S4). The spine works end-to-end with zero real
    agents.

**Build order** (a topological order through the real dependencies; each step is finishable and
testable in isolation):

| Step | Contents | Why here |
|---|---|---|
| S0 | contracts & schemas in `packages/contracts` (above) | everything depends on them |
| S1 | codemap (tree-sitter, normalized hashes) + extractors (TypeDoc, griffe) | pure and deterministic; fixture-testable; feeds pipeline + incremental engine |
| S2 | deterministic verifiers (MDX, props, tsc, pyright, imports, links, D2, Vale, glossary) | standalone; must exist before the pipeline can gate |
| S3 | `@docstube/agent` adapters (Codex, Claude, Gemini, direct API) + usage caps + record/replay harness | unlocks all later pipeline work via replay fixtures |
| S4 | theme + registry + glossary remark plugin + D2 build + llms.txt + SEO/AEO (meta, sitemap, OG, structured data) + docs-serving MCP server | independent of the pipeline; gives writer output a real render target |
| S5 | orchestrator + pipeline (findings/gate/retry/refinement) + skills materialization & content + import loaders (files/git/MCP) & digest + drift report + changelog generation + FAQ/AEO writer guidance | integrates S1–S4 |
| S6 | incremental engine (provenance, normalized-hash detection, topology pass) + `LocalBackend` | builds on S1 + S5 state |
| S7 | local UI (`apps/local-ui`): NavTree, wizard (incl. theming modes), generation dashboard, review UI + feedback subsystem | consumes the now-real tRPC surface |
| S8 | CLI polish + binary packaging (`apps/cli`) + telemetry; GitHub Action (`apps/github-action`) | thin shells over the core |
| S9 | eval suite + gold-set calibration + dogfood workflow (docstube's docs via docstube) | needs the integrated whole |

**Definition of done (the north star):** a stranger runs `npx docstube generate` on their TS or
Python repo and gets a verified, beautiful docs site — and `docstube update` keeps it true.

## 22. Risks (top 5, with mitigations)

1. **Vendor ToS / CLI volatility** (Anthropic subscription-headless changes; Gemini platform
   migration) → official CLIs only; Codex default; API-key adapter; versioned, pinned adapters.
2. **Judge unreliability** → no raw scores; criteria + consequence-anchored severity;
   cross-vendor judging; gold-set calibration in evals; deterministic gates carry the trust load.
3. **Provenance capture error** → dual capture (seed ∪ observed ∪ citations); bias to
   regenerate/flag under uncertainty; periodic full re-verification.
4. **Scope** → contracts-first build order (§21); TBD boundaries strictly respected
   (undesigned features are never improvised); Mermaid cut; no free-form layouts/templating.
5. **Non-determinism undermining the "verified" brand** → content-addressed caching; structured
   outputs; deterministic-first gating; retry-rate monitoring.

## 23. Decision log (one-liners)

Name docstube / docstube.dev · MIT, BYO-compute, hosted tier later · Node LTS (not Bun) ·
better-sqlite3+Drizzle · yao-pkg binary for no-Node installs · pnpm+Changesets ⚑ · Hono · tRPC both seams (frozen v1 +
.d.ts diff on hosted seam; oRPC fallback) · Vite/React/Tailwind UI · custom Astro theme,
generated into user repos as self-contained source + updateable by docstube command/Action · Pagefind ⚑ · `docstube.yml` YAML config + JSON Schema
(supersedes TS config) · comment-preserving YAML edits · Zod everywhere · Oxlint+Oxfmt ·
Vitest + record/replay; live evals gated; dogfood · telemetry opt-out (PostHog) · findings model
(criteria + blocker/major/minor; no raw scores; derived score ranks only) · deterministic
verifiers first; escalating retry; ship-flagged-never-block · cross-vendor judging · tree-sitter
codemap free tier; symbol provenance = seed ∪ observed; normalized-AST detection; page-level
regen; topology pass · tier-1 TS/JS + Python; tiered elsewhere · API refs extracted, never
LLM-written · D2 only (WASM, sketch), text sources only · component registry as contract;
consolidated initial set · glossary build-time auto-linking · layouts: single-tree | sectioned only ·
skills: index-in-prompt/body-on-demand, role-scoped, executables-over-prose, adapter-owned
delivery, eval-ablated · `@docstube/agent` + `d2-diagrams` skill are future standalone publishing surfaces after contracts stabilize ·
NavTree reused 3 ways (IA edit / progress / review), in-flow not canvas · no node-graph canvas
(CI-style step timelines; React Flow reserved for a future provenance explorer) ·
generation dashboard streams finished pages for review; depth-first scheduling;
time-to-first-page metric · `--yes` zero-question mode · sources framework: typed
files/url/mcp, MCP via the user's own agent-CLI config (no MCP client in docstube), code-wins
conflict rule, drift-report opportunity, migration-import TBD ·
screenshots TBD (reserved keys only) · hosted internals out of scope · no milestones — full
scope built sequentially by one coding agent against frozen contracts (S0); released all at
once · parked for future design: screenshots, migration-import, hosted backend, premium pricing,
additional agent adapters (open-weight models; open agent-id + registry keep it additive),
docstube-operated free hosting for OSS (badge-funded) · marketing website lives in `apps/web`
and is handled by another agent/workstream, outside the product-build scope · deploy recipes incl. Stacktape scaffold ·
"Generated by docstube" footer credit, default on, disableable · business context deliberately
excluded from this public document (lives in gitignored BUSINESS.md) · changelog generation from git history (pipeline pointed at diffs; "why" via Jira/Linear MCP pass-through; diff is ground truth) · SEO/AEO: technical (meta/sitemap/OG/structured-data, automatic) + content (question-headings + FAQ sections, writer-produced, verified) · cross-repo search/impact analysis dropped from scope for now · import = starting context (reference→docs, intent→changelog; offered not forced); three modes by credential owner (user-MCP / docstube-fetch-private-git / on-disk); digest-not-copy-not-RAG; website scraping cut; migration-import still TBD · license stays MIT (idea-copying is defended by speed/community/brand/data-flywheel, not license terms) · review-driven (June
2026): StateBackend async + versioned from S0 · page/section IDs are S0 contracts, element
identity deliberately ephemeral · adapter permissions/sandboxing first-class + post-run
git-status guard · verifiers static-only in v1 with a fixed result taxonomy · skills
materialization non-destructive (namespaced + ownership markers) · internal acceptance gates
per step (no *public* phases) · packaging smoke + walking skeleton from S0 · privacy wording
rule ("never to us; only to your chosen provider") · marketing claims must map to mechanics.
