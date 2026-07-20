The current Action is neither safely autonomous nor reliably autonomous. It can auto-merge without knowing that the run was complete or that guarantees did not regress; in more typical first-month GitHub configurations, it will instead leave PRs waiting for repository setup or manual workflow approval.

I would not ship auto-merge enabled for 0.1.0 until the Action consumes an authoritative, fail-closed publication decision from the reconciler.

## Design problems

### 1. The merge gate has no authoritative publishability contract — fundamental

**Why this is wrong**

The product requires three independent conditions: deterministic gates green, no blocking exceptions, and no guarantee downgrade ([PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:89)). The Action reduces all three to “CLI exited zero and no open flag has a blocking kind” ([github-action.ts](/C:/Projects/docstube/apps/github-action/src/github-action.ts:426), [merge-decision.ts](/C:/Projects/docstube/apps/github-action/src/merge-decision.ts:12)).

That is not equivalent:

- Run completion, plan completeness, deterministic-gate outcome, and publication state are not inputs to `decideAutoMerge`.
- A manifest index is treated as sufficient even when referenced shards are missing; unreadable paths are skipped rather than making the candidate ineligible ([verified-delta.ts](/C:/Projects/docstube/apps/github-action/src/verified-delta.ts:92)).
- The Action does not verify that every shard belongs to the source commit being documented, that generated files correspond to those shards, or that all planned pages were evaluated.
- Flags are being used simultaneously as persisted user work items and as a machine gate protocol. Those are different responsibilities.

This creates a dangerous asymmetry: a missing manifest disables auto-merge, but an incomplete yet parseable manifest can enable it.

**Concrete better design**

Have `docstube generate --ci` produce one typed `PublicationDecision` artifact, bound to the candidate tree:

```text
schema/tool version
base SHA and source SHA
candidate artifact hash
execution: completed | paused | failed
plan: planned/completed/deferred counts
deterministic gate: clean | blocked
correctness regressions
new blocking dispositions
coverage delta
publishable: true | false
autoMergeEligible: true | false
reason codes
```

The kernel—not the Action—must own this decision. The Action should validate the artifact’s schema, version, commit/tree binding, and manifest completeness, then either open an ineligible draft PR or enable merge. Absence, mismatch, missing shards, deferred work, or unknown reason codes must fail closed.

**Cost**

High now, but it aligns with the already-mandated candidate/published state redesign. After 0.1.0 it becomes very high: users will have automated against exit codes and manifest shapes, and the first erroneous autonomous merge becomes a trust incident rather than an ordinary migration.

### 2. Budget freeze can still become a published, auto-merged partial refresh — fundamental

**Why this is wrong**

Generate and refresh write completed pages directly to published paths before the plan finishes. Refresh then carries stale remaining pages and advances the manifest to the new commit ([maintain.ts](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:312), [maintain.ts](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:444)). A frozen refresh still exits zero ([refresh-command.ts](/C:/Projects/docstube/apps/cli/src/commands/refresh-command.ts:47)), so the Action can commit it and enable auto-merge if no blocking flag happens to exist.

The governor itself is also insufficient for unattended CI:

- It learns plan usage only after a model task and checks the cap between pages, so one expensive page with retries and review can overrun the intended reserve ([run-cost.ts](/C:/Projects/docstube/packages/core/src/pipeline/run-cost.ts:37), [page-runner.ts](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:30)).
- `maxRunUsd` resets on every workflow invocation. It does not bound daily or weekly repository spend.
- The subscription policy compresses distinct 5-hour and weekly windows into one maximum percentage, discarding reset time and remaining-window shape.
- The Action owns no durable checkpoint/cache lifecycle. A fresh runner can rebill work after a blocked or frozen run even though the product promises resumability and uploaded CI journals ([PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:172)).

The binding redesign already reached the correct product decision: frozen work stays staged and nothing publishes until the full plan completes ([pipeline-v2.md](/C:/Projects/docstube/knowledge/design/pipeline-v2.md:21)). The Action has not been brought into that contract.

