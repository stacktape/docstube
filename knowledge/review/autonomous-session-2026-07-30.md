# Autonomous session, 2026-07-30 — what landed while you were away

Written for review. Every item below is committed on `rewrite-for-v1` with `pnpm run validate`
green at each step (test count grew 1465 → 1763).

## Both production blockers are closed

**1. The Action could auto-merge a run that never finished.** `decideAutoMerge` read open flags and
nothing else — a budget freeze or a partially-executed plan with no blocking flag merged silently.
Sol's CI review refused to ship auto-merge in that state.

The kernel now emits a fail-closed `PublicationDecision` bound to the candidate tree, and the
Action _enforces_ it rather than re-deriving publishability. Twelve refusal conditions, including:
artifact absent / unparseable / schema-invalid, a decision bound to a different tree, a
`sourceSha` that disagrees with the HEAD read before the CLI ran, deferred work, a blocked gate,
any ledger regression, undeclared dirty paths, hash drift. The Action validates against
`@docstube/contracts` only — never importing the kernel, because it runs whatever CLI version the
user pinned — and an **unknown reason code from a newer CLI fails closed** rather than reading as
"fine".

The regression comparison is real: base manifest at the merge base vs candidate, per page —
badge loss, a checked claim going unchecked/contradicted, a checked-count drop beyond deleted
claims, evidence-authority weakening, attestation loss. An unreadable base blocks; a _missing_
base is first-run and legitimately yields nothing.

**2. Partial runs published half-applied sites.** `generate` wrote each page as it finished, so a
freeze left some pages describing new source and others old, with the manifest in between.

Publishing is now staged-atomic: work accumulates in `.docstube/staging/`, and nothing touches the
published tree until the plan completes. The guarantee is documented honestly rather than
overclaimed — there is no cross-file filesystem atomicity anywhere, so the index is written
**last** via temp-file + rename, meaning a partial publish can never advertise a page whose files
are missing (only the reverse), and the next run finishes an interrupted publish forward. Three
separate emit paths (success, crash, wizard) were found and unified into one.

Resume does not re-bill: staged pages are reused verbatim when the plan fingerprint matches, and
that fingerprint deliberately **excludes `agents.budgets`** — raising the cap to finish a frozen
run is the canonical resume action and must not discard the work.

## First-run setup works

It was broken in a way that mattered: the UI opened the dashboard unconditionally, so a fresh repo
landed on an empty dashboard; and the setup steps that need AI built their task runner from
`docstube.yml`, which does not exist until setup ends — the steps designed for first run were the
ones that could not work on first run.

Now: bare `docstube` routes by context (no config → setup, config → dashboard, TTY-safe, `--no-open`
honoured), an onboarding draft at `.docstube/onboarding-draft.json` carries in-progress intent so
agent-backed steps resolve config from it, and the final action writes both config files, runs
generation and publishes in one step. An _invalid_ committed config still throws — that is the
user's to fix, not something to route around silently.

The end-to-end test starts from a workspace with no `docstube.yml` and asserts a config family, an
emitted route, a manifest index and a shard ledger all exist afterwards.

## CI stops before spending money

`docstube doctor --ci --json` runs fifteen checks — transport resolution and credentials (resolved
from the actual configured transport, not a regex sweep), GitHub identity and permissions,
auto-merge preconditions, branch state, tooling — and the Action runs it **first**, aborting before
checkout with the report rendered into the job summary and "this run spent nothing on models".

Honesty rules throughout: `unknown` is never fatal and never rounds up to a pass (the schema
enforces it); a keyless endpoint pointing at a _hosted_ API fails rather than passing, because it
would 401 mid-run; and `full-auto` is only claimed when token identity, repository setting and
branch policy are all proven — a workflow's own `GITHUB_TOKEN` reports **approval-assisted**,
since GitHub will not run workflows for those PRs without approval.

## Fake affordance removed

