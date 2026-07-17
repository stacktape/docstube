# Harness research findings — adoption decisions (2026-07-17)

The full deep-research report was produced externally (claude.ai deep research) from the brief in
`harness-research-brief.md`. This file records what docstube ADOPTED, DEFERRED, and REJECTED,
under the founder's v1 lens: UX over security perfection — "if it's not very dangerous, imperfect
is acceptable."

## Already shipped before the report landed (pre-release review batches)

- Env-scrubbed snippet execution (minimal PATH-only env, `allow-env` fence opt-in) — the report's
  #1 recommendation.
- Realpath containment on all file tools (symlink-escape class closed).
- read_file stat-first 1MB cap with truncation notices; grep caps.
- Ephemeral mkdtemp working directory per snippet.
- codex stdin written-and-closed on every spawn (the non-TTY hang cannot occur).
- Antigravity (`agy`) removed from the public transport enum (issue #76 stdout drop).

## Adopted now

- **Plan-usage governor** (report Q3.3): codex JSONL `rate_limits.{primary,secondary}.used_percent`
  is parsed into `usage.planUsedPercent`; `agents.budgets.maxPlanUsagePercent` (default 80)
  freezes between pages. When a plan signal is present, dollar ESTIMATES stop triggering the
  freeze — the plan window is the truth for subscription billing (vendor-REPORTED dollars still
  count). Fixes the false "$25 estimated" freeze class on flat-rate transports.
- **Cross-model review** (report Q4.1, evidence: same-model self-review silently endorsed ~32% of
  its own semantic errors): `agents.reviewModel` exists; the config description recommends a
  different model family. Not auto-defaulted — docstube cannot assume the user holds two
  subscriptions; the wizard copy nudges instead.

## Deferred (post-v1, revisit when publishing hardening matters)

- OS sandbox for snippet-exec (`@anthropic-ai/sandbox-runtime`): beta research preview, alpha
  Windows (separate-user model breaks per-user tool installs) — poor UX for v1's risk profile.
  When adopted, fallback must FLAG visibly ("executed without OS sandbox"), never silently no-op.
- Network-deny for the verifier: no portable in-Node mechanism; arrives with the sandbox.
- Fixture-repo replay eval suite (~15-30 repos incl. an adversarial-injection fixture) gating
  harness changes — the record/replay infra is already 80% of it.
- Compaction + hand-off-file resets for long jobs; prompt-cache-shaped messages.
- Claude subscription cost-approximation governor (monthly credit vs accumulated total_cost_usd).
- Node `--permission` as belt-and-suspenders on docstube's own process (never as the snippet boundary).

## Rejected for v1

- Windows AppContainer/Job-Object sandbox work (cost vs founder's UX-first priority).
- Treating Node `--permission` as an isolation mechanism (the docs themselves disclaim it).
- gVisor/Firecracker paths (require host privileges; not assumable for an OSS CLI).
