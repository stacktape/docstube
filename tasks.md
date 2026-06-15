# docstube implementation tasks

This file is the ordered queue for `node run-overnight.ts`.

Rules for every task:

- Read `AGENTS.md` and `PLAN.md` first.
- Implement only the current task.
- Do not rebuild or redesign project infrastructure that `PLAN.md` marks as already done.
- Do not implement anything under the hard TBD boundaries.
- Keep packages private unless the task explicitly says otherwise.
- Prefer tests and fixtures close to the code being implemented.
- Run `pnpm run validate` before marking the task done unless a narrower check is explicitly
  justified in the task output.

## Task 00 - Contract foundation and fixture helpers

Goal: make `packages/contracts` the single home for shared S0 contracts.

Scope:

- Add fixture helpers for valid/invalid contract cases.
- Add shared primitive schemas for IDs, paths, severities, timestamps, JSON values, and package
  version metadata.
- Add a small public API from `packages/contracts/src/contracts.ts` without barrels or
  `index.ts`.
- Keep existing placeholder exports compatible only if they are useful.

Acceptance:

- Contract primitives have focused tests.
- Invalid fixtures produce useful Zod errors.
- `pnpm run validate` passes.

## Task 01 - Config family schemas and YAML round trip

Goal: implement typed config-family contracts.

Scope:

- `docstube.yml` schema.
- `ia.yml` schema.
- `glossary.yaml` schema.
- JSON Schema generation for the config family.
- Runtime validation helpers.
- YAML Document API edit helper that preserves comments and formatting.
- Reference fixture files that match the examples in `PLAN.md`.

Acceptance:

- Valid and invalid config fixtures are tested.
- JSON Schema output is snapshot-tested.
- A commented YAML fixture is edited and retains comments/formatting.
- `pnpm run validate` passes.

## Task 02 - Findings, criteria, feedback, manifest, and page IDs

Goal: freeze the rest of S0 content/state contracts.

Scope:

- Findings schema with blocker/major/minor taxonomy.
- Criteria checklist schema.
- Feedback record schema.
- `.docstube/manifest.yml` schema.
- Generated-page frontmatter schema.
- Page ID and section ID validators.
- Section marker convention helpers.
- Cache-key derivation spec and tests.

Acceptance:

- Every schema has valid/invalid fixtures.
- Page/section uniqueness and presence checks are tested.
- No numeric quality score is introduced.
- `pnpm run validate` passes.

## Task 03 - State database, StateBackend, and tRPC contracts

Goal: create the state and API skeleton that later pipeline work can target.

Scope:

- Drizzle schema for local `.docstube/db.sqlite`.
- Migration creation and fresh DB test.
- Async versioned `StateBackend` interface.
- `LocalBackend` stub implementing the contract with deterministic in-memory or SQLite behavior.
- Contract test suite reusable by future backends.
- tRPC router skeleton and AppRouter type snapshot.

Acceptance:

- Fresh DB migration test passes.
- `StateBackend` contract test passes against `LocalBackend`.
- tRPC types compile and have a snapshot/diff test.
- `pnpm run validate` passes.

## Task 04 - Agent contract, mock adapter, walking skeleton, and packaging smoke

Goal: finish the S0 exit demo without real agents.

Scope:

- `AgentAdapter` interface in `packages/agent`.
- Normalized adapter event schema.
- Permissions/sandbox declaration types.
- Mock adapter.
- Record/replay fixture format.
- Minimal walking skeleton: fixture repo -> replay writer output -> deterministic check -> state
  persisted -> one page rendered to HTML by minimal MDX compile.
- Packaging smoke job or test for `@yao-pkg/pkg` with a minimal CLI, `better-sqlite3`, and one
  lazy dynamic import.

Acceptance:

- No live AI calls.
- Walking skeleton fixture passes end to end.
- Packaging smoke runs in CI or is wired so CI will run it.
- `pnpm run validate` passes.

## Task 05 - Codemap and API extractors

Goal: implement deterministic source facts.

Scope:

- Tree-sitter codemap package structure.
- Normalized hashes for TS/JS and Python fixture files.
- Language plugin seam.
- TypeDoc extraction for TS/JS fixtures.
- griffe extraction for Python fixtures.
- Stable serialized source-map output consumed by later pipeline work.

Acceptance:

- Fixture tests cover changed symbol detection.
- Extracted API references come from tools, not LLM text.
- Unsupported languages degrade to file-level tracking.
- `pnpm run validate` passes.

## Task 06 - Deterministic verifier registry and core checks

Goal: implement the verifier framework and core checks before agent generation expands.

Scope:

- Verifier registry in `packages/verifiers`.
- Shared deterministic-check result taxonomy.
- Config-family check.
- MDX compile check.
- Component prop validation hook.
- TypeScript snippet check.
- Python snippet check where `pyright` is available, with graceful skip otherwise.
- Import/path check.
- Link check.
- D2 check.
- Glossary rules check.

Acceptance:

- Each verifier has focused fixtures.
- Verifier failures produce structured findings.
- Optional tools skip explicitly, not silently.
- `pnpm run validate` passes.

## Task 07 - Built-in agent adapters and usage caps

Goal: implement real adapter surfaces behind the frozen contract.

Scope:

- Codex adapter.
- Claude adapter.
- Gemini adapter.
- Direct API adapter with provider presets and custom base URLs.
- CLI version detection.
- JSON/JSONL parsing.
- Timeout and child-process kill behavior.
- Rate-limit handling.
- Usage-cap estimation helpers.
- Post-run guard that fails if an agent mutates files outside writable roots.

