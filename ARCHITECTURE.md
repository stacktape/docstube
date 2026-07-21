# docstube — ARCHITECTURE.md

> How the system described in [PRODUCT.md](PRODUCT.md) is built. PRODUCT.md owns *what and why*;
> this document owns *how*. If they disagree, PRODUCT.md wins on product semantics and this
> document wins on code structure.

**Status:** authoritative as of 2026-07-21. Written for the v1 rewrite (branch `rewrite-for-v1`);
incorporates the founder-adjudicated design-review decisions (`knowledge/design/*-v2.md`, folded
2026-07-21 — those files remain decision records, not parallel specs).

---

## 1 · Design stance

Three properties dominate every choice below, in priority order:

1. **Contracts outlive implementations.** The entity model, claim ledger, manifest format, plugin
   API, and agent-task schema are the load-bearing walls. They are Zod schemas in one
   dependency-free package, versioned with explicit `schemaVersion` fields, designed to be
   added-to without breaking. Implementations behind them are expected to be rewritten several
   times. The claim-ledger rework is THE 0.1.0 workstream: it touches the write-page contract,
   entity extraction, pipeline ordering, provenance schema, verification assignment, theme proof
   primitives, status/UI surfaces, and the audit metric — it ships as one coherent migration
   while manifests are still private, never piecemeal.
2. **The kernel is small and boring.** Trusted core = pipeline orchestration, entity model,
   claim ledger + evidence, state, verification *gating* (not the verifiers themselves),
   publication decision, plugin host, agent harness. Everything else — verifiers, language packs,
   content sources, importers, search, theme components, deterministic structural checks — is a
   plugin behind the same API third parties get.
3. **Determinism wherever possible; journaling where not.** Agent calls are the only
   non-deterministic component. They are isolated behind the agent runtime, cached by input hash,
   and record/replayable. Everything downstream of a transcript is a pure function and is tested
   as one.

## 2 · Workspace layout

pnpm workspaces, `apps/*` + `packages/*`. Entry files named by responsibility, never `index.ts`.

| Workspace | npm name | Published | Role |
|---|---|---|---|
| `packages/contracts` | `@docstube/contracts` | no (private) | Zod schemas + types only: entity model, claim ledger, evidence, manifest, config, findings (incl. structural), knowledge records, run events, agent-task schema, publication decision. Zero heavy deps (`zod` only). Everything depends on it; it depends on nothing. |
| `packages/plugin-sdk` | `@docstube/plugin-sdk` | **yes** (experimental until 1.0) | The public plugin API: `definePlugin`, hook interfaces, plugin manifest schema, capability/permission declarations. Re-exports the contract types plugins need. Second published package after `docstube`. |
| `packages/agent-runtime` | `@docstube/agent-runtime` | no | The unified BYO-AI harness: task spec, tool surface (generic + evidence tools), loop, transcripts/observed reads, cache, record/replay, transports (API + vendor CLIs). Depends only on `contracts`. |
| `packages/codemap` | `@docstube/codemap` | no | Codemap host: tree-sitter runtime, symbol table, normalized symbol hashing, typed fingerprints, symbol diff. Language packs plug in; the host is language-agnostic. |
| `packages/core` | `@docstube/core` | no | The kernel: config load/round-trip, state (manifest shards + sqlite view), plugin host, pipeline orchestrator (the generate reconciler), entity extraction/matching, ledger validation/anchoring, localization scheduler, knowledge store, run journal, local control-plane server (Hono + tRPC). |
| `packages/lang-typescript` | `@docstube/lang-typescript` | no | First language pack (plugin): tree-sitter-typescript grammar wiring, symbol extraction rules, typed fingerprints, TypeDoc API extraction, snippet typecheck/run toolchain. `lang-python`, `lang-java` follow the same shape. |
| `packages/verifiers` | `@docstube/verifiers` | no | First-party verifier plugins (each verifier a plugin, named exports from concrete files). |
| `packages/theme` | `@docstube/theme` | no | Astro + React theme, component registry (each registry component contributes a block type with a Zod metadata schema and **both `renderToHTML` and `renderToMarkdown`**). Generated sites vendor it — user sites never depend on the package at runtime. |
| `packages/skills` | `@docstube/skills` | no | Shipped `SKILL.md` sources (incl. `plugin-authoring`) + materialization helpers. |
| `apps/cli` | `docstube` | **yes** | The binary. citty, lazy command loading, no heavy deps at startup. |
| `apps/local-ui` | — | no | Vite + React wizard/dashboard/review/flag-queue SPA served by the context-aware `docstube` entry. |
| `apps/github-action` | — | no | Action wrapper around the CLI (runs `generate --ci`, enforces the PublicationDecision). |
| `apps/install-events`, `apps/web` | — | no | Installer telemetry backend; marketing site (separate workstream). |

Dependency direction (arrows = "depends on"):

```
contracts ← plugin-sdk ← { lang-*, verifiers, theme }
contracts ← agent-runtime
contracts, plugin-sdk, agent-runtime, codemap ← core ← cli, local-ui, github-action
```

`packages/extractors` is dissolved: API extractors belong to language packs. The old `packages/agent`
is replaced by `agent-runtime`.

### 2.1 Publishing posture

- `docstube` (CLI) and `@docstube/plugin-sdk` are the only public packages at v1.
- `plugin-sdk` is semver `0.x` and documented as experimental until docstube 1.0; each release
  states the supported `apiVersion` (integer) — see §6.4.
- All other packages stay `private: true`. Plugins must never need `@docstube/core` — if a plugin
  wants something only core has, that's a missing SDK surface, and the fix is extending the SDK.

