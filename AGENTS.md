# AGENTS.md

Guidance for AI coding agents and humans working in this repository.
`CLAUDE.md` is a symlink to this file.

## Source of truth

The full implementation plan is [`PLAN.md`](PLAN.md). It is the authoritative design document.
Read it before any non-trivial work. If this file disagrees with `PLAN.md`, `PLAN.md` wins.

## What docstube is

An open-source MIT CLI, localhost web UI, and GitHub Action that reads a codebase and generates
verified, persona-targeted, always-current documentation using the user's own coding agents
(`codex`, `claude`, `gemini`) or API keys. Output is MDX rendered by a custom Astro + React theme.

## Current infrastructure

- Runtime: Node current LTS baseline, currently Node 24.12+.
- Package manager: pnpm 11 workspaces. Do not use Corepack; install/use pnpm directly.
- Language: TypeScript 6, ESM, strict typechecking.
- Build: `tsdown` for package libraries and CLI/action surfaces; Vite for `apps/local-ui`.
- Lint/format: Oxlint + Oxfmt.
- Tests: Vitest. CI must never call real AI agents.
- Versioning: Changesets.
- Release: npm publishes the Node-based `docstube` package; GitHub Releases carry standalone
  binaries built with `@yao-pkg/pkg`; Stacktape-hosted install scripts are the canonical no-Node
  install path and download binaries from GitHub Releases.
- Deployment: root `stacktape.ts` owns `docstube.dev`, `installs.docstube.dev`, and
  `events.docstube.dev` infrastructure.

Useful commands:

```bash
pnpm install
pnpm run validate
pnpm dev wizard
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
pnpm run format
pnpm run upg
```

`validate` is the normal handoff command. Keep caches under `node_modules/.cache` when adding tools.
The historical overnight runner has been removed; use `tasks.md` as an ordered implementation
guide and supervise agent work directly.

`pnpm dev <docstube-command>` runs the CLI from TypeScript source with Node's native type
stripping and the `docstube-source` package-export condition. `pnpm dev wizard` also starts the
Vite local UI and proxies it through the session-guarded local control plane. Running `pnpm dev`
with no extra args defaults to `pnpm dev wizard`.

Node-run TypeScript should use Node's built-in type stripping: run `node path/to/script.ts`
directly, keep syntax erasable, use extensionful relative imports, and do not add `tsx`,
`ts-node`, or custom loaders unless Node's built-in support is insufficient for a specific
documented reason.

## Build order

Implement sequentially per `tasks.md`, which is derived from `PLAN.md`: S0 contracts first, then
S1 through S9. Do not skip ahead into UI, adapters, or theme polish before S0 contracts and the
walking skeleton are frozen and tested.

The project infrastructure is already in place: workspace layout, tooling, CI, deployment,
release workflow, npm publishing, standalone binaries, Stacktape-hosted install scripts, and
installer telemetry. Product implementation agents should not rework that infrastructure unless a
task explicitly requires a narrow fix.

TBD boundaries are hard boundaries. Do not implement or improvise screenshot capture,
migration-import, hosted-backend internals, or additional agent adapters beyond the built-in four.
Marketing-web implementation lives in `apps/web` and is handled by another agent/workstream; leave
only infrastructure placeholders unless explicitly assigned that work.

When supervising the implementation queue:

- `tasks.md` is the ordered task list.
- Each task should produce a focused commit.
- If a task fails review repeatedly, inspect the failing diff and tests, fix manually or adjust the
  task prompt, then rerun that bounded task.

## Package layout

Reusable/published workspace packages live in `packages/`:

- `contracts` -> S0 Zod schemas, shared types, IDs, result taxonomies, public contract snapshots.
- `core` -> config loading, state, orchestrator, local server, tRPC routers.
- `agent` -> standalone `@docstube/agent` adapter interface and built-in adapters.
- `verifiers` -> deterministic checks and result taxonomy.
- `codemap` -> tree-sitter codemap and language plugins.
- `extractors` -> TypeDoc / griffe API reference extraction.
- `theme` -> Astro + React theme and registry component contracts.
- `skills` -> shipped `SKILL.md` sources and materialization helpers.

Runnable workspace apps live in `apps/`:

- `cli` -> the `docstube` binary, lazy command loading, no heavy deps on startup.
- `local-ui` -> Vite + React localhost control plane.
- `github-action` -> GitHub Action wrapper.
- `web` -> public marketing website placeholder; implementation belongs to another agent/workstream.

