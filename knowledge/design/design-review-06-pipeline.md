## Design problems

The current pipeline is not economically or operationally sound for a 500-page repository. Page-level regeneration is a defensible v1 boundary; the larger problems are rewrite-first invalidation, incomplete dependency tracking, non-transactional cap-freeze, and nominal rather than real resume.

### 1. A budget pause can publish and auto-merge an incomplete documentation snapshot — fundamental

**Why this is wrong:** Generate and refresh persist each completed page directly into the committed site and manifest. On cap-freeze, refresh carries the remaining stale pages without marking them deferred, then advances the manifest index to the new repository commit ([maintain.ts:312](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:312), [maintain.ts:444](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:444)). Generate similarly creates a deliberately partial manifest on a first-run freeze ([generate.ts:215](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:215), [cost-freeze.spec.ts:227](/C:/Projects/docstube/packages/core/src/pipeline/cost-freeze.spec.ts:227)).

`frozen` is then recorded as a completed run, and the CLI returns exit code 0 ([run-events-schema.ts:74](/C:/Projects/docstube/packages/contracts/src/run-events-schema.ts:74), [generate-command.ts:57](/C:/Projects/docstube/apps/cli/src/commands/generate-command.ts:57), [refresh-command.ts:47](/C:/Projects/docstube/apps/cli/src/commands/refresh-command.ts:47)). The GitHub Action interprets exit 0 as success and bases auto-merge solely on manifest flags; it does not know that planned affected pages remain stale ([github-action.ts:426](/C:/Projects/docstube/apps/github-action/src/github-action.ts:426), [verified-delta.ts:124](/C:/Projects/docstube/apps/github-action/src/verified-delta.ts:124)). A clean freeze can therefore auto-merge a partially refreshed site while the manifest index says the current version corresponds to the new commit.

The outcome enum also conflates three independent facts: whether execution finished, whether verification found blocking defects, and whether the result was published. A frozen run with flags is reported only as `frozen` because that branch wins ([maintain.ts:465](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:465)).

The fixed 15% margin is not sufficient admission control. A dogfood run froze at an estimated `$24.92` against a `$20` cap because the last admitted page cost more than the margin ([journal.jsonl:113](/C:/Projects/docstube/.docstube/runs/run_w9fe4czfmhzjp8gfw7wd/journal.jsonl:113)).

**Concrete better design:** Treat generated pages as staged run artifacts. Promote the site and committed manifest atomically only after every planned work unit, all derived locales, and the topology gate complete. Cap-freeze becomes `paused-budget`, not `run-completed`; staged pages remain previewable but cannot reach the merge gate.

Replace the single outcome with orthogonal fields:

- Execution: `running | paused | completed | failed | cancelled`
- Plan completeness: planned/completed/deferred work-unit counts
- Gate: `clean | blocked | warnings`
- Publication: `staged | promoted | not-promoted`

Before admitting a page family, reserve a conservative cost derived from that page’s historical writer/reviewer/translation costs and maximum retry policy. If the remaining budget cannot cover the reservation, pause before starting it.

If partial publication is ever supported, it should be an explicit policy that produces blocking “incomplete refresh” flags for every deferred scope. It should not be the default.

**Cost now vs after 0.1.0:** High now: staging paths, promotion logic, outcome contracts, CLI behavior, and Action gating must change together. Much higher after release: existing automation will have learned that exit 0 and a clean manifest mean publishable, and public committed manifests may already contain misleading partial baselines.

### 2. “Dependency changed” is treated as “documentation is wrong” — fundamental

**Why this is ineffective:** Refresh computes one boolean per shard. If any recorded symbol hash disappears or any observed-read file hash changes, the entire page is sent directly through the writer/reviewer/verifier loop ([maintain.ts:101](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:101), [maintain.ts:301](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:301)). The existing page is never first tested against the new source.

That is the wrong economic model. Most edits to a source file do not invalidate every statement in every page that consulted it. A refactor, private implementation change, additional overload, comment edit, or verifier upgrade often leaves the existing documentation valid. The current pipeline pays for a full rewrite before learning whether anything needs changing.

The invalidation edges are also broad. A page records every symbol from every file the writer read, plus whole-file observed-read hashes ([page-runner.ts:135](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:135)). One exploratory read therefore becomes a permanent strong rewrite dependency.

