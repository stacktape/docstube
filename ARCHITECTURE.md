# docstube — ARCHITECTURE.md

> How the system described in [PRODUCT.md](PRODUCT.md) is built. PRODUCT.md owns *what and why*;
> this document owns *how*. If they disagree, PRODUCT.md wins on product semantics and this
> document wins on code structure.

**Status:** authoritative as of 2026-07. Written for the v1 rewrite (branch `rewrite-for-v1`).
Supersedes the pre-rewrite package layout. The §7 open questions of PRODUCT.md are resolved here
(each resolution cross-references its PRODUCT.md question).

---

## 1 · Design stance

Three properties dominate every choice below, in priority order:

1. **Contracts outlive implementations.** The entity model, manifest format, plugin API, and
   agent-task schema are the load-bearing walls. They are Zod schemas in one dependency-free
   package, versioned with explicit `schemaVersion` fields, designed to be added-to without
   breaking. Implementations behind them are expected to be rewritten several times.
2. **The kernel is small and boring.** Trusted core = pipeline orchestration, entity model,
   provenance, state, verification *gating* (not the verifiers themselves), plugin host, agent
   harness. Everything else — verifiers, language packs, content sources, importers, deployment,
   search, theme components — is a plugin behind the same API third parties get.
3. **Determinism wherever possible; journaling where not.** Agent calls are the only
   non-deterministic component. They are isolated behind the agent runtime, cached by input hash,
   and record/replayable. Everything downstream of a transcript is a pure function and is tested
   as one.

## 2 · Workspace layout

pnpm workspaces, `apps/*` + `packages/*`. Entry files named by responsibility, never `index.ts`.

| Workspace | npm name | Published | Role |
|---|---|---|---|
| `packages/contracts` | `@docstube/contracts` | no (private) | Zod schemas + types only: entity model, provenance, manifest, config, findings, run events, agent-task schema. Zero heavy deps (`zod` only). Everything depends on it; it depends on nothing. |
| `packages/plugin-sdk` | `@docstube/plugin-sdk` | **yes** (experimental until 1.0) | The public plugin API: `definePlugin`, hook interfaces, plugin manifest schema, capability/permission declarations. Re-exports the contract types plugins need. Second published package after `docstube`. |
| `packages/agent-runtime` | `@docstube/agent-runtime` | no | The unified BYO-AI harness: task spec, tool surface, loop, transcripts/observed reads, cache, record/replay, transports (API + vendor CLIs). Depends only on `contracts`. |
| `packages/codemap` | `@docstube/codemap` | no | Codemap host: tree-sitter runtime, symbol table, normalized symbol hashing, symbol diff. Language packs plug in; the host is language-agnostic. |
| `packages/core` | `@docstube/core` | no | The kernel: config load/round-trip, state (manifest shards + sqlite view), plugin host, pipeline orchestrator, entity extraction/matching, run journal, local control-plane server (Hono + tRPC). |
| `packages/lang-typescript` | `@docstube/lang-typescript` | no | First language pack (plugin): tree-sitter-typescript grammar wiring, symbol extraction rules, TypeDoc API extraction, snippet typecheck/run toolchain. `lang-python`, `lang-java` follow the same shape. |
| `packages/verifiers` | `@docstube/verifiers` | no | First-party verifier plugins (each verifier a plugin, named exports from concrete files). |
| `packages/theme` | `@docstube/theme` | no | Astro + React theme, component registry (each registry component contributes a block type with a Zod metadata schema). Generated sites vendor it — user sites never depend on the package at runtime. |
| `packages/skills` | `@docstube/skills` | no | Shipped `SKILL.md` sources (incl. `plugin-authoring`) + materialization helpers. |
| `apps/cli` | `docstube` | **yes** | The binary. citty, lazy command loading, no heavy deps at startup. |
| `apps/local-ui` | — | no | Vite + React wizard/dashboard/review/flag-queue SPA served by `docstube wizard`. |
| `apps/github-action` | — | no | Action wrapper around the CLI. |
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

## 3 · Entity model (resolves PRODUCT §7.1)

### 3.1 Shape

```
Page ─┬─ Section (heading-delimited, nestable)
      └─── Block (paragraph · heading · list · table · code-example ·
                  blockquote · image · component:<Name> · …)
             └─ Claim (finest grain: a checkable assertion anchored to a text span)
```

- **Page** — one MDX file, one shard in the manifest. Identity: `pageId` (random, stable);
  slug/path are mutable attributes, never identity.