`agents.roles` was documented in the schema, validated, and read by nothing — a user could
configure a cheaper model for reviews and it silently did nothing. It now routes for real, across
five roles (writer, reviewer, translator, architect, extractor, plus the new risk-critic), with
one shared resolution path so the CI preflight checks the credential for _every_ provider a run
could use. Spend is now attributed per role.

`agents.reviewModel` was **deleted** — a strict subset of `roles.reviewer`, and two spellings of
one routing rule is how they drift apart.

## The knowledge system is the adjudicated one

The _old_ store was live: question-text hashing, global paraphrase dedup that could suppress a
genuinely new question indefinitely, answers overwritten with no history, and nothing marking an
answer stale when its code changed.

Now: dedup by **slot** (subject + kind-of-missing-fact), never by phrasing; similarity only
_suggests_ a merge and never discards; answers are additive with supersession, author and
timestamp; and staleness is wired to the fingerprint ladder via a `materialFingerprint` that
covers signature, values and schema shape but **not** body — so a cosmetic refactor rebinds
quietly and only a material change re-asks you.

Your one legacy answer file was **not** converted: it records a question, an answer and a
timestamp, but no subject, author or answer-time revision. Converting it would have meant
inventing four of the exact fields the new records exist to guarantee. It warns and names the file
instead.

## Your structural-consistency feature ships

The compute-resources/Pricing case, built as designed. Deterministic detectors (empty section,
duplicate heading, explicit-rule violation) emit findings directly. The flagship sibling
shared-facet detector uses the ≥60% threshold purely as a **cost-control trigger to summon the
assessor, never as a verdict** — the assessor judges each missing page `expected` /
`not-applicable` / `uncertain`, and only `expected` pages become repair targets.

The planted eval you asked for ships: eight siblings, five with Pricing; `workers` and
`gpu-instances` are flagged, `local-emulator` is correctly exempt as free local compute — asserting
exactly one model call, exactly one finding, exactly two repair targets.

All findings are non-blocking, per your call — committed work items, never the flag queue.

## The risk critic is built

The last significant unbuilt piece of the trust design, and three things were waiting on it: the
semantic assertion coverage PRODUCT §1.2 promises the linter cannot provide, the within-page
structural judgment the detectors deferred, and the residual factual risk that persona reviews
stopped owning when correctness moved out of them.

One call per page, fed the claim/evidence summary and explicitly **not** the repository — because
the review that motivated this design made zero tool calls and marked correctness "met" for being
"plausible within the page itself". Six finding kinds, all design-derived. Its own tests caught a
defect that would have defeated it: the output schema defaulted `findings` to `[]`, so any
malformed payload parsed as a completed clean verdict.

`complete` is byte-for-byte unchanged — critic findings never touch the badge. Both numbers are
surfaced together with which one owns it.

## Integrity work found along the way

- **The codemap walked gitignored build output** (58 files — bundled CSS/JS from a nested app),
  treating build artifacts as documentation source. Worse: unversioned reads mark a run dirty, so
  **the complete badge was unreachable in any repo with a `dist/`**. Git's own allowlist now decides
  what counts as source.
- **Existence was tested against the fingerprint snapshot rather than the codemap.** Since
  fingerprint extraction is an _additive_ pack capability, every symbol from `lang-python`,
  `lang-java` or any third-party pack would have been falsely reported as not existing in source.
- **Whole-file dependencies resolved only by luck** — 209 of 250 committed subscriptions.
- **Two concurrent runs shared one staging area.** Two clicks of "start run" clobbered each other
  and could publish twice. Now guarded by a cross-process lock with a heartbeat: a dead pid is
  taken over instantly, a live-but-silent holder after 60s, so a crash never wedges a workspace and
  a long run keeps its lock.
- **A flaky first-run test** turned out to be the test asserting inside a window the design
  deliberately creates (it polled for the route, which is written _before_ the index by contract).
  Proven by tightening the poll to 1ms.
