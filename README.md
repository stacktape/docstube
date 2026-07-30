<div align="center">

# docstube

**Verified docs, generated from your code.**

docstube reads a repository, uses your own coding agents or API keys to write source-grounded MDX,
proves or flags every claim with deterministic verifiers, and renders a self-contained Astro docs
site that you own. Fully autonomous within a declared domain: flagged, never silently wrong.

[Website](https://docstube.dev) · [Discussions](../../discussions)

</div>

## Current Status

The repository is mid-way through the v1 rewrite described in [PRODUCT.md](PRODUCT.md) and
[ARCHITECTURE.md](ARCHITECTURE.md) (branch `rewrite-for-v1`):

- Working today: `generate` (codemap → write → claim ledger → deterministic verify → primary-persona
  review → risk critic → structural pass → staged-atomic publish), plus `wizard`, `refine`,
  `preview`, `audit`, `answer`, `check` (kinds derive from registered verifier plugins), `status`,
  `doctor` (`--ci` preflights CI auth and permissions before any model spend), `validate`,
  `plugin`, `upgrade`, the local web UI, and verified translations for declared locales.
  Running `docstube` with no command opens first-run setup, or the dashboard once configured.
- Still landing before 0.1.0: the auto-answer researcher and GitHub `/answer` ingestion, `refine`'s
  strictly-better acceptance gate, the reader-facing navigation tree and `/verification` report, the
  coverage ratchet, and the generated support matrix. Version snapshot cutting is cut from 0.1.0 and
  ships whole in v1.x.
- The plugin API ships as `@docstube/plugin-sdk` (experimental until 1.0): verifiers, language
  packs, content sources, importers, deploy targets, search providers, and MDX components are all
  plugins — including the built-in ones.
- Distribution infrastructure: npm package, GitHub Release binaries, Stacktape-hosted install
  scripts, installer telemetry, and release workflows.

The checked-in source is ahead of the last public npm release. Use the source workflow below for
local testing.

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
pnpm dev status
pnpm dev check --list
pnpm dev check
pnpm dev doctor
```

## User Workflow

After a release is published, the normal Node path is:

```bash
npx docstube wizard
npx docstube generate
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

`pnpm run dogfood:build` runs docstube's own contracts package through the real pipeline with a
deterministic writer — real codemap, real verifiers, real gate, no model calls.
`pnpm run evals:live` is secrets-gated and requires a configured judge model/provider.

Production release, Stacktape deploy, installer telemetry verification, and live-agent checks
require the human-owned npm/GitHub/AWS/Stacktape/provider configuration and should be run
deliberately.

## Repository Map

- [PRODUCT.md](PRODUCT.md): authoritative product specification and hard boundaries.
- [ARCHITECTURE.md](ARCHITECTURE.md): the system design — entity model, plugin kernel, agent
  harness, state model.
- [AGENTS.md](AGENTS.md): coding style, package ownership, and agent operating rules.
- `knowledge/design/`: subsystem design docs (agent transports, salvage inventory, …).
- `apps/cli`: published `docstube` CLI package.
- `apps/local-ui`: localhost web UI (wizard · dashboard · review · flag queue).
- `apps/github-action`: GitHub Action wrapper (auto-merging generated docs PRs).
- `apps/install-events`: install telemetry Lambda.
- `packages/contracts`: the S0 schema layer (entities, provenance, manifest, config).
- `packages/plugin-sdk`: the public plugin API (second published package).
- `packages/agent-runtime`: the BYO-AI harness — docstube owns the loop and tools; vendor CLIs
  are model+billing transports.
- `packages/core`: the kernel — config, plugin host, entity extraction, state, pipeline.
- `packages/codemap` + `packages/lang-typescript`: symbol hashing/diffing and language packs.
- `packages/verifiers`: built-in verifier plugins.
- `packages/theme`: vendored Astro/React generated-site source.

The public marketing website in `apps/web` is intentionally owned by a separate workstream.

## License

[MIT](LICENSE) © 2026 Stacktape
