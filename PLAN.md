# docstube implementation plan

This is the source of truth for the desired docstube product end state.

The operational task queue for the overnight implementation runner is
[`tasks.md`](tasks.md). `PLAN.md` defines the architecture and boundaries; `tasks.md` turns it
into ordered, reviewable implementation work.

## What docstube is

docstube is an open-source MIT CLI with a localhost web UI and GitHub Action that reads a
codebase and generates verified, audience-targeted, always-current documentation.

The core loop:

1. Build a structural map of the source repo.
2. Ask a writer agent to draft MDX pages from source-grounded context.
3. Ask reviewer agents, one per persona, to check audience fit and correctness risks.
4. Run deterministic verifiers for MDX, code samples, imports, links, D2 diagrams, glossary
   links, and API references.
5. Retry or flag pages until each page clears the gate.
6. Render a self-contained Astro + React docs site owned by the user.
7. On later code changes, regenerate only affected pages using provenance.

docstube uses the user's own AI access: official `codex`, `claude`, and `gemini` CLIs or direct
API keys. docstube servers must never receive source code, prompts, generated docs, paths, or
project names.

## Hard boundaries

These features are intentionally not designed yet. Do not implement them; reserve only the named
extension points.

- Screenshot capture: reserve a `screenshots:` config object, a `Screenshot` component name, and
  optional/lazy Playwright capability. Do not build capture flows.
- Migration import: existing docs can be used as reference context, but do not build a full
  migration system.
- Hosted backend internals: keep the client-side seam, but do not design remote state or hosted
  product logic.
- Additional agent adapters beyond Codex, Claude, Gemini, and direct API.
- Native UI screenshots, versioned docs, docs i18n, Mermaid, and docstube-operated free hosting.
- Marketing website product work in `apps/web`.

## Package ownership

Reusable packages in `packages/`:

- `contracts`: S0 Zod schemas, shared types, IDs, result taxonomies, JSON Schema generation, and
  public contract snapshots.
- `core`: config loading/editing, state, orchestrator, pipeline, tRPC routers, local server
  wiring.
- `agent`: `AgentAdapter` interface, built-in adapters, mock/record-replay harness, usage cap
  helpers.
- `verifiers`: deterministic checks and result taxonomy.
- `codemap`: tree-sitter structural map, normalized hashes, language plugins.
- `extractors`: TypeDoc and griffe API reference extraction.
- `theme`: internal source for generated/ejected Astro + React theme code.
- `skills`: shipped `SKILL.md` sources and non-destructive materialization helpers.

Runnable apps in `apps/`:

- `cli`: published `docstube` npm package and binary entry point. Keep startup lazy and light.
- `local-ui`: Vite + React localhost setup, progress, and review UI.
- `github-action`: wrapper around `docstube refresh` that opens PRs.
- `install-events`: public install telemetry Lambda.
- `web`: public marketing website, handled by a separate workstream.

Entry files are named by responsibility, such as `core.ts`, `agent.ts`, and `cli.ts`. Do not add
`index.ts` barrels.

## Config, state, and contracts

`docstube.yml` is the user-owned config file. It is typed YAML, edited with the `yaml` package's
Document API so comments and formatting survive wizard edits.

Config describes intent only:

- docs type, site metadata, output dir, layout, theme tokens, component selection
- personas and agent choices
- source context references
- usage caps
- glossary and IA file locations
- reserved `screenshots:` object

Config never stores:

- secrets
- pipeline state
- scores or findings
- provenance
- transcripts
- generated MDX

Large declarative content lives beside config:

- `ia.yml`: committed information architecture.
- `glossary.yaml`: committed glossary terms and aliases.
- `.docstube/manifest.yml`: committed portable provenance/state manifest.
- `.docstube/criteria/`: committed persona and doc-type criteria.
- `.docstube/instructions/`: committed feedback-derived writing instructions.

Machine-local state is ignored:

- `.docstube/db.sqlite*`
- `.docstube/cache/`
- `.docstube/runs/`

S0 must freeze these contracts before product logic expands:

- config family schemas: `docstube.yml`, `ia.yml`, `glossary.yaml`
- findings schema
- criteria checklist schema
- feedback record schema
- provenance manifest schema
- normalized adapter event schema
- cache-key derivation spec
- deterministic-check result taxonomy
- generated-page frontmatter and section-ID marker convention
- page and section ID rules
- async versioned `StateBackend`
- `AgentAdapter` interface including permissions and sandbox requirements
- registry component metadata schema
- tRPC routers and snapshot
- `.docstube/` Drizzle schema

## CLI and UX

Commands:

- `docstube wizard`: starts the localhost web UI. If config is missing, it opens the setup wizard;
  if config exists, it opens the project dashboard/control plane.
- `docstube generate`: runs generation from existing config. It fails with a clear instruction to
  run `docstube wizard` when config is missing.
- `docstube generate --fresh`: discards machine-local generation state and regenerates from config.
- `docstube refresh`: default maintenance command used locally and by the GitHub Action. It checks
  all pages by default, regenerates stale pages, and refreshes vendored theme/project assets when
  the installed docstube version changes them.