## 3 · Entity model

### 3.1 Shape

```
Page ─┬─ Section (heading-delimited, nestable)
      └─── Block (paragraph · heading · list · table · code-example ·
                  blockquote · image · component:<Name> · …)
             └─ Claim (finest grain: a ledger entry anchored by an inline <Claim> marker)
```

- **Page** — one MDX file, one shard in the manifest. Identity: `pageId` (random, stable);
  slug/path are mutable attributes, never identity. **Page-level regeneration is the explicit
  0.1.0 scope** (PRODUCT §3.1): claims anchor to blocks and per-block dependencies are recorded
  so block/section regeneration stays possible later, but that machinery is not built now.
- **Section** — heading-delimited subtree. Exists for feedback anchoring.
- **Block** — one MDX block-level node. The unit verifiers usually operate on.
- **Claim** — a ledger entry: a checkable assertion with claim class, text anchor, subscribed
  fingerprint kind (§7.2), proposed sources, and computed evidence. The finest trust grain.

### 3.2 Block types are an open enum

`blockType` is a `string`, not a union. Two sources of types:

1. **Core primitives** (owned by `contracts`): `paragraph`, `heading`, `list`, `table`,
   `code-example`, `blockquote`, `image`, `thematic-break`, `raw`.
2. **Registry components**: every theme/plugin component registered with a Zod props/metadata
   schema contributes `component:<Name>` (e.g. `component:Callout`, `component:Diagram`,
   `component:ApiReference`). Plugins add block types by registering components — no kernel change.
   Every registry component MUST implement **both `renderToHTML` and `renderToMarkdown`**: the
   Markdown rendition feeds the per-page `.md` twin and the canonical machine corpus (§10.3).

Every entity carries `metadata: unknown`; the **block-type registry** (assembled at plugin-load
time) maps `blockType → Zod schema` and validates metadata at extraction and at verification time.
Unknown block types are a structural finding (never a crash): flagged, claims inside capped at
`unchecked`.

### 3.3 Identity, addressing, and stability

```
EntityAddress = { version, locale, pageId, entityId }
entityId      = e.g. "s_01J…" (section) · "b_01J…" (block) · "c_01J…" (claim)
```

- IDs are random (ULID-style, no timestamp semantics relied upon), minted by the kernel — never
  by agents — and never reused after deletion.
- Locale is an **address dimension, not an ID mutation**: the same `entityId` in `en` and `de` is
  the same logical entity (its rendition, per strict isomorphism §11.2). `version` is reserved in
  the address shape for the v1.x versioning release; 0.1.0 addresses only `latest`.
- Code-example blocks may carry `variants: { [language]: … }` (multi-language samples are v2;
  the model supports them now).

**Matching & threading (the identity hybrid, PRODUCT §3.1).** Trust state is NEVER carried by
matching — correctness and evidence recompute every run. On regeneration a matching pass aligns
the new tree against the old shard by (blockType, structural path, content similarity):

- confident match → ID and human threads (feedback, flags, review history) carry;
- ambiguous match → ID carries **for threading only**; every carried human thread gets a drift
  marker (UI: "content changed substantially since this was written", one-click detach); matching
  confidence is recorded on the shard;
- no plausible match → new ID; the old entity's threads surface as orphans for re-attachment or
  dismissal (never silently dropped).

### 3.4 Where IDs live: sidecar for structure, inline for claims

Section/block IDs stay out of the MDX: a deterministic **extraction pass** (remark/MDX AST)
parses each page into its entity tree; the tree, with IDs, lives in the page's manifest shard
(§5). The assemble stage injects `data-entity-id` (and trust/citation affordances) into rendered
HTML from the sidecar, so the review UI can anchor feedback without IDs polluting prose.

**Claims are the exception: inline `<Claim id>` markers in the MDX** (harness-state-v2 decision
5). The writer wraps each asserted span; the marker is the anchor. Consequences: anchors cannot
drift through diff-edits; translation units inherit claim refs (strict isomorphism needs this);
inline citations render straight from the markers; `validate_page_draft` and submit-time
validation check marker/ledger agreement. The clean-prose channel is the per-page Markdown twin
(components render to plain Markdown, Claim renders to its text content).

Registry components additionally accept an optional explicit `entityId` prop for cases where the
matcher is insufficient (e.g. two adjacent identical callouts); the extractor honors it.

### 3.5 One schema, four consumers

The same entity record carries: evidence/lineage (§4), trust state (§4), feedback anchors (review
UI), and the dependency map (symbol/fact → entities). No consumer gets a private variant schema.

## 4 · Claim ledger, evidence & trust states

### 4.1 The ledger contract

The writer's `submit_page` output is MDX **plus** the structured claim ledger in the same task:
every factual claim with its exact text anchor (the inline marker), claim class, subscribed
fingerprint kind, and proposed source references. The kernel validates and anchors the ledger
BEFORE verification runs; invalid, truncated, or unanchored ledger output is a coverage failure
that blocks the full-page badge. The post-hoc capped claim extractor is gone — it survives only
inside `audit` for foreign docs.

A deterministic **coverage linter** detects assertion-shaped prose (identifiers, defaults,
numbers, modal statements) not covered by any claim, so ledger omission cannot manufacture
"100% checked".

### 4.2 Record shape (per entity/claim)

PROVISIONAL split per trust-model-v2: provenance decomposes into four record kinds — reader
surfaces read ONLY ClaimEvidence.

