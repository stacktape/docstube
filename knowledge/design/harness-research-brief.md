# Deep-research brief: harness engineering for docstube

Paste this whole document into a claude.ai deep-research chat. The deliverable we want back is a
cited report with concrete, prioritized recommendations mapped to the architecture described
below — not a general survey.

## Context: what docstube is and how its harness works

docstube is an open-source (MIT) CLI + localhost web UI + GitHub Action that generates
**verified** documentation from a codebase. Its core promise: every claim in the docs is either
proven by a deterministic tool or visibly flagged — never silently wrong.

It owns a custom agent harness ("agent-runtime") with this architecture:

- **docstube owns the loop and the tools.** Vendor CLIs are used only as raw model+billing
  transports: `claude` (Claude Code CLI, subscription billing), `codex` (OpenAI Codex CLI,
  ChatGPT subscription), Google's Antigravity CLI (`agy`, untested), plus direct API transports
  (anthropic-api, openai-compatible/Ollama) and a record/replay transport for CI.
- Vendor-CLI built-in tools are **disabled** (`--tools ""`, `-c tools.web_search=false` etc.);
  docstube injects its own tool surface through an **MCP stdio server** it spawns per session.
- The tool surface is deliberately small and read-only: `read_file`, `list_dir`, `glob`, `grep`
  (scoped to declared readRoots), plus `flag_question` (ask the maintainer something the code
  can't answer, non-blocking).
- Every file the agent reads is recorded as **observed-read provenance** (file + content hash);
  this drives incremental regeneration when code changes.
- Tasks are typed specs (write-page, review-page, translate, extract-claims…) with budgets
  (maxTurns, maxToolCalls) and structured-output schemas; a transcript **cache** keyed by input
  hash makes reruns free; CI uses record/replay only, never live models.
- Generated code samples are executed doctest-style by a **snippet-exec verifier**
  (`bash -euo pipefail -c`, `node -e`) to prove they work. Today that child process inherits the
  full host environment and network — we are changing the default to env-scrub, and want to know
  how far to go (see Q1).

Constraints: cross-platform (Windows + macOS + Linux), plain OSS distribution (npm package +
standalone binaries; we cannot assume Docker exists on the user's machine), runs both on
developer laptops and inside GitHub Actions.

## Research questions (prioritized)

### Q1 — Sandboxing model-generated code execution (highest priority)

State of the art (2025–2026) for safely executing model-authored shell/node/python snippets in a
dev tool:

- Practical isolation ladders: env scrubbing → network denial → filesystem scoping → full sandbox
  (containers, gVisor, Firecracker, macOS sandbox-exec/Seatbelt, Linux Landlock/seccomp/bwrap,
  Windows AppContainer/Job Objects). Which rungs are achievable WITHOUT Docker, per-OS, from a
  Node.js process?
- What do comparable tools actually ship? (Claude Code's sandbox/hooks, Codex CLI sandbox modes,
  OpenHands, SWE-agent, Aider, Cursor's shell execution, Jupyter kernels-as-sandbox.)
- Node.js permission model (`--permission`) in current Node 24/26: what does it actually gate
  (fs, child_process, workers) and does anything gate network yet?
- Recommended default posture for an OSS doc tool that runs in CI on other people's repos
  (prompt-injection-via-repo-content is in scope: a malicious repo can seed content that a writer
  agent copies into a bash sample which the verifier then executes).

### Q2 — "Harness engineering" best practices

The discipline recently emerged under this name. Survey current best practice (Anthropic/OpenAI
engineering blogs, agent-harness postmortems, SWE-bench harness literature) for:

- Tool-surface design: how many tools, description style, parameter shapes, result truncation
  budgets, unified-search vs separate grep/glob, error-message design that models recover from.
- Loop design: turn budgets, retry-with-findings, structured-output repair turns, when to
  hard-stop vs degrade.
- Context engineering: up-front context packs (symbol summaries) vs on-demand retrieval;
  compaction; prompt-cache-friendly message shaping; per-task context budgets.
- Evaluation: how teams eval harness changes (fixture repos, replay suites, live canaries).

### Q3 — Vendor-CLI transport quirks (headless/non-interactive modes)

Documented pitfalls and current flag surfaces for driving these CLIs programmatically as pure
model transports:

- Claude Code CLI: `-p --input-format stream-json --output-format stream-json`, `--allowedTools`,
  permission modes headless, exit-code semantics, `total_cost_usd` reporting on subscription.
- Codex CLI: `codex exec -` stdin prompts, `mcp_servers.*.default_tools_approval_mode`, missing
  max-turns control, rate-limit signaling, argv-length crashes on Windows.
- Antigravity CLI (`agy`, replaced gemini-cli June 2026): `-p/--print`, `--output-format json`,
  the open non-TTY stdout-drop bug when spawned as a subprocess (google-antigravity/antigravity-cli
  issue #76), MCP config file locations, `ANTIGRAVITY_API_KEY`/`GEMINI_API_KEY` headless auth.
  Is there a reliable subprocess invocation pattern on Windows (no `script(1)`)? ConPTY?
- Subscription plan-usage signals: do claude/codex/agy expose remaining quota / rate-limit-window
  state a harness could read to implement "stop at 80% of plan usage"?

### Q4 — Reviewer independence and verification loops

Evidence on same-model self-review vs cross-model review (writer model X, reviewer model Y):
does independence measurably reduce missed errors in generation pipelines? Cheap-reviewer
patterns. Also: patterns for diff-scoped review (review only what changed since last run) in
incremental generation systems.

### Q5 — MCP boundary hardening

Known attack classes against MCP stdio servers spawned by agent hosts (env leakage into argv,
tool-result injection, path escape via symlinks) and current mitigations. What is best practice
for a read-only file-serving MCP server exposed to a model processing untrusted repo content?

## Deliverable format

For each question: findings with citations, then a short "what docstube should do" section with
concrete recommendations ranked by (security impact × implementation cost). Flag anything in our
current architecture (described above) that contradicts established best practice.
