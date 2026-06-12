# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.
`CLAUDE.md` is a symlink to this file.

## Source of truth

The full implementation plan is [`PLAN.md`](PLAN.md). It is the authoritative design document —
read it before any non-trivial work. This file is a quick orientation only; if it ever
disagrees with PLAN.md, PLAN.md wins.

## What docstube is

An open-source (MIT) CLI — with a localhost web UI and a GitHub Action — that reads a codebase
and generates verified, persona-targeted, always-current documentation, using the user's own
coding agents (`codex`, `claude`, `gemini` CLIs on their subscriptions) or API keys. Output is
MDX rendered by a custom Astro + React theme.

## Key locked decisions (summary — details in PLAN.md)

- TypeScript on Node LTS; pnpm-workspaces monorepo; Changesets.
- Config: `docstube.yml` — typed YAML (Zod → generated JSON Schema); programmatic edits must
  preserve comments/formatting.
- DB: better-sqlite3 + Drizzle. State in `.docstube/` (manifest/criteria/instructions committed;
  db/cache/runs gitignored).
- Local control plane: Hono + tRPC + WS. Hosted seam: tRPC with a frozen, versioned `v1` router
  (`.d.ts` snapshot diffed in CI).
- Pipeline: writer / per-persona reviewers / verifiers. Criteria-anchored findings tagged
  blocker/major/minor — no raw 1–10 scores. Deterministic checks gate first; escalating retry;
  ship-flagged-never-block; cross-vendor judging (verifier model family ≠ writer's).
- Code understanding: tree-sitter codemap; tier-1 languages TS/JS + Python; API references are
  extracted (TypeDoc / griffe), never LLM-written.
- Diagrams: D2 only (`@terrastruct/d2`, sketch mode); diagram sources are text in MDX.
- Agent knowledge ships as SKILL.md skills: index-in-prompt, body-on-demand, role-scoped.
- CLI binary via @yao-pkg/pkg; lazy-loaded commands for fast startup.
- Tests: Vitest. **CI never calls real AI agents** — record/replay fixtures only; live runs and
  evals are a separate, secrets-gated workflow.
- Lint/format: Oxlint + Oxfmt. Telemetry: PostHog, opt-out, anonymous.
- Build: one agent, sequential, per PLAN.md §21 (contracts first, S0→S9); released all at once.
- TBD — do not implement or improvise: screenshots, migration-import, hosted-backend internals, additional agent adapters beyond the built-in four.

## Conventions

- Conventional Commits; add a Changeset for user-facing changes.
- Secrets never appear in config, state, transcripts, telemetry, or generated output.