```yaml
generationLineage:            # how this content came to be (debugging; "Files consulted")
  seedContext: [ctx:…]        # context-pack inputs handed to the writer
  observedReads: [{ file, contentHash }]   # harness-recorded, incl. evidence-tool results
dependencies:                 # what invalidates this unit (drives the reconciler)
  symbols: [{ hash, fingerprint: signature | cited-value | body }]
  facts / instructions / criteria / glossary / configFragments: [{ id, hash }]
claimEvidence:                # per claim — the ONLY reader-facing record
  - claimId: c_01J…
    class: code-structure | value | behavior | intent-history | …
    state: checked | unchecked | contradicted
    disposition: null | not-applicable | no-checker-available |
                 maintainer-input-needed | owner-attested        # PROVISIONAL set
    evidence: { kind: grounding | predicate-check | execution | attestation |
                project-defined-check, source?, check?, environment?, author?, at }
assessments:                  # editorial axis, separate from correctness
  personaReview: { persona, completed, criteriaOutcomes[] }      # gates only if primary
  riskCritic:   { completed, findings[] }
  translationFidelity: { locale, state }                          # rendition shards only
```

- **Symbol hashes, never names** (PRODUCT §3.2): the hash covers kind + container path +
  normalized declaration content. A rename changes the hash → remove+add → dependent claims
  invalidate. This is intended behavior: renames are exactly when stale-name hallucinations
  happen.
- **State is computed, never asserted.** `checked` requires class-appropriate evidence: shape
  (`code-structure`) claims — codemap grounding suffices; value/behavior claims — a passing
  claim-class predicate verifier (grounding alone yields `source-linked` evidence but state stays
  `unchecked` with `no-checker-available` until predicates ship in v1.x); intent/history claims —
  a recorded owner attestation counts. Grounding failures are hard defects for every class.
- **Page badge = every ledger claim `checked`.** Roll-up is exact counting, not pessimistic
  min-of-children: the chip shows the literal denominator ("Verified · 23/23 checked").
- Plugin verifier evidence is labeled `project-defined-check` and does not mint the built-in
  badge unless explicitly promoted in config (PROVISIONAL).
- The signed-manifest contract (PRODUCT §4.3) reserves a `signature` field per shard; unsigned
  in v1.

### 4.3 Guarantee-downgrade comparison

The kernel produces a **semantic base-vs-candidate ledger comparison** for CI (PRODUCT §3.3):
badge loss, disposition regression, checked-count drop without deletion, evidence-authority
weakening (e.g. execution → grounding), attestation loss. Assessment (editorial) changes are
reported separately and never counted as correctness downgrades.

## 5 · State model

### 5.1 Committed — the lockfile pattern

```
.docstube/
  manifest/
    manifest.json                  # schemaVersion, docstube version, locales, page index,
                                   # config/ia content hashes, coverage-obligation ledger
    pages/<locale>/<pageId>.json   # per-page shard: entity tree, ledger + evidence,
                                   # assessments, flags, matching confidence
    structure/<groupId>.json       # structural findings scoped to a nav group
  criteria/                        # review criteria (YAML — human-owned; feedback writes here)
  instructions/                    # writing instructions (YAML — human-owned)
  knowledge/                       # KnowledgeNeed / KnowledgeFact records (public data format)
docstube.yml · ia.yml · glossary.yaml
docs-site/                         # the generated, self-contained Astro site (ejected)
```

- **Machine-owned committed state is canonical sorted-key JSON** (harness-state-v2 decision 12):
  compact, fast, byte-stable when content is unchanged → minimal diffs. Humans read the
  **semantic delta rendered into the PR summary** ("page X: 3 claims re-verified, 1 added; de:
  stale→ready"), not raw shard diffs. Human-owned files (docstube.yml, ia.yml, glossary,
  criteria, instructions) STAY YAML with the comment-preserving round-trip rule.
- **One file per page per locale** is the merge-tolerance unit: two PRs touching different pages
  never conflict. `manifest.json` holds only slow-moving index data. Page-scoped structural
  findings live in page shards; group findings in one structural shard per nav group.
- Flags live **in the page shard they belong to** (they travel with the entity through branches);
  the flag queue is a derived view. Cross-page/system-level flags live in `manifest.json`.
- Shard writes are deterministic (canonical key order); the reconciler's staged output is
  published atomically (§9.4). No `versions/` frozen shards in 0.1.0 — the snapshot store ships
  with the v1.x versioning release; the half-built version-cut/state code is parked, not deleted.

### 5.2 Local — derived, never committed

`db.sqlite` (better-sqlite3 + Drizzle) is a **rebuildable view** of manifest + runs: entity index,
symbol→entity reverse map, flag queue, knowledge queue, structural-finding index, run/job/step
state for the dashboard timelines. Losing it loses nothing; `docstube` rebuilds it on demand
(`state doctor` path). `cache/` holds the agent-call cache keyed by input hashes. `runs/` holds
journaled run logs and **staged (not yet published) work** (uploaded as Actions artifacts in CI).

### 5.3 Docset boundary

A docset IS an initialized directory (PRODUCT §3.11). Discovery rule implemented in core: when
walking source roots, an outer project prunes any subtree containing a nested docstube root
(`docstube.yml`). No docset abstraction exists in config, state, or contracts. Cross-project
aggregation is an explicit non-goal for v1.

### 5.4 CI flow

checkout → rebuild sqlite from manifest → typed-fingerprint diff vs committed manifest →
`generate --ci` reconciles affected units into staged state → on plan completion, the kernel
emits the **PublicationDecision** (§9.5) + the **output inventory** (exact paths + hashes) → the
Action validates fail-closed, stages only declared paths, opens the PR carrying docs + manifest
shards + flags atomically → auto-merge per PRODUCT §3.3. Frozen runs: staged work persists across
workflow runs (no rebilling), `publishable: false`, no mergeable PR.