- `docstube refine`: improves existing generated pages, prioritizing the lowest quality scores and
  failed deterministic gates first.
- `docstube validate`: deterministic validation of config-family files.
- `docstube check --all`: run all deterministic checks over the project.
- `docstube check <d2|mdx|snippet|config> <file>`: single deterministic check for agents and
  humans.
- `docstube status`: summarize config, manifest, page status, dirty/stale pages, and refinement
  candidates.
- `docstube doctor`: check the local runtime, optional tools, agent CLI availability, and project
  setup without leaking secrets.
- `docstube upgrade`: update docstube itself for standalone installs and guide npm users to the
  right package-manager command. `docstube upgrade --project` updates vendored generated-site
  assets/config migrations without regenerating documentation content unless required.
- `docstube help [command]` and `docstube version`.

Long runs are resumable. Re-running continues from durable state; `--fresh` discards state.
Progress streams to terminal and web UI.

Usage caps are approximate by design. Read vendor local usage logs where possible, freeze with
margin at the configured cap, persist state, and make resume obvious.

## Agent layer

`@docstube/agent` defines one adapter contract.

Built-ins:

- Codex adapter: reference implementation.
- Claude adapter.
- Gemini adapter, treated as volatile.
- Direct API adapter with provider presets and custom OpenAI-compatible or Anthropic-compatible
  base URLs.

Rules:

- Use official vendor CLIs only.
- Before major adapter implementation, re-check current CLI flags, JSON modes, MCP support, and
  subscription terms from primary sources or installed CLI help. These facts are perishable.
- Parse structured JSON/JSONL only. Do not scrape human text for contracts.
- Every invocation declares writable roots and read-only source roots.
- Non-interactive flags are mandatory. A hung permission prompt is a bug.
- After every agent step, check `git status` and fail if files outside allowed write roots
  changed.
- Cache every agent step by prompt hash, input file hashes, model id, adapter id, and adapter
  version.
- CI uses mock or record/replay adapters only. Live agents are limited to a secrets-gated workflow.

## Context and skills

The prompt is for the task, contracts, brief, personas, and pointers. Large reusable guidance is
materialized as skills/files:

- writing conventions
- component references
- D2 guide and validation script
- verifier self-check instructions
- role-specific rules for writer, reviewer, verifier, and editor agents

Skills are non-destructive:

- namespaced under `.docstube/skills/` or another S0-defined generated location
- ownership markers for generated files
- user edits preserved where possible

External sources are starting context, not truth:

- files and directories
- private git repos fetched with user-owned credentials
- MCP servers configured by the user's own agent environment

Code wins every conflict.

## Deterministic verifiers

Implement a fixed result taxonomy in S0, then concrete checks in S2.

Required verifier families:

- config-family schema validation
- MDX compile and component prop validation
- TypeScript code snippets via `tsc`
- Python snippets via `pyright` where available
- import/path resolution
- internal and external links
- D2 syntax/rendering
- glossary link rules
- generated-page frontmatter and page/section ID checks
- API reference consistency

Verifier and reviewer outputs are structured findings plus an explainable derived page quality
score. The score is stored for prioritization, status, and `docstube refine`; it must be derived
from criteria results, deterministic gates, and finding severity, never from an opaque raw judge
number.

## Theme and generated docs site

Generated docs sites are self-contained. The theme source is generated/ejected into the user's
repo rather than used as a public runtime dependency.

Required output:

- Astro + React docs site
- layouts: `single-tree` and `sectioned`
- Pagefind search
- registry components with Zod metadata
- D2 diagrams, sketch mode by default
- glossary autolinking at build time
- `llms.txt` and `llms-full.txt`
- docs-serving MCP server
- sitemap, canonical URLs, metadata, Open Graph, structured data
- FAQ/AEO writer guidance with verifiable claims
- default-on, disableable "Generated by docstube" footer credit

Mermaid is not supported.

## Local UI

The local UI has one shared keystone component: `NavTree`. Reuse it in normal layout flow for:

- IA editing in the setup wizard
- generation progress
- review navigation

Setup wizard:

- doc type
- project context
- personas
- optional source references
- IA proposals with editable NavTree
- theme token editor and preview
- site metadata
- component selection
- writes `docstube.yml` and `ia.yml` with comment-preserving edits

Generation dashboard:

- NavTree progress statuses
- CI-style per-page step timeline over persisted state
- live preview pane
- cap-freeze banner
- terminal progress mirror

Review UI:

- production-rendered page preview
- element/section/page/docs feedback
- categorizer routes feedback to criteria, writing instructions, glossary, or config changes
- approve/regenerate actions

Do not build a node-graph canvas for the pipeline.

## Pipeline and incremental engine

Pipeline shape:

1. Load and validate config family.
2. Build codemap and source digests.
3. Resolve IA and page briefs.
4. Schedule pages depth-first for fast time-to-first-page.
5. Run writer.
6. Run persona reviewers.
7. Run deterministic verifiers.
8. Convert every issue into structured findings.
9. Compute explainable page quality scores from findings and criteria.
10. Retry/refine on blockers and majors within configured limits.
11. Persist state, provenance, quality scores, transcripts, cache keys, and rendered outputs.
12. Surface passed/flagged pages to the UI immediately.

