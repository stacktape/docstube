# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.
`CLAUDE.md` is a symlink to this file.

## What docstube is

An open-source CLI (with a local web UI and a GitHub Action) that reads a codebase and generates verified, audience-targeted, always-current documentation, using the user's own coding-agent subscription (Claude, Codex, Gemini) or an API key. Output is MDX rendered by a custom Astro docs site.

## Locked technical decisions

- **Language/runtime:** TypeScript on Node.
- **Repo:** monorepo with workspaces; Changesets for versioning.
- **CLI binary:** built with @yao-pkg/pkg (`--sea`); lazy-loaded commands for fast startup.
- **State/DB:** better-sqlite3 + Drizzle. Local state lives in `.docstube/`; never commit secrets or the local DB.
- **Schemas/contracts:** Zod.
- **Server:** Hono. The local control-plane API uses tRPC; the (future) hosted-backend seam uses a versioned HTTP/JSON contract.
- **Control-plane / wizard UI:** Vite + React + Tailwind.
- **Docs output:** a custom Astro + React theme driven by a declared component registry; search via Pagefind.
- **Tests:** Vitest. **CI must never call real AI agents** - use recorded/replayed fixtures. Live-agent tests and evals run in a separate, secrets-gated workflow.
- **Lint/format:** Oxlint + Oxfmt.

## Architecture (high level)

A page-by-page pipeline: a **writer** agent reads code and drafts each page; **reviewer** agents (one per persona) check fit; **verifier** agents plus **deterministic checks** (compile samples, resolve imports, check links, compile MDX) validate it. Deterministic checks gate first; LLM judges return rubric-anchored findings tagged blocker / major / minor. A tree-sitter structural map (files -> symbols -> imports) seeds context and anchors symbol-level provenance for incremental updates.

## Conventions

- Conventional Commits; add a Changeset for user-facing changes.
- Keep secrets (creds, tokens) out of committed state, transcripts, telemetry, and generated output.

> The full implementation plan is the source of truth for detailed design; keep this file in sync with major decisions.