## 6 · Plugin kernel

### 6.1 Plugin shape

A plugin is an ES module whose default export is `definePlugin({...})` from `@docstube/plugin-sdk`:

```ts
import { definePlugin } from '@docstube/plugin-sdk';

export default definePlugin({
  apiVersion: 1,
  name: 'docstube-plugin-shellcheck',
  version: '0.1.0',
  permissions: { network: false, exec: ['shellcheck'], writableRoots: [] },
  register(host) {
    host.verifier({ id: 'shellcheck', appliesTo: { blockTypes: ['code-example'], languages: ['bash', 'sh'] }, verify: … });
  },
});
```

`register(host)` receives a typed registration surface — the only door into the kernel:

| Hook | Registers | 0.1.0 status |
|---|---|---|
| `host.verifier(…)` | deterministic check: `appliesTo` selector + capability declaration (which claim classes/predicates it can check — this replaces a bare `proves` boolean and feeds the class-appropriate-evidence rule, §4.2) + `verify(ctx, entities) → VerifierResult[]` | shipped, several built-ins |
| `host.languagePack(…)` | grammar, symbol extraction, typed fingerprints, API extractor, snippet toolchain | shipped (TS; Python/Java follow) |
| `host.contentSource(…)` | non-code truth sources (OpenAPI/AsyncAPI ingestion) | shipped |
| `host.importer(…)` | foreign-docs → reference context (Mintlify/GitBook/ReadMe/Confluence) | contract shipped, adapters incremental |
| `host.searchProvider(…)` | search indexing at assemble (Pagefind built-in, emitter-owned contract) | contract shipped |
| `host.component(…)` | theme registry component + Zod metadata schema + renderToHTML/renderToMarkdown → block type (§3.2) | shipped |
| `host.structuralCheck(…)` | deterministic structural detector emitting candidate findings (§12); AI structural assessment stays kernel-owned | contract shipped |

There is **no deployment hook in 0.1.0**: deployment is out of product scope (local artifact +
"Deploying" docs page, PRODUCT §4.1); a deploy adapter surface returns with the v1.x public-MCP/
hosting work. Verifier results feed the gate; `check` CLI kinds are derived from registered
verifiers — the kernel has no hardcoded list. Non-built-in verifier evidence is labeled
`project-defined-check` (§4.2).

### 6.2 Loading & resolution

`docstube.yml`:

```yaml
plugins:
  - docstube-plugin-shellcheck        # npm package (user's own dependency)
  - ./plugins/company-style.ts        # local path, relative to repo root
```

- Built-in plugins (`verifiers`, `lang-typescript`, theme components, Pagefind) are registered
  through **exactly the same host API**, just imported statically by core — same code path after
  resolution, so the API stays honest.
- npm plugins resolve from the user's project `node_modules` (they are the user's dependency,
  reviewed like any dependency). Local paths load with Node type-stripping (`.ts` allowed).
- Standalone-binary caveat: npm/local plugins are loaded via real-filesystem `import()`, which
  `@yao-pkg/pkg` supports; plugin code never gets bundled into the binary.

### 6.3 Trust posture

v1 enforcement is honest-but-soft, matching the npm trust model (PRODUCT §3.4): permissions are
**declared** in the manifest, shown to the user at install/first-run, recorded in the committed
manifest; the host enforces writable roots for file writes made through host-provided FS handles
and refuses undeclared exec of known toolchains. Full sandboxing is explicitly not claimed.

### 6.4 API versioning

`apiVersion` is an integer on every plugin. The host supports a declared range; loading a plugin
with an unsupported version is a clean, actionable error. Until docstube 1.0 the SDK may break
between minors (documented loudly); after 1.0 it is semver-stable.

## 7 · Codemap, fingerprints & language packs

### 7.1 Host / pack split

- The **host** (`packages/codemap`) owns: file walking, tree-sitter runtime, the symbol table,
  normalized symbol hashing, typed fingerprints, and `diffSymbols(old, new)` used by the
  reconciler.
- A **language pack** (plugin) owns: grammar binding, extraction queries (what is a symbol, what
  is its normalized signature), typed-fingerprint emission, the API-truth extractor (TypeDoc for
  TS, griffe for Python, a javadoc-model extractor for Java), and the snippet toolchain
  (typecheck command + run recipe) used by verifiers.
- Symbol record: `{ hash, kind, containerPath, file, span, visibility, apiTruth?, project? }`.
  The hash is the grounding key (§4); `containerPath` exists for human display and citation
  links only.
- OpenAPI/AsyncAPI ingestion is a **content source** producing symbol-like records
  (`op:GET /v1/users`) that participate in grounding and verification (curl-vs-spec checks)
  exactly like code symbols.

### 7.2 Typed fingerprint ladder (pipeline-v2 decision 4)

Language packs emit up to three fingerprints per symbol:

- `signature` — the normalized public shape (what shape claims subscribe to);
- `cited-value` — specific extractable values (defaults, constants) that value claims subscribe
  to individually;
- `body` — implementation content (rare subscriptions).

Ledger claims record which fingerprint kind they depend on (§4.2 dependencies). Files no pack can
parse (package.json, poms, README, …) fall back to **whole-file content hashing** — the ladder is
never less safe than hashing; precision improves per file type. `.d.ts` files parse as pure
signatures. TypeScript gains the signature/value/body separation (Python is already
signature-shaped).

