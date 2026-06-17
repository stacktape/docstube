# docstube acceptance

This file is the human-readable acceptance ledger for the product described in `PLAN.md`.

It is not an implementation queue. The old task list has been completed in source and removed
from this file so acceptance does not drift away from executable tests. Product behavior that can
be tested should be covered by a focused test, smoke test, eval, or build step.

## Executable gates

Use these checks as the current source of acceptance evidence:

- `pnpm run validate`: formatting, linting, typechecking, Vitest, deterministic evals, and all
  workspace builds.
- `apps/cli/src/product-smoke.spec.ts`: TS and Python fixture repos run through the real CLI
  `generate`, generated-site build/postbuild, `refresh`, and `refine` paths.
- `apps/cli/src/cli-commands.spec.ts` and `apps/cli/src/cli-help.spec.ts`: command surface,
  options, source CLI behavior, and terminal output.
- `apps/cli/src/package-manifest.spec.ts`: public npm package shape and private workspace package
  dependency guard.
- `apps/local-ui/src/product-app.spec.tsx`, `apps/local-ui/src/setup-wizard.spec.tsx`,
  `apps/local-ui/src/generation-dashboard.spec.tsx`, and `apps/local-ui/src/review-room.spec.tsx`:
  wizard, dashboard, and review flows over the local-control-plane data shape.
- `packages/core/src/project-generation.spec.ts`, `packages/core/src/project-refresh.spec.ts`,
  `packages/core/src/project-maintenance.spec.ts`, `packages/core/src/pipeline-run.spec.ts`,
  `packages/core/src/pipeline-artifacts.spec.ts`, and `packages/core/src/page-orchestrator.spec.ts`:
  generation, provenance, refresh, refine, and gate behavior.
- `packages/contracts/src/config-schema.spec.ts`, `packages/contracts/src/page-schema.spec.ts`,
  `packages/contracts/src/registry-schema.spec.ts`, and neighboring contract specs: S0 contracts,
  schemas, fixtures, JSON Schema, cache keys, page/frontmatter rules, deterministic check results,
  and registry metadata.
- `packages/verifiers/src/verifiers.spec.ts`: deterministic verifier families and result taxonomy.
- `packages/codemap/src/codemap.spec.ts` and `packages/extractors/src/extractors.spec.ts`:
  deterministic source facts and API extraction.
- `packages/theme/src/theme.spec.ts`: generated Astro/React theme, stable components, postbuild
  files, Pagefind, `llms.txt`, and sitemap behavior.
- `packages/agent/src/agent.spec.ts`: adapter contracts, replay behavior, direct API extraction,
  model validation, and usage-cap behavior.
- `apps/github-action/src/github-action.spec.ts`: GitHub Action wrapper around `docstube refresh`
  and PR/change-summary behavior.
- `scripts/dogfood/build-dogfood.spec.ts` and `pnpm run dogfood:build`: docstube generates a
  reviewable docs artifact for the docstube repo itself without live agents.
- `scripts/evals/run-evals.spec.ts` and `pnpm run evals`: deterministic quality-eval harness and
  gold-set thresholds.

When a future change claims product acceptance, prefer adding or updating one of these tests over
adding another prose checklist.

## External gates

These are intentionally not normal CI tests because they require human-owned accounts, secrets,
deployment choices, or cost-bearing live services:

- `apps/web` marketing site implementation is a separate workstream.
- `.github/workflows/dogfood.yml` builds and uploads a real dogfood review artifact; final
  deployment destination is chosen by the marketing/deployment workstream.
- `pnpm run evals:live` requires `DOCSTUBE_LIVE_EVAL_MODEL` plus a supported provider key.
- End-to-end release testing requires the configured npm/GitHub/AWS/Stacktape environment.
- Stacktape production deploy and installer telemetry verification require production account
  access and should be run deliberately.

## Regression rule

If a future agent finds placeholder, fixture-only, or "ready to..." behavior in an implemented
product area, treat it as a regression. Replace it with real product behavior behind the planned
interfaces and add or update executable coverage.

Hard TBD boundaries remain in `PLAN.md`; do not implement those areas as part of acceptance
cleanup.