Refresh:

- detect changed symbols via normalized hashes
- map symbols to pages using seed context, observed reads, and citations
- bias toward regenerating or flagging when provenance is uncertain
- run a topology pass so pages remain internally consistent
- refresh vendored generated-site theme/project assets when docstube ships compatible updates
- update `.docstube/manifest.yml`

Refinement:

- rank pages by quality score, blocker/major findings, failed deterministic gates, recency, and
  whether the page blocks other pages
- work on the worst pages first within usage caps
- preserve provenance and user-approved content unless the refinement explicitly targets it
- stop when pages meet the configured quality threshold or the configured max rounds/caps are hit

Changelog generation uses the same pipeline over git history. Diffs are ground truth. Optional
"why" context comes through user-owned MCP sources such as Jira or Linear.

## GitHub Action

The Action wraps `docstube refresh`:

- checkout
- load portable manifest
- resolve dirty pages
- regenerate
- open a PR with changed pages and reasons

It must never push silently. Runner secrets provide agent credentials. Parallel runs must not
corrupt shared state.

## Telemetry

Runtime telemetry is PostHog, opt-out, and disclosed on first run.
Do not add a dedicated `docstube telemetry` command. Telemetry preference belongs in first-run
UI/config/env handling.

Allowed runtime telemetry:

- command names
- durations
- coarse error kinds
- adapter/model choice
- retry rates
- anonymous environment facts needed for product quality

Forbidden telemetry:

- source code
- prompts
- generated docs
- paths
- project names
- repo contents
- secrets

Installer telemetry is narrower than runtime telemetry:

- started/succeeded/failed
- version
- platform
- installer name
- source
- duration
- coarse error kind

Installer telemetry must never fail installation.

Privacy wording rule: docstube never sends source to docstube servers; source may be sent to the
user's chosen AI provider through the user's own credentials, exactly like their normal agent
usage.

## Build order

Use [`tasks.md`](tasks.md) for the concrete queue. It preserves this dependency order:

| Step | Focus | Gate |
|---|---|---|
| S0 | contracts, schemas, state skeleton, mock agent, walking skeleton | stable interfaces and fixture proof |
| S1 | codemap and extractors | deterministic source facts |
| S2 | verifiers | trust gate before generation |
| S3 | agent adapters and usage caps | replayable agent execution |
| S4 | theme and generated site | real render target |
| S5 | orchestrator, skills, source loaders, changelog | integrated generation loop |
| S6 | refresh engine and `LocalBackend` | efficient updates |
| S7 | local UI | wizard, progress, review |
| S8 | CLI polish, GitHub Action, runtime telemetry | user-facing shells |
| S9 | evals and dogfood | calibrated quality proof |

Each task must close with focused tests or fixtures plus `pnpm run validate` unless the task file
states a narrower check. Do not skip ahead to UI, adapters, or theme polish before S0 contracts
and the walking skeleton pass.

Definition of done: a stranger runs `npx docstube wizard`, accepts generated config, runs
`npx docstube generate` on a TS or Python repo and gets a verified, polished docs site, then
`docstube refresh` keeps it current and `docstube refine` improves the worst pages first.

## Release and deployment reference

End-state release and deployment behavior:

- `pnpm deploy:prod` deploys Stacktape production resources.
- Release workflow input `version=0.0.x` publishes npm, binaries, checksums, scripts, and the
  GitHub Release.
- Stacktape install-script publishing runs automatically when `STACKTAPE_API_KEY` exists.
- npm package `docstube` runs compiled JS using the user's Node installation.
- no-Node users install standalone binaries through `https://installs.docstube.dev/*.sh` or
  `https://installs.docstube.dev/windows.ps1`.

Do not change release infrastructure during product implementation unless a failing release test
requires it.

## Risks

- Vendor CLI volatility: keep adapters version-aware, structured, and tested with record/replay.
- Judge unreliability: derive explainable quality scores from criteria, deterministic gates, and
  structured findings; do not store opaque raw judge scores.
- Provenance error: capture seed, observed reads, and citations; regenerate under uncertainty.
- Scope drift: obey hard TBD boundaries and `tasks.md`.
- Non-determinism: content-addressed cache, structured outputs, replay fixtures, and evals.

## Decision log

docstube / docstube.dev; MIT; BYO compute; hosted tier later; Node LTS; pnpm; TypeScript 6;
Zod; YAML config; comment-preserving YAML edits; Hono; tRPC; Vite/React/Tailwind; Astro/React
theme generated into user repos; Pagefind; D2 only; better-sqlite3 and Drizzle; tree-sitter;
TypeDoc and griffe; Oxlint/Oxfmt; Vitest; record/replay agents; PostHog opt-out telemetry;
Codex reference adapter; direct API fallback; findings with blocker/major/minor; explainable
quality score derivation;
layouts limited to `single-tree` and `sectioned`; NavTree reused across wizard/progress/review;
no node-graph pipeline canvas; Stacktape deployment; GitHub Releases for binaries;
Stacktape-hosted install scripts; npm publishes only `docstube` for now.