**Concrete better design**

Implement budget handling as admission control over a durable reconciliation:

- Build and persist the full work plan before agent calls.
- Reserve a conservative page-family cost based on historical writer, reviewer, translation, and retry usage.
- Do not start a work unit that cannot fit inside the remaining reservation.
- Persist staged artifacts and compatible completed work across workflow runs.
- Return `paused-budget` with `publishable: false`; do not open a normal mergeable PR.
- For API billing, add a rolling repository daily/weekly ceiling, not just a per-run ceiling.
- For subscriptions, preserve each vendor window and reset timestamp; govern both minimum reserve and maximum usage increase attributable to this run.

**Cost**

High now, but largely paid by the adopted pipeline-v2 work. After release it is much higher because partial manifests may already have become trusted baselines and repeated CI spending will be perceived as a billing defect.

### 3. The Action’s commit boundary is a denylist, so autonomous merge is not confined to documentation outputs — fundamental

**Why this is wrong**

`selectCommitPaths` commits every changed path except three machine-local `.docstube` patterns ([delta-report.ts](/C:/Projects/docstube/apps/github-action/src/delta-report.ts:14)). That is broader than the claimed transaction of generated docs, manifest, instructions, criteria, and knowledge.

A plugin, toolchain, theme emitter, or accidental process write can therefore modify source, configuration, or other repository files; the Action will include them in the same bot commit. The plugin trust posture is explicitly soft rather than sandboxed, making an output boundary more important, not less.

Branch checks may catch some unexpected changes, but “ordinary CI happens to reject it” cannot be the safety model for an auto-merging documentation agent.

**Concrete better design**

The reconciler should emit an exact output inventory with artifact hashes. The Action should:

1. Reject any dirty path not declared in that inventory.
2. Enforce allowed roots and explicit single files.
3. Verify every inventory hash before staging.
4. Stage only those paths.
5. Put unexpected writes in the job summary and make the candidate ineligible.

Human-authored input files should be changed only by explicit workflows such as answering feedback, not incidentally swept into a generation commit.

**Cost**

Low-to-moderate now: the output roots are already conceptually known. High after release, when third-party plugins and user automation may depend on the current “commit everything” behavior.

### 4. Guarantee-downgrade protection exists in vocabulary, not behavior — fundamental

**Why this is wrong**

`guarantee-downgrade` is declared as a blocking kind ([flag-schema.ts](/C:/Projects/docstube/packages/contracts/src/flag-schema.ts:13)), but no production pipeline path creates it. The Action also cannot discover one independently: its “verified delta” reads only current candidate counts; it never compares the base manifest with the candidate ([verified-delta.ts](/C:/Projects/docstube/apps/github-action/src/verified-delta.ts:104)).

This makes one of the three headline auto-merge conditions nominal. A page can lose proven status, lose its badge, or replace mechanically checked claims with unchecked ones without the promised downgrade blocker being created.

The representation is also already obsolete relative to binding 0.1.0 decisions: correctness is moving from `proven/scored/out-of-domain` to claim-specific evidence and dispositions, while editorial review becomes a separate axis ([trust-model-v2.md](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:20), [trust-model-v2.md](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:30)).

**Concrete better design**

Make regression detection a kernel-produced semantic comparison between base and candidate claim ledgers:

- Badge present → absent.
- `satisfied` → any unchecked or contradicted disposition.
- Checked-claim count decreases without a corresponding claim deletion.
- Evidence authority weakens, such as built-in proof → unpromoted project-defined check.
- Owner attestation disappears or no longer covers the same claim revision.
- A claim changes substantially and retains old trust state—this must be impossible under the adopted trust model.

Report review/assessment changes separately; they must not masquerade as correctness downgrades.

**Cost**