**Concrete better design:** Make refresh a validity-first pipeline:

```text
snapshot → plan candidates → revalidate existing entities/pages
                               ↓ only failures
                           directed repair
                               ↓
                         topology gate → promote
```

A changed dependency should invalidate evidence, not content. Re-run deterministic checks and claim matching against the existing MDX first. Re-review only when a persona, criterion, or relevant prose input changed. Invoke the writer only when the old page actually fails, and pass it the current page plus exact invalid entities and findings.

For a typical commit, “candidate pages” and “rewritten pages” must be distinct metrics. A healthy target for a 500-page site would be a low-single-digit candidate set and often zero rewritten pages for implementation-only changes.

**Cost now vs after 0.1.0:** High now because this changes the planner, claim records, cache keys, and writer contract. Very high later because users will already have paid for and reviewed noisy full-page refresh diffs, while manifest migrations will be needed to support deterministic revalidation.

### 3. Intent changes are recorded as current without being applied — fundamental

**Why this is wrong:** The manifest stores `configHash` and `iaHash` as hashes of generation intent ([manifest-schema.ts:43](/C:/Projects/docstube/packages/contracts/src/manifest-schema.ts:43)), but refresh never compares them. It simply writes the new values after carrying unchanged pages ([maintain.ts:444](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:444)). This destroys the only evidence that the pages were generated under older intent.

The omitted inputs are content-defining:

- Project context, personas, glossary, and instructions shape the writer prompt ([write-page.ts:37](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:37)).
- The page brief and depth shape each page ([write-page.ts:104](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:104)).
- Criteria shape reviews ([review-page.ts:26](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:26)).
- Criteria and instruction files are loaded but have no persisted fingerprints at all ([context-files.ts:22](/C:/Projects/docstube/packages/core/src/pipeline/context-files.ts:22)).

A persona, glossary, instruction, brief, or depth change can therefore regenerate zero pages, after which the manifest claims the new configuration is already incorporated.

IA reconciliation is similarly split incorrectly. New IA pages make refresh tell the user to run `generate`, while `generate` loops over every page and regenerates them all ([maintain.ts:367](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:367), [generate.ts:219](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:219)). Removing a page from the authoritative IA does not remove it; it leaves implementation-detail cleanup to the user.

**Concrete better design:** Persist stage-scoped fingerprints rather than one raw config hash:

- Source/codemap fingerprint
- Per-page IA-node fingerprint
- Writer-policy fingerprint: project context, glossary, instructions, enabled components
- Review-policy fingerprint: personas and criteria
- Verifier-set fingerprint: plugin IDs, versions, relevant verifier config
- Render fingerprint: theme, site metadata, locale/navigation configuration
- Execution-only fingerprint: transport, model, budgets; this should not silently invalidate content

The planner then maps each changed fingerprint to the cheapest valid action: assemble only, verify only, review only, page repair, translation, or structural reconciliation.

Treat `ia.yml` as desired state. Adding one page generates one page; removing one stages one deletion; rename/reparent preserves page identity where possible. CI may block auto-merge for structural changes, but it should present the complete proposed transition rather than require manual manifest surgery.

**Cost now vs after 0.1.0:** Medium-high now. After release it becomes very high because committed hashes become a public lockfile contract, and existing repositories may already have falsely “acknowledged” intent changes.

### 4. The provenance graph is too broad at page level and effectively empty below it — significant

**Why this is ineffective:** The schema requires block provenance, and the architecture claims a symbol-to-entity regeneration map ([entity-schema.ts:73](/C:/Projects/docstube/packages/contracts/src/entity-schema.ts:73), [ARCHITECTURE.md:137](/C:/Projects/docstube/ARCHITECTURE.md:137)). In generated data, block provenance is initialized empty, only page provenance is populated from the writer transcript, and grounded claims discard their matched identifiers rather than retaining dependency provenance ([extract-entities.ts:115](/C:/Projects/docstube/packages/core/src/entities/extract-entities.ts:115), [page-runner.ts:131](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:131), [claims-stage.ts:72](/C:/Projects/docstube/packages/core/src/pipeline/claims-stage.ts:72)). The block-level affected set is therefore not “already computable” as the maintain comment claims.

