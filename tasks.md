# docstube implementation tasks

This file is the ordered queue for `node run-overnight.ts`.

Rules for every task:

- Read `AGENTS.md` and `PLAN.md` first.
- Implement only the current task.
- Do not rebuild or redesign project infrastructure that `PLAN.md` marks as already done.
- Do not edit `PLAN.md`, `AGENTS.md`, `tasks.md`, release workflows, deployment files, or package
  infrastructure unless the task explicitly says to.
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
- Reserved `screenshots:` config object that accepts an object and is not used elsewhere.
- JSON Schema generation for the config family.
- Runtime validation helpers.
- YAML Document API edit helper that preserves comments and formatting.
- Reference fixture files that match the examples in `PLAN.md`.

Acceptance:

- Valid and invalid config fixtures are tested.
- JSON Schema output is snapshot-tested.
- The reserved `screenshots:` object validates without triggering any screenshot implementation.
- A commented YAML fixture is edited and retains comments/formatting.
- `pnpm run validate` passes.

## Task 02 - S0 content, page, verifier, and registry contracts

Goal: freeze the non-database S0 contracts that downstream packages must reuse.

Scope:

- Findings schema with blocker/major/minor taxonomy.
- Criteria checklist schema.
- Feedback record schema.
- `.docstube/manifest.yml` schema.
- Generated-page frontmatter schema.
- Page ID and section ID validators.
- Section marker convention helpers.
- Cache-key derivation spec and tests.
- Deterministic-check result taxonomy.
- Registry component metadata schema, including prop-schema references and component names.

Acceptance:

- Every schema has valid/invalid fixtures.
- Page/section uniqueness and presence checks are tested.
- Deterministic-check results and registry component metadata are snapshot-tested.
- Downstream packages can import these contracts from `@docstube/contracts`.
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

## Task 04 - Agent contract, mock adapter, and walking skeleton

Goal: finish the S0 exit demo without real agents or infrastructure churn.

Scope:

- `AgentAdapter` interface in `packages/agent`.
- Normalized adapter event schema.
- Permissions/sandbox declaration types.
- Mock adapter.
- Record/replay fixture format.
- Minimal walking skeleton: fixture repo -> replay writer output -> deterministic check -> state
  persisted -> one page rendered to HTML by minimal MDX compile.

Out of scope:

- Release, deploy, CI, and packaging workflow edits.
- New binary packaging infrastructure. It already works.

Acceptance:

- No live AI calls.
- Walking skeleton fixture passes end to end.
- The skeleton uses the S0 contracts from `@docstube/contracts`; it does not invent local shapes.
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

## Task 06 - Verifier registry and foundational checks

Goal: implement the verifier framework and the checks needed by the walking skeleton and config
flow.

Scope:

- Verifier registry in `packages/verifiers`.
- Shared use of the deterministic-check result taxonomy from `@docstube/contracts`.
- Config-family check.
- Generated-page frontmatter check.
- Page and section ID check.
- MDX compile check.
- Component prop validation hook using registry component metadata.

Acceptance:

- Each verifier has focused fixtures.
- Verifier failures produce structured findings.
- Verifiers reuse S0 contracts instead of local result shapes.
- `pnpm run validate` passes.

## Task 07 - Verifier content, code, link, D2, glossary, and API checks

Goal: complete deterministic verifier coverage before real generation expands.

Scope:

- TypeScript snippet check.
- Python snippet check where `pyright` is available, with graceful skip otherwise.
- Import/path check.
- Internal and external link check.
- D2 check.
- Glossary rules check.
- API reference consistency check against extractor output.

Acceptance:

- Each verifier has focused fixtures.
- Optional tools skip explicitly, not silently.
- API reference consistency failures become structured findings.
- `pnpm run validate` passes.

## Task 08 - Built-in agent adapters and usage caps

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

## Task 09 - Theme registry, layouts, and core components

Goal: make writer output target a concrete component and layout contract.

Scope:

- Astro + React generated theme source in `packages/theme`.
- Registry component metadata usage from `@docstube/contracts`.
- Initial component set needed by the writer.
- Layouts: `single-tree` and `sectioned`.
- Fixture docs site with representative MDX pages.

Acceptance:

- Fixture docs site builds.
- Component prop validation uses the shared registry metadata.
- No generated docs site depends on public `@docstube/theme`.
- `pnpm run validate` passes.

## Task 10 - Theme build integrations: search, D2, glossary, and llms

Goal: add the build-time integrations that make generated docs useful and verifiable.

Scope:

- Pagefind search integration.
- D2 build support with sketch mode default.
- Glossary remark plugin.
- `llms.txt` and `llms-full.txt`.
- Docs-serving MCP server.

Acceptance:

- Fixture docs site builds with search artifacts.
- Glossary and D2 fixtures render.
- `llms.txt` and `llms-full.txt` are generated deterministically.
- `pnpm run validate` passes.

## Task 11 - Theme SEO, AEO, and footer output

Goal: complete the static site output quality layer.

Scope:

- Sitemap.
- Canonical URLs.
- Metadata.
- Open Graph.
- Structured data.
- FAQ/AEO output hooks expected by writer output.
- "Generated by docstube" footer credit, default on and disableable.

Acceptance:

- Fixture docs site snapshots include expected SEO/AEO artifacts.
- Footer credit can be disabled through config/theme options.
- `pnpm run validate` passes.

## Task 12 - Skills and source loaders

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

## Task 13 - Pipeline run initialization and scheduling

Goal: create the main generation run structure without broad orchestration all at once.

Scope:

- Config loading and run initialization.
- Durable run records.
- Page scheduler with depth-first time-to-first-page behavior.
- Terminal progress state model.
- Cap-freeze state transitions, without UI polish.

Acceptance:

- Fixture run initializes from config-family files.
- Scheduler order is deterministic and tested.
- Runs are resumable from persisted state.
- `pnpm run validate` passes.

## Task 14 - Replay-based writer, reviewer, verifier orchestration

Goal: wire the core generation loop over mocks/replay before relying on live adapters.

Scope:

- Writer step.
- Persona reviewer steps.
- Deterministic verifier steps.
- Findings merge logic.
- Passed/flagged page states.
- Integration fixture with replay adapters and deterministic verifiers.

Acceptance:

- No live AI calls in CI.
- Failed gates are reproducible from persisted state.
- The pipeline uses shared findings and verifier result contracts.
- `pnpm run validate` passes.

## Task 15 - Retry, cache, transcripts, and changelog pipeline

Goal: complete the non-UI pipeline behaviors after the basic gate works.

Scope:

- Retry/refinement loop.
- Persisted transcripts.
- Content-addressed agent cache keys.
- Changelog generation over git diffs.
- FAQ/AEO writer guidance.

Acceptance:

- Retry limits and cache hits are tested.
- Transcripts do not store secrets.
- Changelog entries are fact-checked against diffs in fixtures.
- `pnpm run validate` passes.

## Task 16 - Incremental engine and LocalBackend

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

## Task 17 - Local UI setup wizard and config editing

Goal: implement the setup path over the real config and tRPC surfaces.

Scope:

- Shared in-flow `NavTree` foundation.
- Setup wizard.
- IA proposal editing.
- Theme token editor with preview.
- Comment-preserving writes to `docstube.yml` and `ia.yml`.

Acceptance:

- Desktop and mobile screenshots are nonblank and non-overlapping.
- Wizard writes config-family files that validate.
- No screenshot-capture product feature is implemented.
- `pnpm run validate` passes.

## Task 18 - Local UI dashboard and live preview

Goal: make long generation runs observable while pages finish.

Scope:

- NavTree progress statuses.
- Generation dashboard.
- Page status timelines.
- Live preview pane.
- Cap-freeze banner.
- Terminal progress mirror integration where needed.

Acceptance:

- Dashboard fixtures cover queued/running/retrying/passed/flagged states.
- No node-graph pipeline canvas.
- Desktop and mobile screenshots are nonblank and non-overlapping.
- `pnpm run validate` passes.

## Task 19 - Local UI review and feedback flows

Goal: implement the review room after generated pages exist.

Scope:

- Production-rendered page preview.
- Element, section, page, and docs feedback scopes.
- Feedback categorizer integration through mocks/replay.
- Approve and regenerate actions.
- Findings badges in review navigation.

Acceptance:

- Review fixtures cover findings, approvals, and regeneration requests.
- Feedback writes to the correct criteria/instructions/glossary/config target through tested
  mocks.
- Desktop and mobile screenshots are nonblank and non-overlapping.
- `pnpm run validate` passes.

## Task 20 - CLI commands and runtime telemetry

Goal: make the user-facing CLI drive the implemented core.

Scope:

- `generate`.
- `generate --yes`.
- `generate --fresh`.
- `update`.
- `validate`.
- `check <d2|mdx|snippet|config> <file>`.
- `telemetry <enable|disable|status>`.
- Lazy command loading.
- `NODE_COMPILE_CACHE` where appropriate.
- Runtime telemetry opt-out and disclosure.

Acceptance:

- CLI startup stays light.
- Command tests cover success, failure, `--fresh`, resumability, and progress output.
- Telemetry tests prove forbidden data is not sent.
- Add a Changeset for user-facing CLI behavior if release notes would matter.
- `pnpm run validate` passes.

## Task 21 - GitHub Action

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
- Action tests cover resumability and progress summary output.
- Add a Changeset for user-facing Action behavior if release notes would matter.
- No live AI calls in CI.
- `pnpm run validate` passes.

## Task 22 - Deterministic product smoke

Goal: prove the integrated product works before adding eval complexity.

Scope:

- TS fixture repo through CLI `generate --yes`.
- Python fixture repo through CLI `generate --yes`.
- Rendered site build for both fixtures.
- `docstube update` after a small source change in both fixtures.
- Assertions for generated docs, manifest updates, and verifier findings.

Acceptance:

- Smoke tests use mocks/replay, not live AI.
- Both fixture sites build.
- Update regenerates or flags the expected pages.
- `pnpm run validate` passes.

## Task 23 - Evals, live gated workflow, and dogfood

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