- **Section** — heading-delimited subtree. Exists for feedback anchoring and partial regeneration
  at section granularity.
- **Block** — one MDX block-level node. The unit verifiers usually operate on.
- **Claim** — an assertion extracted from a block ("`retries` defaults to 3", "the CLI has a
  `--fresh` flag"), anchored to a text span. The unit of the public metric (defects per 100
  claims) and the finest provenance grain.

### 3.2 Block types are an open enum

`blockType` is a `string`, not a union. Two sources of types:

1. **Core primitives** (owned by `contracts`): `paragraph`, `heading`, `list`, `table`,
   `code-example`, `blockquote`, `image`, `thematic-break`, `raw`.
2. **Registry components**: every theme/plugin component registered with a Zod props/metadata
   schema contributes `component:<Name>` (e.g. `component:Callout`, `component:Diagram`,
   `component:ApiReference`). Plugins add block types by registering components — no kernel change.

Every entity carries `metadata: unknown`; the **block-type registry** (assembled at plugin-load
time) maps `blockType → Zod schema` and validates metadata at extraction and at verification time.
Unknown block types are a structural finding (never a crash): flagged, guarantee capped at
`out-of-domain`.

### 3.3 Identity, addressing, and stability

```
EntityAddress = { version, locale, pageId, entityId }
entityId      = e.g. "s_01J…" (section) · "b_01J…" (block) · "c_01J…" (claim)
```

- IDs are random (ULID-style, no timestamp semantics relied upon), minted by the kernel — never
  by agents — and never reused after deletion.
- Version and locale are **address dimensions, not ID mutations**: the same `entityId` in
  `v2/en` and `v2/de` is the same logical entity (its translation); frozen version snapshots
  carry the IDs they were cut with.
- Code-example blocks may carry `variants: { [language]: … }` (multi-language samples are v2;
  the model supports them now, per PRODUCT §4.2).

### 3.4 Where IDs live: sidecar, not inline

MDX files stay clean — no ID props sprinkled through prose, nothing the writer agent must
preserve. Instead:

- A deterministic **extraction pass** (remark/MDX AST) parses each page into its entity tree.
- The tree, with IDs, lives in the page's manifest shard (§5). Claims anchor by
  quote + prefix/suffix (web-annotation style), not by character offsets (robust to whitespace).
- On regeneration, a **matching pass** aligns the new tree against the old shard:
  match by (blockType, structural path, content similarity) in that order; matched entities keep
  their IDs, unmatched get fresh IDs, unmatched-old are tombstoned (feedback attached to them is
  surfaced, not silently dropped).
- The **assemble stage injects** `data-entity-id` (and guarantee/citation affordances) into
  rendered HTML from the sidecar, so the review UI can anchor feedback without IDs polluting MDX.

Exception: registry components accept an optional explicit `entityId` prop for cases where the
matcher is insufficient (e.g. two adjacent identical callouts); the extractor honors it.

### 3.5 One schema, four consumers

The same entity record carries: provenance (§4), guarantee level (§4), feedback anchors (review
UI), and the regeneration map (symbol → entities). No consumer gets a private variant schema.

## 4 · Provenance & guarantee levels

Per entity:

```yaml
provenance:
  sources:                 # grounding: why we believe this
    - symbol: "ts:sha256:…"   # normalized symbol hash (§7 codemap)
      file: src/retry.ts
      span: [12, 48]
      commit: abc123
  seedContext: [ctx:…]     # context-assembly inputs handed to the writer
  observedReads:           # every file the writer agent actually read (harness-recorded)
    - { file: src/retry.ts, contentHash: "…" }
  verifications:
    - { verifier: "code-typecheck-ts", pluginVersion: "…", result: pass, at: <commit> }
guarantee: proven | scored | out-of-domain
```

- **Symbol hashes, never names** (PRODUCT §3.2): the hash covers kind + container path +
  normalized declaration content. A rename changes the hash → remove+add → dependent entities
  regenerate. This is intended behavior, not a bug: renames are exactly when stale-name
  hallucinations happen.
- Guarantee is computed, never asserted: `proven` requires at least one passing deterministic
  verification covering the claim class; `scored` = criteria-based AI review only;
  `out-of-domain` = declared unprovable. Roll-up is pessimistic: a section's displayed level is
  the minimum of its children.