Observed reads also do not distinguish evidence from exploration. Reviewer agents are explicitly encouraged to read source, but those reads are not added to the persisted evidence graph ([review-page.ts:26](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:26), [review-page.ts:110](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:110)). This yields both over-invalidation from incidental writer reads and under-invalidation from review evidence that is later forgotten.

One symbol hash is also being asked to serve incompatible purposes. TypeScript hashes full bodies, while Python intentionally hashes signature shape only ([extract-symbols.ts:102](/C:/Projects/docstube/packages/lang-typescript/src/extract-symbols.ts:102), [extract-symbols.ts:20](/C:/Projects/docstube/packages/lang-python/src/extract-symbols.ts:20)). That makes the meaning and cost of a “symbol change” language-dependent.

Finally, backward provenance cannot route newly added symbols: no existing page could have cited something that did not exist. The current behavior is to regenerate no page and, only when coverage is enabled, raise a global coverage flag ([maintain.spec.ts:196](/C:/Projects/docstube/packages/core/src/pipeline/maintain.spec.ts:196)). Apps and services with coverage off have no mechanism for discovering documentation implications of new capabilities.

**Concrete better design:** Store typed dependency edges per block/claim:

- `api-shape` → signature fingerprint
- `behavior` → implementation/semantic fingerprint
- `file-evidence` → exact read hash with evidence/exploration classification
- `brief`, `glossary`, `instruction`, `criterion`
- `verifier` → verifier ID/version/input fingerprint
- `relation` → call/import/schema relation where relevant

Give symbols separate identity, API-shape, implementation, and documentation fingerprints. An entity declares which kind it depends on.

Give each IA page a source scope or ownership query—package, module, path glob, symbol class, or explicit selector. Added symbols are routed through these scopes. Unowned additions go through a cheap diff-planning pass that either identifies candidate pages or raises a structural/coverage flag.

Populate entity dependencies now, but roll dirty entities up to a page as the v1 writer transaction. That preserves a future block/section path without requiring risky MDX stitching before launch.

**Cost now vs after 0.1.0:** Medium-high now because provenance and manifests change. Higher after release because this becomes a committed-schema migration and changes which commits trigger refresh.

### 5. The journal is a log, not a resume protocol — significant

**Why this is ineffective:** The journal can append events and continue sequence numbers, but the pipelines do not read prior stage completion before executing work ([run-journal.ts:42](/C:/Projects/docstube/packages/core/src/state/run-journal.ts:42)). `summarizeRun` folds completed input hashes, yet those hashes are not used by generate, refresh, or refine to skip anything ([run-journal.ts:103](/C:/Projects/docstube/packages/core/src/state/run-journal.ts:103)).

The hashes would not safely support resume as currently formed anyway. The maintain-stage “input hash” includes `regenerated`, which is an output only known after the stage; site verification hashes only page IDs rather than content, verifier versions, or configuration ([maintain.ts:347](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:347), [generate.ts:286](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:286)). Page tasks do not persist resumable artifact references or per-stage checkpoints.

The user-facing advice to “rerun to continue” means restart and hope for agent-cache hits, not resume ([generate-command.ts:57](/C:/Projects/docstube/apps/cli/src/commands/generate-command.ts:57)). That is inadequate for a run measured in hours.

**Concrete better design:** At run creation, persist an immutable snapshot containing commit, intent fingerprints, plugin/verifier versions, model policy, and the complete work plan. Each work unit should have:

- Precomputable input fingerprint
- Stage state and attempt number
- Content-addressed artifact references
- Usage and reserved/actual cost
- Terminal gate result

Resume should reuse completed units whose input fingerprint still matches. A changed snapshot should fork/replan rather than append ambiguous events to the same logical run. The CLI should auto-offer the latest compatible paused/failed run and expose `--resume <runId>` and `--restart`.

**Cost now vs after 0.1.0:** Medium now. High later because dashboard/UI consumers, Actions artifacts, and users will depend on the existing journal semantics.

### 6. `refine` is a stochastic reroll, not a monotonic improvement operation — significant

**Why this is wrong:** Refine ranks pages by open flags, proven-block ratio, and age, then invokes the ordinary full-page generator ([refine.ts:63](/C:/Projects/docstube/packages/core/src/pipeline/refine.ts:63), [refine.ts:200](/C:/Projects/docstube/packages/core/src/pipeline/refine.ts:200)). The old shard is used to preserve entity IDs, but the existing MDX, blocking flags, and target quality deficit are not supplied as the initial repair draft. The writer receives a normal “write this page” prompt.