Large-repo hardening gets its own design doc before implementation; the contracts already leave
room (symbol records carry a `project` field, codemaps are chunkable by directory, coverage is a
declared obligation state).

## 8 · Agent runtime — the unified harness

Founder decision (2026-07): docstube owns **one agent loop**; vendor CLIs are model+billing
transports, not harnesses. This buys uniform observed-reads provenance, uniform caching,
record/replay, and purpose-built tools, across every provider including subscription billing.

### 8.1 Concepts

```
AgentTask      what to do: { taskKind, systemPrompt, userPrompt, tools, workspace, budget, output }
ToolSurface    docstube-defined tools (evidence tools + generic escape hatches, § 8.2)
Transport      how to reach a model: capability-declared adapter
Transcript     full turn/tool-call record → observedReads derive from tool calls
Cache          transcript keyed by hash(model, prompts, tool surface, budget, input refs)
```

- Tool handlers execute **in the harness** (our process): every content-bearing tool result is
  recorded with a content hash → observed-reads lineage is a side effect of architecture, not
  agent cooperation.
- `output` is either `mdx+ledger` (writer, via `submit_page`) or a Zod schema (structured tasks:
  review findings, risk-critic findings, IA proposals, feedback categorization, translation unit
  maps); schema outputs are validated with bounded repair retries.
- Budgets are hard: max turns, max tool calls, approximate token caps. Budget semantics are
  **admission control over durable reconciliation** (PRODUCT §3.5): the plan persists before
  agent calls; per-page-family reservations from historical usage; work units that don't fit
  aren't started; staged work survives freezes without rebilling.

### 8.2 Tool surface (harness-state-v2 decisions 1–2)

**Codemap-backed evidence tools are primary**; all content-bearing results emit evidence handles
(symbol hash or file/span/hash), which closes the old grep provenance hole:

- `search_symbols` — semantic/structured symbol search over the codemap;
- `read_symbol(hash, include: signature | body | tests | usages)`;
- `find_examples` / `find_tests` — usage discovery for a symbol;
- `read_ranges` — batched span reads;
- `check_snippet` — preflight a code sample against the pack toolchain;
- `validate_page_draft` — preflight MDX + ledger (marker/ledger agreement, component props,
  coverage-linter pass) before `submit_page`.

Generic tools (`read_file`, `grep`, `glob`, `list_dir`) stay as **escape hatches**; grep gains
case-insensitivity, glob filter, optional context lines, and observed-read recording. No bundled
ripgrep for 0.1.0 — the JS implementation is adequate once agents stop using text search as the
primary mechanism.

**PageContextPack** (HIGH-RISK, load-bearing contract): a typed, token-budgeted per-page evidence
pack — purpose, primary persona, assigned symbols/topics, relevant signatures/tests/examples,
neighbor-page summaries, source trust labels, **declared omissions**. Replaces "first 200 codemap
symbols in codemap order". Hard constraint: the pack is **additive** — on-demand exploration
always remains available; a badly built pack may degrade a page but must never wall the writer
off from the repository. Its composition is a registered eval-queue experiment before the design
freezes.

**Read roots:** generated output (outDir, docs content, `.docstube/` state) is **excluded from
agent read roots** (the dogfood self-reference incident: a writer read generated MDX as source,
413k input tokens). Prior content enters only through explicit labeled inputs: the prior version
of the SAME page for diff-edit repair, and neighbor-page summaries in the context pack.
PROVISIONAL — the prior-docs access policy is a registered eval-queue experiment.

**Roles are routed for real:** writer, reviewer (persona review, fidelity review), risk critic,
translator (economy-class default), researcher (auto-answer agent; web search only on transports
that support it). `agents.roles.*` config maps roles to models per transport; a parsed-but-
unrouted role is a false affordance and a bug.

### 8.3 Transports