- The signed-manifest contract (PRODUCT §4.2, architect-only) reserves a `signature` field per
  shard; unsigned in v1.

## 5 · State model (resolves PRODUCT §7.11)

### 5.1 Committed — the lockfile pattern

```
.docstube/
  manifest/
    manifest.yml               # schemaVersion, docstube version, versions+locales, page index,
                               # config/ia content hashes, coverage stats
    pages/<locale>/<pageId>.yml   # per-page shard: entity tree, provenance, guarantees, flags
    versions/<version>/…          # frozen snapshot shards for past versions (cut at release)
  criteria/                    # review criteria (feedback learning writes here)
  instructions/                # writing instructions (idem)
  knowledge/                   # tribal-knowledge answers, keyed to symbol/entity
docstube.yml · ia.yml · glossary.yaml
docs-site/                     # the generated, self-contained Astro site (ejected)
```

- **One file per page per locale** is the merge-tolerance unit: two PRs touching different pages
  never conflict on the manifest. `manifest.yml` holds only slow-moving index data.
- Flags live **in the page shard they belong to** (they travel with the entity through branches);
  the flag queue is a derived view. Cross-page/system-level flags live in `manifest.yml`.
- All YAML, all diffable; shard writes are deterministic (stable key order) so diffs are honest.

### 5.2 Local — derived, never committed

`db.sqlite` (better-sqlite3 + Drizzle) is a **rebuildable view** of manifest + runs: entity index,
symbol→entity reverse map, flag queue, run/job/step state for the dashboard timelines. Losing it
loses nothing; `docstube` rebuilds it on demand (`state doctor` path). `cache/` holds agent-call
cache keyed by input hashes. `runs/` holds journaled run logs (uploaded as Actions artifacts
in CI).

### 5.3 CI flow

checkout → rebuild sqlite from manifest → codemap symbol-diff vs committed manifest → regenerate
affected entities → PR carries docs + manifest shards + flags atomically → auto-merge per §3.3
of PRODUCT.md.

## 6 · Plugin kernel (resolves PRODUCT §7.6)

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

| Hook | Registers | v1 status |
|---|---|---|
| `host.verifier(…)` | deterministic check: `appliesTo` selector + `verify(ctx, entities) → VerifierResult[]` | shipped, several built-ins |
| `host.languagePack(…)` | grammar, symbol extraction, API extractor, snippet toolchain | shipped (TS; Python/Java follow) |
| `host.contentSource(…)` | non-code truth sources (OpenAPI/AsyncAPI ingestion) | shipped |
| `host.importer(…)` | foreign-docs → reference context (Mintlify/GitBook/ReadMe/Confluence) | contract shipped, adapters incremental |
| `host.deployTarget(…)` | deploy/PR-preview adapters (GitHub Pages, Vercel, Netlify) | contract shipped |
| `host.searchProvider(…)` | search indexing at assemble (Pagefind built-in) | contract shipped |
| `host.component(…)` | theme registry component + Zod metadata schema → block type (§3.2) | shipped |

Verifier results feed the gate; `check` CLI kinds are derived from registered verifiers — the
kernel has no hardcoded list.

### 6.2 Loading & resolution

`docstube.yml`:

```yaml
plugins:
  - docstube-plugin-shellcheck        # npm package (user's own dependency)
  - ./plugins/company-style.ts        # local path, relative to repo root
```

- Built-in plugins (`verifiers`, `lang-typescript`, theme components, Pagefind, deploy adapters)
  are registered through **exactly the same host API**, just imported statically by core —
  same code path after resolution, so the API stays honest.
- npm plugins resolve from the user's project `node_modules` (they are the user's dependency,
  reviewed like any dependency). Local paths load with Node type-stripping (`.ts` allowed).
- Standalone-binary caveat: npm/local plugins are loaded via real-filesystem `import()`, which
  `@yao-pkg/pkg` supports; plugin code never gets bundled into the binary.

### 6.3 Trust posture

v1 enforcement is honest-but-soft, matching the npm trust model (PRODUCT §3.4): permissions are
**declared** in the manifest, shown to the user at install/first-run, recorded in the lockfile-like
`manifest.yml`; the host enforces writable roots for file writes made through host-provided FS
handles and refuses undeclared exec of known toolchains. Full sandboxing is explicitly not claimed.

### 6.4 API versioning

`apiVersion` is an integer on every plugin. The host supports a declared range; loading a plugin
with an unsupported version is a clean, actionable error. Until docstube 1.0 the SDK may break
between minors (documented loudly); after 1.0 it is semver-stable.