The new page is persisted regardless of whether its proven-block count improved. A healthy but prose-heavy page can be selected for an expensive rewrite, and a rewrite may regress quality while still being committed. That is incompatible with the command name and with autonomous learning.

**Concrete better design:** Replace refine with finding-directed `repair`. It must begin from the current MDX, attach exact unresolved findings or user feedback, constrain the editable scope, and apply a monotonic acceptance gate:

- No new blocking findings
- No guarantee downgrade
- Target finding resolved
- Target criteria or proof metric strictly improved
- Otherwise retain the old page and record the rejected candidate in the journal

Pages with no concrete repair objective should not be rewritten automatically. If a stochastic reroll escape hatch is desired, name it `regenerate --page` and make its nondeterminism explicit.

**Cost now vs after 0.1.0:** Low-medium now because the command can be removed or redefined before users depend on it. High later because scripts and user expectations will encode “refine means improve,” while existing content may already have been churned by non-monotonic rerolls.

### 7. The command vocabulary exposes internal planner branches — significant

**Why this confuses users:** Generate and refresh are not distinct user intentions. They are the same desired-state reconciliation with either an empty or existing baseline. The distinction currently creates an O(500) cliff: refresh refuses new pages, then tells the user to run the command that regenerates everything. The GitHub Action also requires the user to select first-run `generate` versus ongoing `refresh` ([action.yml:1](/C:/Projects/docstube/apps/github-action/action.yml:1)).

Refine overlaps the retry/repair responsibility the autonomous pipeline should already own. Audit, however, is genuinely distinct: it measures arbitrary foreign docs, has different outputs, and deliberately exits nonzero when defects are found ([audit-command.ts:54](/C:/Projects/docstube/apps/cli/src/commands/audit-command.ts:54)).

**Concrete better design:** Collapse generate and refresh into one idempotent command, preferably `docstube sync`:

- No manifest → full initial plan
- Existing manifest → incremental desired-state reconciliation
- `--plan` → affected reasons, estimated tasks/cost
- `--all` → intentional full regeneration
- `--page <slug>` → scoped force
- `--repair` → resolve existing findings

Keep `audit` separate. Remove `refine` or redefine it as directed repair. The Action should always invoke `sync`; it should not expose a mode choice.

**Cost now vs after 0.1.0:** Medium now across CLI, dashboard router, Action, docs, and telemetry. High after release because command names become workflow API and community vocabulary.

### 8. Audit bypasses the long-run execution architecture — significant

**Why this is ineffective:** Audit is precisely the mode most likely to run across hundreds of pages, yet it processes one agent extraction call per page serially and has no journal, budget governor, resume, or run artifact ([run-audit.ts:57](/C:/Projects/docstube/packages/core/src/audit/run-audit.ts:57), [run-audit.ts:80](/C:/Projects/docstube/packages/core/src/audit/run-audit.ts:80)). Its report also lacks the code commit, docs-tree hash, extractor/model fingerprint, and plan completeness needed to reproduce a public metric.

Keeping audit as a separate command is correct; keeping it on a separate executor is not.

**Concrete better design:** Run audit on the same snapshot/work-plan/journal engine. Cache extraction by page-content hash and extractor fingerprint, parallelize within transport limits, pause/resume under the same budgets, and emit a durable report containing code commit, docs hash, tool/model versions, pages found/skipped/audited, and claim coverage.

**Cost now vs after 0.1.0:** Medium now. Higher later because published GTM comparisons may otherwise be expensive to repeat and difficult to reproduce defensibly.

## Effectiveness and UX

The economic evidence is already poor. One six-page dogfood generation ran for 43.1 minutes—from the first event to completion—and, summing its task usage, consumed approximately 5.46 million input tokens across 56 task calls ([journal.jsonl:1](/C:/Projects/docstube/.docstube/runs/run_zdc1xg4347zhh2wyh3jg/journal.jsonl:1), [journal.jsonl:189](/C:/Projects/docstube/.docstube/runs/run_zdc1xg4347zhh2wyh3jg/journal.jsonl:189)). A naive linear extrapolation is roughly 455 million input tokens and 60 serial hours for 500 pages. This is not a benchmark, but it is enough to reject the current design as scale-ready.

