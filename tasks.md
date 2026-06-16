# docstube implementation tasks

This file is the ordered queue for `node run-overnight.ts`.

The queue is intended to implement the full docstube product described in `PLAN.md`. Existing
placeholder, fixture-only, or "ready to..." code is not task completion evidence. When a task owns
an area, upgrade or replace the placeholder with real product behavior behind the planned
interfaces.

Rules for every task:

- Read `AGENTS.md` and `PLAN.md` first.
- Implement only the current task.
- Do not rebuild or redesign release, deployment, CI, package-manager, or formatting
  infrastructure unless the task explicitly requires it.
- Do not edit `PLAN.md`, `AGENTS.md`, `tasks.md`, release workflows, deployment files, or package
  infrastructure unless the task explicitly says to.
- Do not implement anything under the hard TBD boundaries.
- Keep packages private unless the task explicitly says otherwise.
- Prefer tests and fixtures close to the code being implemented.
- Acceptance criteria are minimum gates, not permission to leave stubbed behavior in place.
- Do not satisfy product tasks with static demo arrays, hard-coded success strings, or fake
  "ready" responses unless the task explicitly asks for a mock/replay fixture. Real app surfaces
  must use the real package boundary and persisted state for that task's scope.
- A task that touches a package or app is not done if Vitest collects zero tests for that touched
  package or app. Add at least one focused test file under that workspace before claiming the task.
- Workspace package dependencies for the planned `@docstube/*` imports are pre-wired. If a task
  adds a new concrete cross-package import that is not already declared, it may add the matching
  `workspace:*` dependency to the consumer package. Exception: `apps/cli` is the public
  `docstube` package and must not publish private `@docstube/*` runtime dependencies; bundle
  internal CLI imports instead.
- Run `pnpm run validate` before marking the task done unless a narrower check is explicitly
  justified in the task output.

Supervisor runbook for a full implementation pass:

- Start from a clean worktree.
- If rerunning after an earlier incomplete pass, reset the ignored runner state by deleting
  `.docstube-build/state` or setting it to `0`; then run `pnpm run overnight:dry`.
- Run `pnpm run overnight`.
- Inspect `.docstube-build/logs/` whenever a task fails review or validation.
- Do not accept fixture-only behavior where `PLAN.md` calls for product behavior. Fixtures prove
  the behavior; they are not the behavior.
- For UI tasks, smoke through the real local server with `pnpm dev wizard` or a
  focused automated browser/component test.
- The final handoff must include `pnpm run validate`, the deterministic product smoke, and a
  local UI smoke proving the wizard, dashboard, and review flows are reachable.

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
- Invalid fixtures produce useful Zod errors with non-empty `error.issues` and expected `path`
  values.
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
- Quality score contracts define an explainable derived page score; config files still reject
  arbitrary user-authored score fields.
- `pnpm run validate` passes.

## Task 03 - State database, StateBackend, and tRPC contracts

Goal: create the state and API skeleton that later pipeline work can target.

Scope:

- Drizzle schema for local `.docstube/db.sqlite`.
- Migration creation and fresh DB test.
- `.docstube/` scaffold helper that creates committed-friendly `manifest.yml`, `criteria/`, and
  `instructions/` while keeping DB/cache/run files machine-local.
- Async versioned `StateBackend` interface.
- `LocalBackend` stub implementing the contract with deterministic in-memory or SQLite behavior.
- Contract test suite reusable by future backends.
- tRPC router skeleton and AppRouter type snapshot.
- Minimum AppRouter procedures for later UI work: config read, config write, IA proposal list,
  theme-token read/write, run status, page status list, page detail, feedback submit, approve
  page, regenerate page.

Acceptance:

- Fresh DB migration test passes.
- Scaffold fixture creates the expected committed files/directories without creating secrets,
  transcripts, cache files, or SQLite files in committed state.
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
- Versioned record/replay fixture format with a schema.
- Minimal walking skeleton: fixture repo -> replay writer output -> deterministic check -> state
  persisted -> one page rendered to HTML by minimal MDX compile.

Out of scope:

- Release, deploy, CI, and packaging workflow edits.
- New binary packaging infrastructure. It already works.

Acceptance:

- No live AI calls.
- Walking skeleton fixture passes end to end.
- The skeleton uses the S0 contracts from `@docstube/contracts`; it does not invent local shapes.
- The fixture asserts concrete artifacts: compiled HTML contains a known token, persisted state
  has the expected `passed` row, and the deterministic check returns the expected result.
- `pnpm run validate` passes.

## Task 05 - Codemap and API extractors

Goal: implement deterministic source facts.

Scope:

- Tree-sitter codemap package structure.
- Normalized hashes for TS/JS and Python fixture files.
- Language plugin seam.
- TypeDoc extraction for TS/JS fixtures.
- griffe extraction for Python fixtures, with structured skip or mock fixture output if Python or
  griffe is unavailable in the local/CI environment.
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
- Each verifier has at least one passing fixture and one finding-producing failing fixture.
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
- Each verifier has at least one passing fixture and one finding-producing failing fixture.
- Optional tools skip explicitly as structured `status: "skipped"` results, not silently.
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

- A simulated adapter that writes outside writable roots is rejected by the post-run guard.
- A hung child process is killed and surfaced as a timeout error.
- JSONL/JSON recorded fixtures parse into the expected normalized adapter event sequence.
- Version detection is tested against recorded command output fixtures.
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
- Drift report skeleton: structured findings for reference docs that disagree with code-grounded
  facts, without treating reference docs as truth.

Acceptance:

- Materialization preserves user-edited files where promised.
- Source loaders never store secrets.
- Conflict handling documents that code wins.
- Drift report fixtures include one reference-doc disagreement finding.
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

## Task 15 - Retry, refinement scoring, cache, transcripts, and changelog pipeline

Goal: complete the non-UI pipeline behaviors after the basic gate works.

Scope:

- Retry/refinement loop.
- Explainable page quality score derivation from criteria results, deterministic gates, and
  blocker/major/minor findings.
- Refinement prioritization that starts with the lowest-scoring pages and failed gates.
- Persisted transcripts.
- Content-addressed agent cache keys.
- Changelog generation over git diffs.
- FAQ/AEO writer guidance.

Acceptance:

- Retry limits and cache hits are tested.
- Score derivation is deterministic, explainable in UI/API output, and never stores opaque raw
  judge scores.
- Refinement ordering fixtures prove worst pages are handled first within configured caps.
- Transcripts do not store secrets.
- Changelog entries are fact-checked against diffs in fixtures.
- `pnpm run validate` passes.

## Task 16 - Refresh engine and LocalBackend

Goal: make `docstube refresh` regenerate stale pages and refresh vendored project assets.

Scope:

- Provenance capture: seed context, observed reads, citations.
- Normalized-hash dirty detection.
- Symbol-to-page mapping.
- Conservative uncertainty behavior: if a page has no recorded citation/read for a changed symbol
  but its seed context hash changed, or if provenance is missing/corrupt for a page that might
  cover the changed area, the page is regenerated or flagged rather than skipped.
- Topology consistency pass: nav-tree references resolve, page slugs remain unique, cross-page
  links to regenerated symbols are revisited, and glossary terms used by changed pages are still
  defined.
- Theme/project asset refresh: when installed docstube ships compatible updates to the vendored
  generated-site theme, refresh those files without regenerating documentation content unless the
  migration requires it.
- `.docstube/manifest.yml` update.
- Durable `LocalBackend` implementation over SQLite.

Acceptance:

- Fixture repo changes dirty a named expected page set, and the test asserts the exact set.
- Uncertain provenance regenerates or flags rather than skipping.
- Topology-pass fixtures cover a broken nav reference, stale cross-page link, and missing glossary
  term.
- Manifest is portable and committed-friendly.
- Refresh checks all pages by default; no separate `--all` flag is required for the normal path.
- `pnpm run validate` passes.

## Task 17 - Local server and browser startup

Goal: serve the real local control plane surface before UI screens depend on it.

Scope:

- Hono server wiring in `packages/core`.
- tRPC mount for the AppRouter procedures defined in Task 03.
- Static serving for the built local UI.
- Ephemeral session token on localhost URLs.
- `wizard` startup helper that starts the server and opens the wizard URL.

Acceptance:

- Server tests cover tRPC calls, static UI serving, localhost binding, and invalid session token
  rejection.
- Browser-open behavior is tested through a mock opener.
- No marketing website or deployment infrastructure is changed.
- `pnpm run validate` passes.

## Task 18 - Local UI setup wizard and config editing

Goal: implement the setup path over the real config and tRPC surfaces.

Scope:

- Shared in-flow `NavTree` foundation.
- Setup wizard loaded from the real local server/session, not static app-entry demo data.
- Doc type selection.
- Project context fields: project description, source roots, docs goals, and optional reference
  sources.
- Persona management: add/edit/remove personas, pick titles, audience notes, and defaults.
- Agent selection for writer/reviewer roles using the config contract.
- Optional source references.
- IA proposal list, proposal selection, and editable `NavTree`.
- Theme token editor with preview.
- Site metadata: site name, locale, canonical URL/base path where supported by the config schema.
- Component selection based on the registry metadata.
- Comment-preserving writes to `docstube.yml` and `ia.yml`.
- Scaffolding flow when config files are missing: create the config family through the same
  comment-preserving write path, then reload through tRPC.

Acceptance:

- Component tests render the wizard at 375px and 1280px widths, assert named `data-testid`
  anchors are present/non-empty, and include a layout guard such as `scrollWidth <= clientWidth`
  for the primary shell.
- Tests cover project context, personas, source references, component selection, IA proposal
  selection/editing, and theme preview changes.
- Wizard writes config-family files that validate.
- The app entrypoint does not ship hard-coded wizard demo state as the product path; fixtures live
  in tests or explicit story/demo helpers only.
- No screenshot-capture product feature is implemented.
- `pnpm run validate` passes.

## Task 19 - Local UI dashboard and live preview

Goal: make long generation runs observable while pages finish.

Scope:

- NavTree progress statuses.
- Generation dashboard.
- Page status timelines from persisted run/page state.
- Live preview pane for generated page output as pages complete or become flagged.
- Cap-freeze banner.
- Terminal progress mirror integration where needed.
- tRPC polling or subscription-like refresh over the real `AppRouter` procedures from Task 03.
- Empty, loading, error, running, retrying, passed, flagged, and cap-frozen states.

Acceptance:

- Dashboard fixtures cover queued/running/retrying/passed/flagged states.
- Dashboard uses real local-server data loading in the product path, not static app-entry demo
  arrays.
- No node-graph pipeline canvas.
- Component tests render the dashboard at 375px and 1280px widths, assert named `data-testid`
  anchors are present/non-empty, and include a layout guard such as `scrollWidth <= clientWidth`
  for the primary shell.
- `pnpm run validate` passes.

## Task 20 - Local UI review and feedback flows

Goal: implement the review room after generated pages exist.

Scope:

- Production-rendered page preview.
- Element, section, page, and docs feedback scopes.
- Feedback categorizer integration through mocks/replay.
- Approve and regenerate actions.
- Findings badges in review navigation.
- Feedback writes through the backend to the correct target: criteria, writing instructions,
  glossary, or config changes.
- Review state reloads from persisted run/page state and reflects approvals/regeneration requests.

Acceptance:

- Review fixtures cover findings, approvals, and regeneration requests.
- Feedback writes to the correct criteria/instructions/glossary/config target through tested
  mocks.
- Review UI uses product data from the local server; hard-coded review demo pages are allowed only
  in tests or explicit story/demo helpers.
- Component tests render review at 375px and 1280px widths, assert named `data-testid` anchors
  are present/non-empty, and include a layout guard such as `scrollWidth <= clientWidth` for the
  primary shell.
- `pnpm run validate` passes.

## Task 21 - CLI commands and runtime telemetry

Goal: make the user-facing CLI drive the implemented core.

Scope:

- `wizard`.
- `generate`.
- `generate --fresh`.
- `refresh`.
- `refine`.
- `validate`.
- `status`.
- `doctor`.
- `upgrade`.
- `help [command]`.
- `version`.
- `check --all`.
- `check <d2|mdx|snippet|config> <file>`.
- Lazy command loading.
- `NODE_COMPILE_CACHE` where appropriate.
- Runtime telemetry opt-out and disclosure.
- No dedicated `docstube telemetry` command.
- Development command path: `pnpm dev <docstube-command>` runs the TypeScript source CLI; for
  `wizard`, it also starts the Vite local UI and proxies it through the local control plane.

Hard behavior placeholders to replace:

- `generate` must run the real generation pipeline from existing config, not only initialize a
  queued run.
- `refresh` must resolve stale pages, run the topology pass, regenerate dirty pages, refresh
  vendored theme/project assets, and update the manifest.
- `refine` must use persisted quality scores to work on the worst pages first.
- `upgrade` must self-update standalone installs, update detected package-manager installs when
  safe, and print exact commands for ephemeral or ambiguous installs.
- `doctor` must check optional tools and configured agent CLI availability.

Out of scope:

- Installer telemetry, `apps/install-events`, Stacktape secret wiring, release workflows, and
  deployment infrastructure.

Acceptance:

- CLI startup stays light.
- Command tests cover success, failure, `--fresh`, resumability, and progress output.
- `wizard` drives the real local server/UI path.
- `generate` drives the real config-based pipeline path rather than opening the wizard.
- `refresh` and `refine` drive real maintenance/refinement pipelines rather than placeholder
  readiness messages.
- Runtime telemetry tests prove forbidden data is not sent, without adding a telemetry command.
- Source-dev smoke covers `pnpm dev wizard`.
- Add a Changeset for user-facing CLI behavior if release notes would matter.
- `pnpm run validate` passes.

## Task 22 - GitHub Action

Goal: make the Action wrap `docstube refresh` and open PRs.

Scope:

- Action inputs and outputs.
- Checkout/refresh flow.
- Secret handling.
- PR creation with changed pages and reasons.
- Idempotent reruns.
- Concurrency protection.

Out of scope:

- Release workflows, npm publishing, Stacktape deployment, and install-script publishing.

Acceptance:

- Action fixture or local action test uses mocks/replay.
- Action never pushes generated docs silently.
- Action tests cover resumability and progress summary output.
- Add a Changeset for user-facing Action behavior if release notes would matter.
- No live AI calls in CI.
- `pnpm run validate` passes.

## Task 23 - Deterministic product smoke

Goal: prove the integrated product works before adding eval complexity.

Scope:

- TS fixture repo through CLI `wizard` setup plus `generate`.
- Python fixture repo through CLI `wizard` setup plus `generate`.
- Rendered site build for both fixtures.
- `docstube refresh` after a small source change in both fixtures.
- Assertions for generated docs, manifest updates, and verifier findings.
- `docstube refine` prioritizes the lowest-quality fixture page before cleaner pages.

Acceptance:

- Smoke tests use mocks/replay, not live AI.
- Both fixture sites build.
- Refresh regenerates or flags the expected pages.
- Refine ordering starts from persisted quality scores and failed gates.
- The smoke asserts product behavior, not only token plumbing: generated pages contain
  source-grounded facts, manifest provenance, verifier results, and usable navigation.
- `pnpm run validate` passes.

## Task 24 - Evals, live gated workflow, and dogfood

Goal: add quality proof after the integrated product works.

Scope:

- Pick and wire promptfoo or evalite.
- Gold-set fixtures.
- Judge-vs-human agreement checks.
- Context ablations.
- Skill-on/off comparisons.
- Secrets-gated live workflow.
- Dogfood workflow that generates docstube's own docs and deploys the result.

Out of scope:

- Production Stacktape app infrastructure and release distribution workflows unless a human
  explicitly asks for deployment changes.

Acceptance:

- Normal CI remains deterministic and does not call live agents.
- Live workflow is manual/nightly and secrets-gated.
- Dogfood output is reviewable before deploy.
- `pnpm run validate` passes.