Package entry files are named by responsibility (`core.ts`, `agent.ts`, `cli.ts`), not `index.ts`.
Do not add `index.ts` files.

## Release Rules

- Initial public npm publishing is intentionally narrow: publish only `docstube`.
- Internal packages stay `private: true` until a stable external contract exists.
- Do not make npm `docstube` download or wrap the standalone binary. npm users already have Node,
  so the npm package runs compiled JS directly.
- The no-Node install path is the standalone binary from GitHub Releases, installed through
  Stacktape-hosted scripts such as `https://installs.docstube.dev/linux.sh`.
- Installer scripts are generated from `scripts/install-templates/`, uploaded to GitHub Releases,
  and later published to the Stacktape-hosted installs bucket.
- Installer telemetry goes through `apps/install-events`; never call PostHog directly from
  installer scripts and never include paths, usernames, hostnames, args, prompts, or source code.
- Generated docs sites vendor the theme/source they need. Do not make user docs sites depend on
  `@docstube/theme` in v1.
- Theme updates are applied by `docstube refresh` or the GitHub Action without
  regenerating docs content unless explicitly requested.

## Style rules

These are derived from the hand-written `../stacktape` and `../console-app` projects.

- Prefer small procedural modules with named exports.
- Prefer `type` over `interface`.
- Prefer arrow functions for helpers and library code.
- React components use the `function ComponentName()` form.
- Use inline parameter types for simple one-off function params.
- Avoid classes unless lifecycle/state makes them clearly better.
- Keep comments sparse. Add comments only when they explain non-obvious reasoning.
- Do not sectionize code with decorative comment blocks.
- `console.log` is temporary debugging output. Use `console.info`, `console.warn`, or
  `console.error` only for intentional CLI/runtime output.
- Errors should be typed and structured at package boundaries. Do not throw vague strings.

Formatting:

- 2 spaces, single quotes, semicolons, 120-column print width, LF line endings.
- Let Oxfmt format supported files. Do not hand-align code into fragile columns.

## Imports

- Never use barrel exports or barrel imports.
- Never add `index.ts` as a convenience aggregator.
- Local imports must point at the concrete file that owns the code.
- Cross-package imports may use the package name only when consuming the package's public API.
- Import only what you need.
- Use `import type` for type-only imports.
- Prefer `node:` specifiers for Node built-ins.
- Do not use dynamic `require`. Use dynamic `import()` only for intentional lazy loading, especially
  CLI command modules and heavy optional capabilities.

Examples:

```ts
import type { AgentAdapter } from '@docstube/agent';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocstubeConfig } from './config-schema.ts';
```

Avoid:

```ts
import * as fs from 'fs';
import { parseDocstubeConfig } from './config.ts';
export * from './config-schema';
```

## Dependency policy

- Use current stable packages, not stale defaults. TypeScript 6 is expected.
- Prefer proven libraries named in `PLAN.md`: Zod, Hono, tRPC, better-sqlite3, Drizzle, YAML
  Document API, Vitest, D2, Astro, React, Vite, Tailwind, Pagefind, `@yao-pkg/pkg`.
- Before major adapter work, re-check vendor CLI flags and output modes from primary sources.
- Add dependencies to the owning workspace package, not casually to the repo root.
- Run `pnpm run upg` when intentionally refreshing dependency ranges.

## Config and state

- `docstube.yml` is typed YAML. Programmatic edits must use a comment- and formatting-preserving
  API, specifically the `yaml` package Document API.
- Never store secrets in config, state, transcripts, telemetry, generated docs, or tests.
- PostHog credentials are Stacktape secrets referenced from `stacktape.ts`, not committed values.
- `.docstube/manifest.yml`, `.docstube/criteria/`, and `.docstube/instructions/` are committed.
- `.docstube/db.sqlite*`, `.docstube/cache/`, and `.docstube/runs/` are machine-local and ignored.

## Verification expectations

- Every package must compile.
- Keep tests close to the contracts they prove.
- If you touch a package or app, add or update at least one focused Vitest test collected from
  that workspace; a touched workspace with zero collected tests is not done.
- CI and normal tests use mocks or record/replay fixtures only. Live AI runs belong in a separate
  secrets-gated workflow.
- For user-facing changes, add a Changeset.

Before handoff, run:

```bash
pnpm run validate
```

If that is too broad for the current edit, state exactly which narrower commands ran and why.
