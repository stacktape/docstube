---
title: "CI and the GitHub Action"
description: "Run docstube in GitHub Actions, open verified documentation PRs, deliver flags, and gate auto-merge from the committed manifest."
---

# CI and the GitHub Action

The GitHub Action metadata is defined in `apps/github-action/action.yml`. In this repository, the action identifier is the local path `./apps/github-action`; that identifier only works in workflows for a repository that contains that path.

<Callout>
The source defines the local action path and the package name `@docstube/action`, but it does not define a public `uses:` reference. If you run docstube from another repository, replace `./apps/github-action` with the action location you have installed, vendored, or published.
</Callout>

```yaml
name: docstube

on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  generate-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run docstube
        uses: ./apps/github-action
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

The action always runs `docstube generate` — the idempotent reconciler handles first runs and ongoing maintenance alike. The former `mode` input was removed; workflows still passing it fail with an actionable message.

The `github-token` input is used by the `gh` CLI for pull requests, PR comments, the digest issue, and auto-merge. If it is not provided, the action reads `GITHUB_TOKEN`.

The model credential is separate from the GitHub token. Before running the CLI, the action checks for API key environment variables. If `docstube.yml` names variables with `apiKeyEnv:`, those names are checked. Otherwise, the action checks common names including `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, and `GEMINI_API_KEY`.

## Inputs

| Input | Default | Behavior |
| --- | --- | --- |
| `github-token` | `GITHUB_TOKEN` | Token passed to `gh` for PRs, comments, issues, and auto-merge. |
| `base-branch` | `GITHUB_BASE_REF`, then `GITHUB_REF_NAME`, then `main` | Branch checked out and targeted by the PR. |
| `branch-prefix` | `docstube/docs` | Prefix for the generated docs branch. |
| `commit-message` | `docs: docstube generate` | Commit message for the docs update. |
| `docstube-package` | `docstube@0.0.2` | Package spec passed to `npx --yes`. |
| `workspace` | `GITHUB_WORKSPACE`, then the current working directory | Checked-out repository path. |

The action rejects the removed `dry-run` and `mode` inputs. It always opens or updates a real pull request when there are commit-worthy changes.

## What The Action Runs

The action checks out the base branch, creates or resets a docs branch, and runs the CLI as:

```bash
npx --yes docstube@0.0.2 generate
```

The package spec changes when `docstube-package` is set.

After the CLI exits successfully, the action reads `git status --porcelain`, filters out machine-local state under `.docstube/db.sqlite`, `.docstube/cache/`, and `.docstube/runs/`, and commits the remaining changed paths together.

That single commit can include generated docs, manifest shards, criteria, instructions, and knowledge files. If no commit-worthy paths remain, the action writes a job summary and does not open a PR.

## Manifest Delta

The action computes the verified delta from `.docstube/manifest/manifest.yml` and page shard files under `.docstube/manifest/pages/...`. It does not derive the PR decision from CLI prose.

The PR body and job summary include changed pages, guarantee counts, open flag counts, the decision, and committed files when the manifest delta is available. If no manifest index is found, the action leaves the PR open without auto-merge.

## Auto-Merge Gate

The merge decision uses open flags from readable page shards plus manifest system flags. Auto-merge is eligible only when no open flag has a blocking kind.

Blocking open flag kinds are:

- `out-of-domain`
- `coverage`
- `guarantee-downgrade`
- `structural-change`
- `system`

`tribal-knowledge` is not in the hardcoded blocking list. Open tribal-knowledge questions can be delivered without blocking the docs PR.

When the PR is eligible, the action calls GitHub's auto-merge API with squash merge. If GitHub rejects that request, the action leaves the PR open and reports auto-merge as unavailable.

## Flag Delivery

When a PR has open flags, the action posts a marker-tagged PR comment. On later runs, it updates the existing marker-tagged comment instead of creating another one.

Tribal-knowledge flags are also collected into a long-lived issue titled `docstube: open questions`. The action searches for an open issue with that title, updates it if it exists, and creates it otherwise.