## 7 · Codemap & language packs

- The **host** (`packages/codemap`) owns: file walking, tree-sitter runtime, the symbol table,
  normalized symbol hashing, and `diffSymbols(old, new)` used by the maintain stage.
- A **language pack** (plugin) owns: grammar binding, extraction queries (what is a symbol, what
  is its normalized signature), the API-truth extractor (TypeDoc for TS, griffe for Python, a
  javadoc-model extractor for Java), and the snippet toolchain (typecheck command + sandboxed run
  recipe) used by verifiers.
- Symbol record: `{ hash, kind, containerPath, file, span, visibility, apiTruth? }`. The hash is
  the provenance key (§4); `containerPath` exists for human display and citation links only.
- OpenAPI/AsyncAPI ingestion is a **content source** producing symbol-like records
  (`op:GET /v1/users`) that participate in provenance and verification (curl-vs-spec checks)
  exactly like code symbols.

Monorepo/multi-project (PRODUCT §7.3) and large-repo hardening (§7.4) get their own design docs
under `knowledge/design/` before implementation; the contracts already leave room (symbol records
carry a `project` field, codemaps are chunkable by directory, coverage is a declared state).

## 8 · Agent runtime — the unified harness (resolves BYO-AI design)

Founder decision (2026-07): docstube owns **one agent loop**; vendor CLIs are model+billing
transports, not harnesses. This buys uniform observed-reads provenance, uniform caching,
record/replay, and purpose-built tools, across every provider including subscription billing.

### 8.1 Concepts

```
AgentTask      what to do: { taskKind, systemPrompt, userPrompt, tools, workspace, budget, output }
ToolSurface    docstube-defined tools (read_file, grep, glob, list_dir, + task-specific)
Transport      how to reach a model: capability-declared adapter
Transcript     full turn/tool-call record → observedReads derive from read-tool calls
Cache          transcript keyed by hash(model, prompts, tool surface, budget, input refs)
```

- Tool handlers execute **in the harness** (our process): every `read_file` is recorded with a
  content hash → observed-reads provenance is a side effect of architecture, not agent
  cooperation.
- `output` is either `mdx` (writer) or a Zod schema (structured tasks: review findings, IA
  proposals, feedback categorization); schema outputs are validated with bounded repair retries.
- Budgets are hard: max turns, max tool calls, approximate token caps (freeze-with-margin
  semantics surface as the cap-freeze banner).

### 8.2 Transports