Moderate now because the claim-ledger migration already requires new manifest and delta shapes. Very high after 0.1.0 because it changes the public meaning of “safe to auto-merge” and may retroactively revoke badges.

### 5. Global standing flags turn one exception into permanent repository-wide review mode — significant

**Why this is wrong**

The Action reads open flags from every current shard plus manifest system flags, not just changed pages or newly introduced conditions ([verified-delta.ts](/C:/Projects/docstube/apps/github-action/src/verified-delta.ts:124)). Therefore one old coverage, structural, or system flag blocks every later docs correction—even an unrelated change that reduces risk.

That policy does not prevent new debt; it freezes all movement until the entire backlog is clean. Teams will respond by dismissing flags. Dismissal immediately removes the merge block, but records no actor, reason, scope, or expiry ([flag-schema.ts](/C:/Projects/docstube/packages/contracts/src/flag-schema.ts:24), [trpc-router.ts](/C:/Projects/docstube/packages/core/src/server/trpc-router.ts:334)). The easiest path back to automation is thus an unaudited trust override.

The kind system compounds this:

- `system` spans unrelated failure classes with different owners and remedies.
- `out-of-domain` conflates legitimate absence of a checker with claims needing maintainer input.
- Binding design has already replaced `out-of-domain` with explicit dispositions and declared `no-checker-available` nonblocking ([trust-model-v2.md](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:66), [pipeline-v2.md](/C:/Projects/docstube/knowledge/design/pipeline-v2.md:62)).

**Concrete better design**

Adopt a delta-scoped “no new debt” default:

- Newly introduced blocking conditions block.
- Existing conditions block only changes to their affected scope.
- Regressions block.
- Unrelated fixes may merge while standing debt stays prominently visible.
- Truly global integrity failures may freeze the repository, but must be a narrowly typed class.

Replace dismissal with a durable waiver containing author, timestamp, reason, affected claim/scope, policy source, and optional expiry. A regenerated or materially changed claim should invalidate the waiver unless explicitly scoped otherwise.

**Cost**

Moderate now. After release it becomes a policy compatibility problem: some users will expect any old flag to freeze everything, while others will already have trained themselves to dismiss noisy blockers.

### 6. The coverage blocker is simultaneously over-strict and not truthful — significant

**Why this is wrong**

For external libraries, coverage is enabled by default and one undocumented public symbol raises a global blocking flag ([maintain.ts](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:402), [maintain.ts](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:418)). That silently makes the release threshold 100%, even though docstube explicitly is not API-reference-first.

Yet “documented” currently means that a symbol appeared in any file the writer read: page provenance attaches every symbol from each observed-read file ([page-runner.ts](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:135)), and coverage counts those provenance sources ([maintain.ts](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:407)). A writer can therefore “cover” an export without mentioning it.

New public symbols are especially awkward: backward provenance cannot route something no page previously cited, so refresh may regenerate nothing and merely block on a global coverage flag. The flag does not identify an owning page, proposed repair, intentional omission route, or acceptable threshold.

**Concrete better design**

Define coverage as explicit obligations, not provenance incidence:

- Each public surface is `documented`, `generated-reference-only`, `intentionally-omitted`, `not-public-for-docs`, or `unassigned`.
- “Documented” requires a claim/entity reference, not a file read.
- IA pages carry source ownership/scopes so new symbols can be routed to candidate pages.
- Default CI policy blocks coverage regression or new unassigned required surface, not inherited backlog.
- Full absolute coverage can remain an opt-in release policy.
- Product coverage and verification coverage must be separate metrics and separate policy inputs.

**Cost**

Moderate now because claim-ledger and typed dependency work are already planned. High later because published coverage percentages and badges may otherwise need semantic correction.

### 7. Default GitHub credentials make the advertised hands-off flow inert—and failures arrive after model spend — significant

**Why this is wrong**

