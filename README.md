<div align="center">

# docstube

**Verified, always-current documentation generated from your code.**

docstube reads a repository, asks your own coding agents or API keys to write source-grounded MDX,
checks the output deterministically, and renders a self-contained Astro docs site that you own.

[Website](https://docstube.dev) · [Discussions](../../discussions)

</div>

## Current Status

The repository contains the product implementation described in [PLAN.md](PLAN.md):

- CLI commands: `wizard`, `generate`, `refresh`, `refine`, `validate`, `check`, `status`,
  `doctor`, `upgrade`, `version`, and `help`.
- Local web UI: setup wizard, generation dashboard, and review/feedback flows.
- Core pipeline: source mapping, extraction, writer/reviewer orchestration, deterministic gates,
  provenance, refresh, refinement ranking, cache, transcripts, and generated docs assets.
- Distribution infrastructure: npm package, GitHub Release binaries, Stacktape-hosted install
  scripts, installer telemetry, and release workflows.

The checked-in source is ahead of the last public npm ownership release until the release workflow
is run again. Use the source workflow below for local testing.

## Local Development

```bash
pnpm install
pnpm run validate
pnpm dev wizard
```

`pnpm dev <docstube-command>` runs the TypeScript source CLI directly with Node's native type
stripping. `pnpm dev wizard` also starts the Vite local UI and proxies it through the localhost
control plane. Other commands run without starting Vite:

```bash
pnpm dev generate
pnpm dev refresh
pnpm dev refine --failed --max-rounds 1
pnpm dev status
pnpm dev check --all
pnpm dev doctor
```

## User Workflow

After a release is published, the normal Node path is:

```bash
npx docstube wizard
npx docstube generate
npx docstube refresh
npx docstube refine
```

No-Node users install a standalone binary through the Stacktape-hosted scripts, which download
GitHub Release assets:

```bash
curl -L https://installs.docstube.dev/linux.sh | sh
```

Windows uses `https://installs.docstube.dev/windows.ps1`.

## Verification

The main handoff gate is:

```bash
pnpm run validate
```

Additional high-signal checks:

```bash
pnpm run dogfood:build
pnpm run evals
```

`pnpm run evals:live` is secrets-gated and requires a configured judge model/provider.

## Repository Map

- [PLAN.md](PLAN.md): authoritative product end-state and architecture.
- [ACCEPTANCE.md](ACCEPTANCE.md): executable acceptance evidence and external release/deploy gates.
- [AGENTS.md](AGENTS.md): coding style, package ownership, and agent operating rules.
- `apps/cli`: published `docstube` CLI package.
- `apps/local-ui`: localhost web UI.
- `apps/github-action`: GitHub Action wrapper around `docstube refresh`.
- `apps/install-events`: install telemetry Lambda.
- `packages/core`: config, state, pipeline, local server, refresh/refine/status/doctor workflows.
- `packages/theme`: vendored Astro/React generated-site source.

The public marketing website in `apps/web` is intentionally owned by a separate workstream.

## License

[MIT](LICENSE) © 2026 Stacktape