Acceptance:

- Re-check installed CLI help or primary vendor docs before relying on flags.
- Unit tests use mocks and record/replay fixtures only.
- No CI path calls real agents.
- `pnpm run validate` passes.

## Task 08 - Theme, registry, glossary, D2, llms, and SEO

Goal: make generated writer output render as a real static docs site.

Scope:

- Astro + React generated theme source in `packages/theme`.
- Registry component metadata schema usage.
- Initial component set needed by the writer.
- Layouts: `single-tree` and `sectioned`.
- Pagefind search integration.
- D2 build support with sketch mode default.
- Glossary remark plugin.
- `llms.txt` and `llms-full.txt`.
- Docs-serving MCP server.
- Sitemap, canonical URLs, metadata, Open Graph, structured data.
- "Generated by docstube" footer credit, default on and disableable.

Acceptance:

- Fixture docs site builds.
- Glossary and D2 fixtures render.
- No generated docs site depends on public `@docstube/theme`.
- `pnpm run validate` passes.

## Task 09 - Skills and source loaders

Goal: materialize reusable agent guidance and source context safely.

Scope:

- Role-scoped skills for writer, reviewer, verifier, and editor.
- Component reference skill.
- D2 authoring/validation skill.
- Writing convention skill.
- Non-destructive materialization with ownership markers.
- Source loaders for files/directories and private git refs.
- MCP source pass-through using the user's agent configuration.
- Source digest format.
- Drift report skeleton.

Acceptance:

- Materialization preserves user-edited files where promised.
- Source loaders never store secrets.
- Conflict handling documents that code wins.
- `pnpm run validate` passes.

## Task 10 - Orchestrator, gate, retry, and changelog pipeline

Goal: build the main generation loop over mocks/replay first, then adapters.

Scope:

- Config loading and run initialization.
- Page scheduler with depth-first time-to-first-page behavior.
- Writer, reviewer, verifier orchestration.
- Findings merge logic.
- Retry/refinement loop.
- Passed/flagged page states.
- Persisted transcripts and cache keys.
- Changelog generation over git diffs.
- FAQ/AEO writer guidance.

Acceptance:

- Integration fixture uses replay adapters and deterministic verifiers.
- No live AI calls in CI.
- Failed gates are reproducible from persisted state.
- `pnpm run validate` passes.

## Task 11 - Incremental engine and LocalBackend

Goal: make `docstube update` regenerate only affected pages.

Scope:

- Provenance capture: seed context, observed reads, citations.
- Normalized-hash dirty detection.
- Symbol-to-page mapping.
- Conservative uncertainty behavior.
- Topology consistency pass.
- `.docstube/manifest.yml` update.
- Durable `LocalBackend` implementation over SQLite.

Acceptance:

- Fixture repo changes dirty the expected pages.
- Uncertain provenance regenerates or flags rather than skipping.
- Manifest is portable and committed-friendly.
- `pnpm run validate` passes.

## Task 12 - Local UI wizard, dashboard, and review

Goal: implement the localhost control plane over the real tRPC surface.

Scope:

- Shared in-flow `NavTree`.
- Setup wizard.
- IA proposal editing.
- Theme token editor with preview.
- Generation dashboard with page statuses and timelines.
- Live preview pane.
- Cap-freeze banner.
- Review UI with feedback scopes and approve/regenerate actions.
- Feedback categorizer integration through mocks/replay.

Acceptance:

- UI is usable at desktop and mobile sizes.
- No node-graph pipeline canvas.
- Playwright or equivalent local screenshots verify the main screens are nonblank and not
  overlapping.
- `pnpm run validate` passes.

## Task 13 - CLI commands and runtime telemetry

Goal: make the user-facing CLI drive the implemented core.

Scope:

- `generate`.
- `generate --yes`.
- `update`.
- `validate`.
- `check <d2|mdx|snippet|config> <file>`.
- `telemetry <enable|disable|status>`.
- Lazy command loading.
- `NODE_COMPILE_CACHE` where appropriate.
- Runtime telemetry opt-out and disclosure.

Acceptance:

- CLI startup stays light.
- Command tests cover success and failure paths.
- Telemetry tests prove forbidden data is not sent.
- `pnpm run validate` passes.

## Task 14 - GitHub Action

Goal: make the Action wrap `docstube update` and open PRs.

Scope:

- Action inputs and outputs.
- Checkout/update flow.
- Secret handling.
- PR creation with changed pages and reasons.
- Idempotent reruns.
- Concurrency protection.

Acceptance:

- Action fixture or local action test uses mocks/replay.
- Action never pushes generated docs silently.
- No live AI calls in CI.
- `pnpm run validate` passes.

## Task 15 - Evals, live gated workflow, and dogfood

Goal: add quality proof after the integrated product works.

Scope:

- Pick and wire promptfoo or evalite.
- Gold-set fixtures.
- Judge-vs-human agreement checks.
- Context ablations.
- Skill-on/off comparisons.
- Secrets-gated live workflow.
- Dogfood workflow that generates docstube's own docs and deploys the result.

Acceptance:

- Normal CI remains deterministic and does not call live agents.
- Live workflow is manual/nightly and secrets-gated.
- Dogfood output is reviewable before deploy.
- `pnpm run validate` passes.