For a typical code commit, the honest answer is: **the current design cannot provide a defensible number**. A localized leaf-file edit may regenerate only one to a few pages, but shared files can fan out broadly, and config/IA changes currently regenerate zero pages when they should invalidate many. The six committed dogfood pages each carry 8–28 whole-file reads and 46–133 source-symbol dependencies; the broadest example is visible in the page-level provenance for “How verification works” ([page shard:632](/C:/Projects/docstube/.docstube/manifest/pages/en/pg_1be43rtwhtry6s1vgrff.yml:632), [page shard:1435](/C:/Projects/docstube/.docstube/manifest/pages/en/pg_1be43rtwhtry6s1vgrff.yml:1435)).

Before release, add a 500-page replay benchmark with at least these changes:

- Leaf implementation-only edit
- Public signature change
- Shared type or central entrypoint change
- New public symbol
- Persona/instruction/glossary change
- One IA page add, remove, and brief edit

Report candidate pages, revalidated pages, rewritten pages, tasks, tokens, cost estimate, and wall time. A reasonable release target is 0–3 rewrites for a localized commit, under 10 for p90 ordinary commits, and an explicit structural plan rather than silent execution when fan-out exceeds a configured percentage of the site.

Other waste and confusion:

- Pages, verification, reviews, and personas are serial despite the architecture depicting review and verify in parallel ([generate.ts:219](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:219), [page-runner.ts:162](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:162), [review-page.ts:110](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:110)). A bounded work scheduler is necessary for 500 pages.
- Every writer receives the same global first-200-symbol summary before exploring the repo ([write-page.ts:24](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:24)). This encourages broad reads, inflates prompts, and changes every page’s cache key when the early global symbol list changes.
- Whole-page regeneration creates large prose diffs and can move or replace feedback anchors even when one fact changed. Page-level output is still the right v1 cut, but the writer should edit the current page against precise findings.
- There is no dry-run affected-set explanation. Users cannot see “12 candidate pages, 2 need repair, estimated $X” before spending.
- `flagged`, `frozen`, and `passed` mean different things across generate, refresh, and refine. CLI exit 0 for a paused/incomplete run is especially unsafe.
- “Rerun to continue” sounds resumable but means restart with opportunistic cache hits.
- Audit’s one-call-per-page execution makes the product’s GTM command the least operationally robust mode.

**Page granularity verdict:** Keep whole-page writing and verification as the v1 transaction. Do not build block-level MDX patching before 0.1.0. Compute and persist entity-level dirty/evidence sets now, roll them up to a page for directed repair, and change the architecture/product wording so it does not promise block regeneration in v1. Add section/block generation only if real p90 fan-out and token data show page repair remains the dominant cost.

## What is genuinely good

- The committed, sharded manifest with stable entity IDs is the correct branch-aware baseline for incremental planning.
- Symbol hashes plus harness-recorded reads preserve the right “uncertain means re-evaluate” safety bias.
- Bounded retry with deterministic findings attached is the right repair-loop foundation and should survive the redesign.

## Open questions for the founder

1. Should the primary command become one idempotent `docstube sync`, or should `generate` keep the name but absorb refresh semantics? Audit should remain separate either way.
2. On budget exhaustion, should completed pages remain staged until the entire plan finishes, or may partial docs publish with explicit blocking incomplete-state flags? I recommend staged-only.
3. Is page-level writing the declared v1 transaction, with entity-level invalidation rolled up to pages, or is true section/block patching a 0.1.0 requirement? I recommend page-level v1.
4. Should `refine` be removed in favor of monotonic, finding-directed `repair`, or should a stochastic full-page reroll remain a supported product action?
5. When a human edits `ia.yml`, is that edit authoritative for page additions/removals, or should structural reconciliation always require a second confirmation? I recommend authoritative locally and blocking-review policy in CI.
6. Should behavioral implementation edits invalidate every dependent page conservatively, or should dependencies select API-shape versus implementation fingerprints by claim class? I recommend typed fingerprints.
7. What 500-page economic SLO should block release: maximum p50/p90 rewritten pages, full-generation wall time, and cost/token budget? Without an explicit SLO, “incremental” remains an architectural claim rather than a tested product property.
