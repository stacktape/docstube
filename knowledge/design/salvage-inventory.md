# Salvage inventory — pre-rewrite code vs the new PRODUCT.md contracts

**Date:** 2026-07. Input to [ARCHITECTURE.md](../../ARCHITECTURE.md) §12 (which holds the
summary verdicts). This file records the per-package findings so rebuild work knows exactly what
to harvest. Once a package is rebuilt, its entry here is historical.

## Contract gap (drives every verdict)

The old code is a page → section system with page-level provenance (`{seedHash, reads[],
citations[]}`) and binary passed/flagged status. Missing vs the new contracts: block/claim entity
grain with stable IDs and open block-type enum; guarantee levels; symbol-hash provenance (old
symbol IDs are `lang:path:name` — name-keyed, the exact stale-naming class §3.2 forbids); a plugin
kernel (none exists — only a local verifier Map and a codemap plugin list); version/locale ID
dimensions. Contracts, manifest, and pipeline data shapes are rewrites; much machinery survives.

## Per-package harvest notes

### packages/agent — highest-value salvage
`agent.ts` (~840 lines): `AgentAdapter` interface; CLI adapters for codex/claude/gemini
(subprocess, `--json`/`stream-json`, `--permission-mode acceptEdits`, sandbox `--add-dir`) plus
direct API (anthropic `/v1/messages`, openai `/responses`, custom baseUrl → covers Ollama).
Sandbox `writableRoots` + `assertChangesWithinWritableRoots` post-run guard. Record/replay
fixtures (`createReplayAgentAdapter`, canonical-JSON input match). Rate-limit/timeout detection,
`estimateUsage`/`usageExceedsCaps`, `parseAdapterJsonEvents` stream normalizer.
**Harvest:** sandbox guard, replay machinery, usage estimation, event normalizer, subprocess
patterns. **Gap:** no observed-reads capture (old adapters let the vendor harness own tools);
the new unified-harness design inverts this — our loop, our tools.

### packages/core — harvest four specific pieces
- `config-yaml.ts` — comment-preserving `yaml` Document round-trip (`editYamlDocument`,
  `setYamlIn`). The §3.9.5 hard requirement. Keep near-verbatim.
- `incremental-engine.ts` — `detectChangedSources`, `resolveDirtyPages` (already implements the
  uncertain⇒flag bias rule), `runTopologyConsistencyPass`. Adapt: rekey pages → entities +
  symbol hashes.
- `db-schema.ts` + drizzle/better-sqlite3 + migrations — adapt into the derived-view framing;
  add entity/guarantee tables. Manifest writer was monolithic → rewrite as per-page shards.
- `page-orchestrator.ts` — prompt assembly + cached agent step (prompt+input hash) + retry loop
  + transcript journaling patterns.
Everything else in core (pipeline-run, state-backend, trpc-router, local-server, scaffold):
rewrite — page-level provenance and passed/flagged status are baked in deepest here; no run
journal, no resumability, no plugin kernel.

### packages/verifiers — adapt bodies, rewrite registry
Real check bodies to port into verifier plugins: MDX compile (`@mdx-js/mdx` evaluate +
react-dom render), component-props (Zod per registry component), TS snippet
(`ts.transpileModule` — upgrade to real typecheck), Python snippet (pyright subprocess),
import-path resolution, internal+external links, D2 compile (`@terrastruct/d2`), glossary rules,
api-ref consistency, config-family, frontmatter. Registry was a plain Map → becomes plugin
registrations. No guarantee-level assignment existed. Missing v1 verifiers: shellcheck,
JSON/YAML-vs-schema, curl-vs-OpenAPI, env-var, CLI-flag, snippet runtime sandbox execution,
codemap-grounded D2 node/edge verification. `audit` entirely absent.

### packages/codemap — adapt hashing, rewrite identity
`normalizeSourceForHash` + `normalizedSourceHash` + `diffSourceMaps` (added/changed/removed by
hash) directly serve the maintain stage — adapt. Symbol `id = lang:path:name` is name-keyed →
rewrite to structural key. tree-sitter was declared but unused (regex parsers — throwaway).

### packages/extractors — dissolve into language packs
TypeDoc extraction (real) and griffe subprocess (with mock fallback) are useful; move into
`lang-typescript` / `lang-python`. Realign symbol ids to hashes.

### packages/theme — adapt heavily
`theme.ts` (1329 lines) emits a self-contained Astro site. Keepers: llms.txt/llms-full.txt,
sitemap/canonical/OG/structured-data, Pagefind index build, D2 SVG render, glossary remark
auto-linker, the 19-component set + Zod prop schemas (seed of the block-type registry),
site-emission approach (generated package.json/astro.config/DocLayout.astro/theme-components.tsx).
Rewrites: MCP server must expose DeepWiki-convention tools (`ask_question`,
`read_wiki_structure`, `read_wiki_contents`) — old one exposes only resources; a real token
system (config `theme.tokens` existed but was never wired into emission — wizard token editor
wrote tokens that never reached the site); versioned/i18n routing; per-entity citations +
guarantee badges on rendered pages. Shard the giant file.

### packages/skills — adapt
`materializeBuiltInSkills` (ownership marker + user-edit preservation), `redactSecrets`,
drift report. Missing: the `plugin-authoring` skill (strategically central). Skill prose needs
rewriting for the new pipeline.

### apps/cli — adapt (HANDOFF-confirmed)
citty registration, lazy per-command dynamic imports, `NODE_COMPILE_CACHE` warmup,
telemetry-wrapped dispatch, PostHog opt-out telemetry with first-run disclosure + never-send
list + `DO_NOT_TRACK`, `upgrade-command.ts` self-update (524 lines). Fix: `check` kinds were a
hardcoded `d2|mdx|snippet|config` union (~cli.ts L193) → derive from registered verifiers.
Add `audit` + `plugin` commands.

### apps/local-ui — rewrite against new surfaces; keep stack + NavTree concept
React 19 + Vite + Tailwind v4 + tRPC/react-query wiring is right. Old wizard is a flat form,
not the 10-step flow; no flag queue; no entity-anchored feedback.

### apps/github-action — adapt
Git client (checkout/branch/commit/push), PR create/update/find, changed-file detection,
job-summary reporter are real. Rebuild around auto-merge-by-default + exception rules + flag PR
comments + atomic docs+manifest+flags PR. Old `dryRun` mode is a removed feature — drop.

## Infrastructure to preserve as-is

- tsdown per-package build (`--format esm --dts --target node24`) + the **`docstube-source`
  export condition** (dev runs TS source via `--conditions=docstube-source`; used by
  `scripts/dev.ts`).
- tsconfig layering (base + root refs), vitest.config.ts, oxlint/oxfmt configs.
- `scripts/release/`: `build-binary.ts` (@yao-pkg/pkg, 5 platforms), `set-version.ts`,
  install-script templates + prepare/publish, `stage-cli-assets.ts`; Changesets flow.
- `stacktape.ts` (hosted minimal surface: web bucket, install-events Lambda, PostHog secrets).
- `.github/workflows/`: ci.yml (3-OS `pnpm validate` matrix), release.yml, dogfood.yml,
  evals-live.yml.
- `scripts/dogfood/build-dogfood.ts`, `scripts/evals/run-evals.ts` + `evals/gold-set.json`
  (the eval harness structure), `scripts/dev.ts` (wizard dev loop).