| Transport | Mechanism | Billing |
|---|---|---|
| `anthropic-api` | Messages API, native tool use; we run the loop | API key |
| `openai-compatible` | Chat Completions/Responses tool calling against any base URL (presets: OpenAI, Ollama, …) | API key / local |
| `claude-cli` | vendor CLI in non-interactive mode, built-in tools disabled, our ToolSurface exposed via MCP (stdio), structured output stream parsed | Claude subscription |
| `codex-cli` | same pattern via `codex exec --json` + MCP (read-only sandbox; `apply_patch` can't be disabled — scratch-dir + discard) | ChatGPT subscription |
| `google` | gemini-cli (OSS, maintained) with API-key/Vertex auth — its personal-subscription billing died 2026-06; Antigravity `agy` added once its headless surface is documentable | API key now; `agy` later |
| `replay` | plays recorded transcripts; the only transport CI may use | free |

Transports declare capabilities (`toolInjection: native | mcp | none`, `structuredOutput`,
`parallelism`) so the harness can degrade explicitly, never silently. Exact vendor flags are
re-verified from primary sources at implementation time (they churn); the transport interface is
designed so a vendor breaking its raw mode degrades that one transport, not the product.
*(Vendor capability matrix from the 2026-07 research pass: see `knowledge/design/agent-transports.md`.)*

### 8.3 Record/replay

Every live run can record; fixtures are sanitized transcripts committed under the consuming
package's test fixtures. CI never calls a live model (CLAUDE.md rule); evals that need live runs
live in the secrets-gated workflow.

## 9 · Pipeline

The orchestrator (core) runs stages as journaled, resumable steps. Stage I/O contracts live in
`contracts` (`pipeline-stages.ts`); stages themselves are kernel code that *calls* plugins
(verifiers, language packs, content sources) and the agent runtime.

```
codemap → context-assembly → write ⇄ (review ∥ verify) → gate → assemble → maintain
                                 ↑ bounded retry with findings attached
```

- Each stage consumes/produces typed artifacts persisted in the run journal
  (`.docstube/runs/<runId>/`), keyed by input hashes → resume = skip stages whose inputs are
  unchanged; the dashboard timeline is a pure renderer over this journal + sqlite.
- **Gate semantics** (kernel-owned, hardcoded v1 rules per PRODUCT §3.3): pass → ship;
  deterministic fail → retry loop (bounded) with findings; unprovable → flag + proceed.
  The v2 policy engine replaces the rule table, not the gate.
- **Maintain** = codemap diff → symbol→entity reverse map → affected entity set → regenerate at
  the smallest granularity whose context is self-contained (block for isolated blocks, else
  section, else page) → topology pass (links, glossary, nav, contradictions) restores cross-page
  consistency.

Depth/page-count policy (PRODUCT §7.2): IA nodes carry a `depth` budget (`overview | standard |
deep`) plus a global page-count target; the IA-proposal task must respect it, and the review
stage checks conformance. Full spec in `knowledge/design/depth-policy.md` when the wizard IA step
is implemented.

## 10 · Config

- `docstube.yml` = intent only; Zod schema in `contracts` → generated JSON Schema (shipped +
  SchemaStore). Programmatic edits exclusively through the `yaml` Document API wrapper in core
  (comment/format preserving — hard requirement).
- `ia.yml` = the IA tree with page briefs; `glossary.yaml` = terms. Same round-trip rule.
- Secrets: env/keychain only, never in config or state. Transport credentials are referenced by
  name (`ANTHROPIC_API_KEY`), never stored.

## 11 · Testing strategy

- **Golden fixture repo** (`evals/fixtures/`): a small synthetic TS library with planted defects
  docstube must catch — the end-to-end harness for a verification product.
- Per-verifier known-defect fixtures (unit level).
- Agent-dependent stages test against **recorded transcripts** (replay transport).
- Entity matching, symbol hashing, manifest round-trip: property-style unit tests (stability
  under whitespace/reorder/rename perturbations).
- Playwright for local-ui (when that surface lands). CI never calls live models.

## 12 · Salvage verdicts (resolves PRODUCT §7.10)

The pre-rewrite implementation (~27k lines) was built against the old plan without the entity
model, plugin kernel, or unified harness. Verdicts:

| Area | Verdict |
|---|---|
| `apps/cli` citty entry, lazy command loading, telemetry wrapper | **adapt** (per HANDOFF data point) |
| Release/binary/install-script/telemetry infra (`scripts/`, `stacktape.ts`, CI workflows) | **keep** |
| `apps/web`, `apps/install-events` | **keep** (separate workstream / done) |
| `packages/theme` tokens + MDX component set | **adapt** (registry contract is new; visual layer salvageable) |
| `packages/contracts`, `core`, `agent`, `codemap`, `extractors`, `verifiers` | **rewrite** against §3–§9 |
| `apps/local-ui` | **rewrite** later (contracts-first; UI is a pure client of core's tRPC surface) |
| `apps/github-action` | **adapt** (thin wrapper survives; pipeline underneath changes) |

*(Refined per-file notes from the salvage inventory: `knowledge/design/salvage-inventory.md`.)*

## 13 · Remaining §7 items — where they land

| PRODUCT §7 item | Resolution |
|---|---|
| 1 · block-type taxonomy | §3.2 here |
| 2 · depth policy | §9 sketch; full spec `knowledge/design/depth-policy.md` |
| 3 · monorepo | design doc before implementation; contracts carry `project` field now |
| 4 · large-repo hardening | design doc; declared-partial-coverage is already a manifest state |
| 5 · audit claim extraction | shares the claim schema (§3.1) + codemap matching; design doc `knowledge/design/audit.md` before build |
| 6 · plugin API surface | §6 here |
| 7 · tribal-knowledge UX | flags carry a `question` kind; delivery = PR comment + dashboard queue + digest issue (PRODUCT decision log); answers persist in `.docstube/knowledge/` |
| 8 · i18n verifier semantics | verifiers declare `localeScope: source-only | per-locale`; structural checks run per-locale, code checks source-only unless samples are localized |
| 9 · versioned-docs provenance | version is an address dimension (§3.3); frozen snapshots freeze shards (§5.1) |
| 10 · salvage | §12 here |
| 11 · state model | §5 here |