- **Four raw NUL bytes**, written by four different agents reaching for a delimiter. Two had
  reached main and made git render entire files as "Binary files differ", hiding every diff in
  them. A repository-hygiene spec now fails on any raw NUL in a tracked text file — it caught the
  third and fourth within hours of being written.

## The integration run (all of the above, together)

Run `run_2nat7c788sh8zfbk5n1y`. Every feature above exercised in one live generation:

|                               | Run 3 (before this session) | Integration run     |
| ----------------------------- | --------------------------- | ------------------- |
| Checked, excluding `behavior` | 47.6%                       | **56.8%** (54 / 95) |
| Checked overall               | 17.2%                       | 18.3% (54 / 295)    |
| Attempts for 6 pages          | 9                           | **6 — no retries**  |
| Contradictions / false flags  | 0                           | **0**               |
| Cost                          | ~$30                        | **~$18.66**         |

Per-role spend now reports itself: writer ~$17.49, risk-critic ~$0.68, reviewer ~$0.48 — the
critic costs under 4% of a run. Staged-atomic publish worked ("site published to docs-site/").
The knowledge system correctly warned about the legacy answer file rather than silently ignoring
it. The risk critic produced an assessment on all six pages.

**Structural findings: 0 — correct, not broken.** The dogfood IA is six flat pages with no
navigation group holding ≥4 comparable siblings, so the cohort detector has nothing to compare.
It needs a repo shaped like Stacktape's docs to fire.

**Two things the run caught that no test had:**

1. **`docstube generate` succeeded and then exited 1.** The root command had both `subCommands`
   and a `run` handler, and citty runs the parent handler _even when a subcommand matched_ — so
   the pipeline finished perfectly, then printed "Unknown command: generate" and failed. It
   affected **every** subcommand (`version`, `status`, `doctor`, all of them), which means the
   GitHub Action was entirely broken, since it gates on exit code. 1763 passing tests missed it
   because every CLI test called handlers directly and none asserted a process exit code. Fixed,
   with end-to-end dispatch tests that spawn the real binary and assert exit codes — 15 of 36 of
   them fail against the old code. A second find in the same area: `docstube constructor`
   resolved `Object.prototype.constructor` and ran it as a command.

2. **The run marked itself `dirtyWorkingTree: true` — and it was right.** I committed the session
   summary _while the run was in progress_, so HEAD moved from `0c4e5e3` to `547279b` mid-run. The
   HEAD-stability check flagged that the recorded evidence cannot be vouched for by the commit it
   names. The system caught its own operator doing precisely what it is built to catch.

## Still open

- **Auto-answer researcher** and **GitHub `/answer` ingestion** — seams documented, deliberately
  scoped out so the knowledge change stayed reviewable.
- **`refine`'s Pareto gate** — the accept-only-if-strictly-better cycle does not exist yet; the
  agent implementing structural repair declined to invent a partial one.
- **Reader UX completion** — nav tree consumed from `ia.yml`, the `/verification` trust report, the
  canonical machine corpus and its projections.
- **Coverage ratchet** — the machinery is wired and tested, but no coverage-obligation registry
  exists to diff, so it honestly emits an empty delta rather than inventing movement.
- **AssuranceProfile + generated support matrix**, eval queue, anti-slop lints, changelog
  generation, PageContextPack.
- Four-phase wizard visuals, the estimate-on-the-Generate-button, and the docType archetype
  expansion — deliberately left; the bootstrap bug is fixed, the visual redesign is not.

## The decision still waiting on you

Behavior claims are **55–64% of everything real docs prose asserts**, and they are unchecked by
design until v1.x predicate verifiers. No engineering changes that. The measured consequence is
that the green 100% badge essentially never appears at 0.1.0 — pages read "18 of 68 checked".

Three options, all defensible: change what the badge threshold means; pull behavior verification
into 0.1.0; or lead the launch story with _"every claim checked or visibly marked"_ rather than
green badges. I have deliberately not chosen — it is a positioning decision, and picking one to
make a number look better is exactly the move this product exists to refuse.