The only early precondition checks model credentials. GitHub authentication, repository write access, issue permission, auto-merge configuration, branch policy, and required-check behavior are discovered only after generation has consumed tokens ([github-action.ts](/C:/Projects/docstube/apps/github-action/src/github-action.ts:400), [github-action.ts](/C:/Projects/docstube/apps/github-action/src/github-action.ts:482)).

The model credential check is itself heuristic:

- It regex-scans YAML rather than resolving the configured transport.
- `CODEX_API_KEY`, described internally as supported, is absent from the common list.
- Keyless OpenAI-compatible endpoints are rejected.
- An unrelated common credential can let preflight pass even when the chosen transport lacks its actual credential.

The default GitHub token path also conflicts with unattended operation. GitHub currently puts `pull_request` workflows triggered by a workflow’s `GITHUB_TOKEN` into an approval-required state and recommends a GitHub App or PAT when those runs must start without approval ([GitHub’s GITHUB_TOKEN documentation](https://docs.github.com/en/actions/concepts/security/github_token)). Native auto-merge additionally requires repository support and unmet merge requirements; GitHub describes it as merging only after required reviews and checks pass ([GitHub auto-merge documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)). The current Action merely catches rejection and leaves the PR open ([github-action.ts](/C:/Projects/docstube/apps/github-action/src/github-action.ts:510)).

**Concrete better design**

Add a zero-agent-call `docstube doctor --ci --json` preflight that owns:

- Exact transport resolution and its authentication mode.
- Required vendor CLI/binary presence.
- GitHub repository identity and write permissions.
- PR/comment/issue permissions.
- Repository auto-merge state and branch/ruleset prerequisites.
- Whether bot-created PR checks will run without approval.
- Candidate branch collision/concurrency checks.

Auto mode should require a GitHub App installation token or explicitly configured PAT plus a supported branch policy. With only `GITHUB_TOKEN`, label the mode honestly as approval-assisted unless GitHub behavior can be proven otherwise for that repository.

**Cost**

Moderate now, mostly preflight and onboarding. High after launch because users will already have spent money discovering repository prerequisites and will interpret open PRs as a broken L4 promise.

### 8. The public Action API is already behind binding architecture and is race-prone — significant

**Why this is wrong**

The binding pipeline decision is one idempotent `generate` reconciler; `refresh` is removed ([pipeline-v2.md](/C:/Projects/docstube/knowledge/design/pipeline-v2.md:8)). The Action still exposes a first-run/maintenance mode choice and defaults to `refresh` ([action.yml](/C:/Projects/docstube/apps/github-action/action.yml:3)). That guarantees an avoidable first-run failure mode and preserves an implementation distinction users should never need to understand.

Concurrency is calculated only as an output after the Action runs ([github-action.ts](/C:/Projects/docstube/apps/github-action/src/github-action.ts:304)). Such an output cannot serialize the workflow invocation that produced it. Concurrent pushes can therefore spend against stale bases and race over the same rolling branch and force-push.

Version pinning is good by default but insufficiently coupled:

- The exact CLI version is synchronized with the Action release ([action.yml](/C:/Projects/docstube/apps/github-action/action.yml:21)).
- A public `docstube-package` override can run an arbitrary npm spec while the bundled Action continues parsing with its own contracts.
- The Action does not require the CLI version or decision-schema version to match.
- The latest-version lookup is only a notice after a successful, potentially expensive run.

**Concrete better design**

Ship a supported reusable workflow, not merely a low-level Action example. It should:

- Set concurrency before the job starts.
- Invoke only `docstube generate --ci`.
- Provide the exact least-privilege permissions and bot-token setup.
- Pin Action and CLI as one compatibility unit.
- Remove the public package override, or force custom runners into non-auto-merge mode unless they present a compatible decision certificate.
- Cancel stale queued runs or coalesce them into the latest reconciliation.

**Cost**

Low-to-moderate now. After 0.1.0, mode names and inputs become public workflow APIs, while supporting independently versioned Action and CLI combinations creates a permanent compatibility matrix.

## Effectiveness and UX

A team’s first month is likely to look like this:

1. The first run defaults to `refresh`, so setup requires knowing to override it to `generate`.
2. The model preflight may reject a valid Codex/keyless setup, or pass an invalid transport setup.
3. The expensive run completes before missing GitHub permissions or repository settings are discovered.
4. The PR opens but native auto-merge is unavailable, or required workflows wait for manual approval because the default token created the PR.
5. Once a coverage or system flag exists, the rolling PR stops auto-merging for unrelated changes. The same branch and PR are reused, which limits PR count, but every update keeps the entire repository’s blocker backlog in the decision.
6. The team learns that “Dismiss” immediately restores automation without requiring a reason. Flag fatigue becomes waiver fatigue, and trust moves from evidence to social convention.

Other concrete waste and confusion:

- The “verified delta” claims to show what proves each change, but it contains only aggregate correctness counts, flag counts, and file paths—not checks, evidence changes, claim-level outcomes, or base-versus-candidate regressions ([delta-report.ts](/C:/Projects/docstube/apps/github-action/src/delta-report.ts:68)).
- Open flags are repeated in the PR body, PR comment, job summary, and— for tribal questions—the digest issue. The surfaces are not differentiated by audience or action.
- The PR comment says users can resolve flags “by answering below,” but the Action does not ingest issue or PR replies ([delta-report.ts](/C:/Projects/docstube/apps/github-action/src/delta-report.ts:91)). The actual answer path is local CLI/dashboard state.
- When the last flag clears, the Action does not update the existing marker comment because flag delivery runs only when open flags remain ([github-action.ts](/C:/Projects/docstube/apps/github-action/src/github-action.ts:511)). Stale “requires attention” comments directly damage trust.
- Flag lines provide a kind, summary, and internal entity address, but no owner, remedy, evidence, “new vs existing” status, or clickable preview.
- A blocked or frozen run has no Action-owned durable work cache or journal artifact, so retrying can repeat both latency and billing.
- A per-run `$20` default controls one invocation, not the automation’s actual cost exposure. On a busy repository, push frequency dominates spend.
- Absolute subscription usage is the wrong CI allocation mechanism: unrelated human use can freeze docs work, while a single admitted task can still consume the remaining window.

The likely result is not overwhelming PR count—the rolling branch helps there—but recurring attention noise around one long-lived blocked PR, repeated model spend, and decreasing belief that “eligible” means what it says.

## What is genuinely good

- Exact CLI pinning tied to the Action release is the right default and should remain.
- One stable branch plus marker-based comment/issue upserts is the right anti-spam foundation.
- Using GitHub-native auto-merge preserves required repository checks when the repository and bot credential are configured correctly.

## Open questions for the founder

1. Should 0.1.0 auto mode require a GitHub App/PAT plus protected-branch prerequisites, or should default `GITHUB_TOKEN` installations be explicitly branded approval-assisted?
2. Should policy block only newly introduced/regressed debt, or should any standing blocking condition continue freezing every documentation change?
3. Is library coverage a 100% absolute release requirement, or a ratchet that blocks only new unassigned public surface and coverage regressions?
4. Should unattended CI default to API billing with rolling dollar limits, or support opportunistic subscription billing whose availability depends on a human-shared usage window?
5. Should maintenance run on every main-branch push, or should the supported workflow debounce/batch changes to bound spend and PR churn?
6. Should GitHub issue/PR replies become an actual answer-ingestion channel—requiring bot identity and write-back—or should those surfaces be read-only notifications that point to a local CLI/dashboard workflow?
7. On repositories without required checks, should docstube merge immediately after its own gate, or refuse autonomous mode until a protected merge policy exists?
8. Should custom `docstube-package` overrides be removed, or retained only with auto-merge forcibly disabled unless the custom CLI proves decision-schema compatibility?

No files were modified.