| Transport | Mechanism | Billing |
|---|---|---|
| `anthropic-api` | Messages API, native tool use; we run the loop | API key |
| `openai-compatible` | Chat Completions/Responses tool calling against any base URL (presets: OpenAI, Ollama, …) | API key / local |
| `claude-cli` | vendor CLI in non-interactive mode, built-in tools disabled, our ToolSurface exposed via MCP (stdio), structured output stream parsed | Claude subscription |
| `codex-cli` | same pattern via `codex exec --json` + MCP (read-only sandbox; `apply_patch` can't be disabled — scratch-dir + discard) | ChatGPT subscription |
| `google` (internal/experimental) | Antigravity CLI `agy` (gemini-cli's replacement) — NOT a public transport: an upstream bug drops subprocess stdout, so it is reachable only via `DOCSTUBE_TRANSPORT_OVERRIDE`. Public v1 transports are the four rows above | API key |
| `replay` | plays recorded transcripts; the only transport CI may use | free |

Transports declare capabilities (`toolInjection: native | mcp | none`, `structuredOutput`,
`parallelism`, `webSearch`, billing signal kind: dollars | plan-window | tokens) so the harness
can degrade explicitly, never silently — the billing signal drives the transport-appropriate
spend copy (PRODUCT §3.9.2), and the transport data-flow table in the docs is generated from this
registry. Exact vendor flags are re-verified from primary sources at implementation time.
*(Vendor capability matrix: `knowledge/design/agent-transports.md`.)*

### 8.4 Record/replay & evals

Every live run can record; fixtures are sanitized transcripts committed under the consuming
package's test fixtures. CI never calls a live model (CLAUDE.md rule). The **eval queue**
(harness-state-v2 decision 9) is separate infrastructure: ~10+ live end-to-end generation runs in
the secrets-gated workflow that A/B one policy and score outputs. It must exist before the
context-pack design freezes so the prior-docs and pack-composition questions can be settled with
evidence.

## 9 · Pipeline: the generate reconciler

`docstube generate` is the single idempotent reconciler (PRODUCT §3.5). The orchestrator (core)
computes desired vs published state and runs the minimal plan as journaled, resumable steps.
Stage I/O contracts live in `contracts` (`pipeline-stages.ts`); stages are kernel code that
*calls* plugins and the agent runtime. There is no separate maintenance command: first run,
incremental run, and continuation after interrupt/freeze are the same code path.

```
codemap+fingerprints → reconcile (dirty set) → per page:
    [context pack → write | diff-edit repair] → deterministic verify
    → risk critic ∥ primary-persona review (+ sampled secondary advisory)
    ⇄ bounded retry with findings attached
→ structure pass → localization phase → gate → staged atomic publish → assemble
```

### 9.1 Reconciliation

Inputs to the dirty set: typed-fingerprint diffs (claim subscriptions, §7.2), knowledge-fact /
instruction / criteria / glossary / config-fragment dependency records (§4.2), ia.yml changes,
theme/version changes. `generate --explain` runs reconciliation only and prints the plan + cost
estimate (non-generative). Answer/feedback acceptance triggers the same path immediately for
exactly the dependent pages (PRODUCT §3.10).

### 9.2 Write vs repair

- **Write** — one writer per page, always (no section fan-out). A cheap PagePlan step may
  produce an outline (it also feeds the structural snapshot). The writer works from the
  PageContextPack + evidence tools and submits MDX + ledger via `submit_page` (validated:
  markers, ledger anchoring, coverage linter, component props).
- **Diff-edit repair** — an invalidated page gets an edit task: prior page + relevant code diff +
  the stale claims. Extends the retry prior-draft pattern. Escalates to full regeneration when
  the edit fails verification or structure changed.

### 9.3 Verify, critique, review

- Deterministic verifiers run per entity/claim; evidence assignment per §4.2 (class-appropriate).
- **Risk critic** (one per page): receives the claim/evidence summary — not the raw repo — and
  hunts misleading framing, dangerous omissions, wrong emphasis; also adjudicates within-page
  structural candidates (§12).
- **Persona review**: only the page's primary persona gates; criteria outcomes are recorded per
  entity; secondary personas run advisory on a sampled subset. **Unrun reviews are non-blocking**
  (publish with the "AI-reviewed" label withheld; the reconciler schedules the review as pending
  work); reviews that ran and found required criteria not-met block.

### 9.4 Gate & staged atomic publish

Pass → stage. Deterministic fail → bounded retry loop with findings. Unresolvable → flag +
proceed (non-blocking kinds) or block (PRODUCT §3.3 list). On budget freeze, staged work persists
in the journal/cache and **nothing publishes until the whole plan completes**; the next
`generate` resumes and publishes atomically. `refine` regenerates into the same staged state and
accepts only under the Pareto gate (PRODUCT §3.5): re-run affected obligations/checks/criteria +
a virtual group check; accept iff ≥1 target finding resolves or a criterion flips to met and
nothing regresses; otherwise discard byte-for-byte and journal why. Persona-fit comparison is
categorical per-criterion (blinded paired judgment; tie = rejection).

### 9.5 PublicationDecision (CI)

`generate --ci` emits one typed artifact bound to the candidate tree:

```
PublicationDecision = { schemaVersion, toolVersion, baseSha, sourceSha, candidateHash,
                        executionState, planCounts, gateResult, regressions[],
                        publishable, autoMergeEligible, reasonCodes[] }
```

plus the **output inventory** (every path the reconciler wrote, with hashes). The Action
validates and enforces **fail-closed**: absence, mismatch, missing shards, deferred work, or
unknown reason codes → no merge. Regressions come from the semantic ledger comparison (§4.3).
The debt policy (no-new-debt, delta-scoped), coverage-obligation ratchet, and recorded waivers
are evaluated here. Full-auto merge requires a GitHub App/PAT; plain `GITHUB_TOKEN` runs are
labeled approval-assisted. `doctor --ci --json` preflights transport auth and GitHub
permissions/settings before any model spend. One supported reusable workflow invokes only
`generate --ci`.

### 9.6 Depth policy

IA nodes carry a `depth` budget (`overview | standard | deep`) plus a global page-count target;
the IA-proposal task must respect it, and the review stage checks conformance. Full spec in
`knowledge/design/depth-policy.md` when the wizard IA step is implemented.

## 10 · Emission: site, corpus, projections

### 10.1 Navigation & routing

The emitter consumes `ia.yml` (schema v2, §13.1) and produces a **resolved nav tree**: group|page
kind, route, ancestry, per-locale availability, active state, prev/next, exception markers —
slug-prefix reconstruction is gone. One nested layout in 0.1.0 (collapsible groups, real home
page, breadcrumbs, prev/next, related links). Locale routing goes through one **route matrix**
(pageId × locale) resolving to `ready | stale | source-fallback | unavailable` with
reader-visible explanations; emit consumes explicit route resolution, never infers from file
presence.

### 10.2 Trust UI primitives

Theme proof primitives implement PRODUCT §4.1 reader UX: the trust chip with literal denominator,
per-claim popovers (quiet default), the page-level "show evidence" toggle, always-visible marks
for unchecked/contradicted/needs-input claims, the "Files consulted" lineage disclosure, and the
generated `/verification/` trust-report page. Private-repo evidence defaults to link/path-only;
excerpt embedding is a policy opt-in read from config.

### 10.3 Canonical machine corpus

One corpus, everything else a projection: resolved IA/routes, page/entity IDs + revision, locale
+ publication state, normalized Markdown (per-component `renderToMarkdown`), claim ledger with
dispositions, optional evidence detail. Projections: `llms.txt` (discovery map), per-page `.md`
twin, `llms-full.txt` (only under a documented size threshold, else split by IA section), and the
**local MCP server** — `search_docs`, `read_page`, `read_structure` over a precomputed index,
with `includeEvidence: summary | full`; ready-to-paste client config emitted. No public MCP
endpoint in 0.1.0.

### 10.4 Search

Emitter-owned contract: `data-pagefind-body` on the article only; nav/TOC/proof-chrome/footers
excluded; metadata (pageId, IA section, locale, publication state); locale-scoped by default with
an explicit all-languages mode; source-fallback pages excluded from localized coverage;
breadcrumbs + section excerpts in results.

## 11 · Localization architecture (i18n-lifecycle-v2)

### 11.1 LocalizationPlan

Canonical MDX + claim ledger parse into ordered translatable **units** (headings, paragraphs,
list items, table cells, frontmatter title/description, localizable component props) with unitId,
owning entity, source text hash, placeholder inventory, claim refs. Code, links, identifiers, and
component structure never enter model output. Model call unit = **page-locale batch** of changed
units (context supplied read-only); the kernel validates the returned unit map
(missing/duplicate/placeholder-altered → rejected) and reassembles MDX from the canonical AST —
structure correct by construction.

### 11.2 Strict isomorphism

Locales are renditions of one canonical structure: same entity and claim IDs, localized anchors,
code blocks byte-identical by construction. The canonical claim ledger lives in the source
locale; rendition evidence references canonical evidence at an exact source revision.

### 11.3 Scheduler, memory, budget

- **Translation memory** persists per unit: source text hash + locale pair + placeholder shape +
  relevant glossary revisions + policy version. Unchanged units never retranslate.
- The **localization scheduler** reconciles desired vs published per locale × page with states
  `absent | pending | ready | stale | failed`; every source-mutating command drives it;
  new-locale backfill enters here over committed source artifacts (no writer/verifier reruns).
- Localization is a **separate phase** after canonical generation + the structure pass, bounded
  concurrency grouped by locale, its own budget partition — locale spend can never freeze source
  generation. Fidelity review = one bilingual reviewer-role call per page-locale revision; one
  correction cycle on failure, then fallback. Failures are non-blocking and dead-letter per
  PRODUCT §4.1.
- Terminology profiles bootstrap per locale in two one-time calls, auto-committed with
  `origin: ai` entries; user edits win permanently. Glossary changes invalidate only dependent
  units.

## 12 · Structural quality (quality-ci-reader-v2 §17–22)

- **Contracts:** `StructuralFinding` (stable semantic key, code, entity|nav-group scope, detector
  {deterministic | ai-assessed, id, version, model}, impact, status open|resolved|suppressed,
  evidence, repairTargets, scopeFingerprint) and `StructuralSnapshot` — both in `contracts`,
  separate from verifier results, flags, and the claim ledger.
- **Execution:** a dedicated structure pass over the staged canonical site builds the snapshot
  (IA groups/cohorts, briefs, primary personas, profiles, outlines, block types, claim subjects,
  PagePlans, changed scopes, prior findings). Deterministic detectors (built-in + plugin
  `host.structuralCheck`) emit candidates; targeted kernel-owned AI assessment adjudicates
  applicability; within-page judgment rides the risk critic.
- **Evidence ladder:** explicit ia.yml rule → deterministic finding; accepted profile →
  deterministic; AI-derived plan conformance → labeled AI-derived; inferred sibling convention →
  candidate only + per-page AI applicability; uncertain → no finding. Conservative 0.1.0
  candidate rules: cohort ≥ 4, same profile, source locale only, no inference across mixed roles.
  AI-derived profiles are derived state; ia.yml holds only user intent.
- **Flagship detector:** sibling shared-facet asymmetry (outline matrix → ≥60% threshold →
  group assessor → per-missing-page expected | not-applicable | uncertain → one group finding
  targeting only 'expected' pages), plus outline integrity and within-page duplicate-section /
  misplaced-example candidates. A planted eval ships (5/8 siblings have Pricing; two should; one
  legitimately exempt).
- **Lifecycle:** auto-resolve only after the same scope is re-evaluated; suppression carries
  reason + scope fingerprint and reopens on material change. All findings non-blocking in 0.1.0;
  budget exhausted → scope `pending`, publish allowed. Never the flag queue, never the CI
  `structural-change` flag kind. `refine` expands group findings to minimal repair targets and
  consumes them under the Pareto gate (§9.4).

## 13 · Config & knowledge contracts

### 13.1 Config

- `docstube.yml` = intent only; Zod schema in `contracts` → generated JSON Schema (shipped +
  SchemaStore). Programmatic edits exclusively through the `yaml` Document API wrapper in core
  (comment/format preserving — hard requirement). No reserved-but-ignored blocks: the schema
  contains no `autonomy` or `screenshots` fields; `versions.current` is the one forward-compat
  field (v1.x versioning).
- **docType is a preset layer** (PRODUCT §3.9.5): archetype detection fills defaults for the
  explicit fields `visibility` · `productKind` · `coverage` · personas; pipeline code branches
  ONLY on the explicit fields, never on the archetype.
- `ia.yml` **schema v2**: a discriminated union `kind: group | page`; groups carry a stable
  `groupId`; pages carry `primaryPersona`, a page brief, a source scope (feeds the coverage
  obligation ratchet), `depth`; optional `structureProfile`, consistency `rules`, and
  `structuralExceptions`. Local ia.yml edits are authoritative (no confirmation step —
  PROVISIONAL per pipeline-v2); CI structural changes remain a blocking flag kind.
- `glossary.yaml` = terms, edited through a typed editor (feedback writes through it). Same
  round-trip rule.
- Secrets: env/keychain only, never in config or state. Transport credentials are referenced by
  name (`ANTHROPIC_API_KEY`), never stored.

### 13.2 Knowledge & feedback contracts (dx-knowledge-v2)

- **KnowledgeNeed**: { id, subject (entity thread / symbol / topic), kindOfMissingFact (slot),
  classification: external-world | derivable | intent-policy, status, originating pages,
  auto-answer research trail }. Dedup key = subject + slot; text similarity only suggests merges.
- **KnowledgeFact**: { id, needId, content, origin: ai | user | github-answer, authorship,
  citations (required when origin: ai), status incl. `needs-revalidation`, supersession chain,
  entity thread + answer-time revision fingerprint }.
- **FeedbackEvent** (immutable) → categorization emits typed scoped **proposals** { intent,
  scope, affected consumers, canonical wording, confidence } routed to one or more consumers
  (instructions, criteria, glossary, config-patch preview). Entity/page scope default; promotion
  explicit. Learned criteria compose with built-ins.
- Generation units record consumed fact/instruction/criteria/glossary/config-fragment IDs+hashes
  (the `dependencies` record, §4.2) — the causal-invalidation mechanism.
- The Action's question comment thread ingests `/answer` replies (write-access authors only) on
  the next run — pull-based, no webhooks.
- Committed knowledge under `.docstube/knowledge/` is a **public data format at release** (ships
  before 0.1.0, or the migration becomes an adopters-wide break).

### 13.3 Onboarding session (dx-knowledge-v2 decision 1)

First-run state is an **onboarding-session draft** owned by core (local, not committed):
autosaved, functional before `docstube.yml` exists; agent-backed setup steps (IA proposals, theme
extraction) accept the draft directly. "Generate" atomically: preflight (provider auth, doctor
checks) → commit config through the round-trip writer → run the reconciler → emit the site →
land on the live preview. Bare `docstube` routes on config presence (setup vs dashboard),
TTY-safe (`--no-open`, URL printing).

## 14 · Testing strategy

- **Golden fixture repo** (`evals/fixtures/`): a small synthetic TS library with planted defects
  docstube must catch — the end-to-end harness for a verification product. The planted-defect
  **conformance suite** measures assurance depth (it informs quality; it does not gate the launch
  claim). A planted structural-quality eval ships with the sibling detector.
- Per-verifier known-defect fixtures (unit level).
- Agent-dependent stages test against **recorded transcripts** (replay transport). CI never calls
  live models; the **eval queue** (§8.4) is the only live-model surface and is secrets-gated.
- Entity matching, symbol hashing/fingerprints, ledger anchoring, manifest round-trip:
  property-style unit tests (stability under whitespace/reorder/rename perturbations).
- Playwright for local-ui (when that surface lands).

## 15 · Salvage verdicts

The pre-rewrite implementation (~27k lines) was built against the old plan without the entity
model, plugin kernel, or unified harness. Verdicts:

| Area | Verdict |
|---|---|
| `apps/cli` citty entry, lazy command loading, telemetry wrapper | **adapt** (command set changes: reconciler-only `generate`, no maintenance alias) |
| Release/binary/install-script/telemetry infra (`scripts/`, `stacktape.ts`, CI workflows) | **keep** |
| `apps/web`, `apps/install-events` | **keep** (separate workstream / done) |
| `packages/theme` tokens + MDX component set | **adapt** (registry contract + renderToMarkdown are new; visual layer salvageable) |
| `packages/contracts`, `core`, `agent`, `codemap`, `extractors`, `verifiers` | **rewrite** against §3–§13 |
| `apps/local-ui` | **rewrite** later (contracts-first; UI is a pure client of core's tRPC surface) |
| `apps/github-action` | **adapt** (thin wrapper survives; it becomes a PublicationDecision enforcer) |
| Version-cut/state code | **parked**, not deleted (v1.x versioning ships the lifecycle whole) |

*(Refined per-file notes: `knowledge/design/salvage-inventory.md`.)*

## 16 · Design-record index

Where the binding decisions live (all folded into PRODUCT.md and this document on 2026-07-21):

| Domain | Record | Landed here |
|---|---|---|
| Claim ledger, evidence, identity threading | `knowledge/design/trust-model-v2.md` | §3–§4 |
| i18n lifecycle & translation architecture | `knowledge/design/i18n-lifecycle-v2.md` | §11 |
| Reconciler, fingerprints, repair, staged publish | `knowledge/design/pipeline-v2.md` | §7.2, §9 |
| Versioning cut, primary personas, deployment posture | `knowledge/design/release-scope-v2.md` | §9.3, §10, PRODUCT §4 |
| Harness tools, context pack, state/JSON shards, docsets | `knowledge/design/harness-state-v2.md` | §5, §8 |
| First-run/config DX, knowledge & feedback contracts | `knowledge/design/dx-knowledge-v2.md` | §13 |
| Structural quality, CI decision, reader UX, release posture | `knowledge/design/quality-ci-reader-v2.md` | §9.5, §10, §12 |
| Agent transport capability matrix | `knowledge/design/agent-transports.md` | §8.3 |
| Salvage inventory | `knowledge/design/salvage-inventory.md` | §15 |
| Depth policy (pending full spec) | `knowledge/design/depth-policy.md` | §9.6 |
