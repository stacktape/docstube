---
title: "CI and the GitHub Action"
description: "Run docstube in GitHub Actions, open verified documentation PRs, deliver flags, and gate auto-merge from the committed manifest."
---

# CI and the GitHub Action

The GitHub Action runs docstube in a checked-out repository, reads the committed manifest, and opens or updates a documentation pull request. The action supports two modes: `generate` and `refresh`. If `mode` is not provided, it uses `refresh`.

The action metadata lives at `apps/github-action/action.yml` in this repository. A workflow that uses `uses: ./apps/github-action` only works in a repository that actually contains that local action path, such as the docstube repository itself. For another repository, replace that local action identifier with the published or vendored action location you use. The source does not define a canonical public `uses:` reference.

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
  refresh-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run docstube
        uses: ./apps/github-action
        with:
          mode: refresh
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

<Callout>
The local `./apps/github-action` reference is the action identifier for repositories that include this action directory. If your project consumes docstube from outside this repository, replace it with the action location you have installed, vendored, or published.
</Callout>

For an initial documentation run, set `mode: generate`. For ongoing CI maintenance after code changes, use `mode: refresh`.

The action input `mode` controls the CLI command that is run. Internally, the action invokes `npx --yes <docstube-package> <mode>`. The default package spec is `docstube@latest`, and the default mode is `refresh`.

## What The Action Commits

After the CLI finishes, the action reads `git status --porcelain`, filters the changed paths, and commits the remaining paths together. It excludes machine-local docstube state under `.docstube/db.sqlite`, `.docstube/cache/`, and `.docstube/runs/`.

That means the pull request contains the docs changes and the committed manifest state together. The verified delta is computed from `.docstube/manifest/manifest.yml` and readable page shard files under `.docstube/manifest/pages/...`.

If there are no commit-worthy changes, the action writes a job summary and does not open a pull request.

## Refresh On Code Change

Use `refresh` for normal CI maintenance. The action checks out the target base branch, creates or resets a docs branch, runs docstube, commits changed documentation and manifest files, pushes the branch, and opens or updates a pull request.

By default, the target branch comes from `base-branch`, then `GITHUB_BASE_REF`, then `GITHUB_REF_NAME`, and finally `main`. The generated branch name defaults to `docstube/docs/<base-branch>`.

## Auto-Merge Gate

Auto-merge is only attempted when the action can compute a verified delta and the pull request number is known. The merge decision is based on open flags from page shards and manifest system flags.

Open flags with these kinds block auto-merge:

- `out-of-domain`
- `tribal-knowledge`
- `guarantee-downgrade`
- `structural-change`
- `system`

Open `coverage` flags do not appear in the hardcoded blocking list.

When no blocking open flag exists, the action calls GitHub's auto-merge API with squash merge. If GitHub rejects the request, the action leaves the pull request open and reports auto-merge as unavailable.

## Flag Delivery

When a pull request has open flags, the action posts a marker-tagged PR comment. On later runs, it updates the existing marker-tagged comment instead of creating a new one.

The pull request body and job summary include changed pages, guarantee counts, open flag counts, the auto-merge decision, and committed files when a verified delta is available.

## Tribal-Knowledge Digest

Tribal-knowledge flags are also collected into a long-lived issue titled `docstube: open questions`. The action searches for an open issue with that title. If it exists, the action updates it; otherwise, it creates it.

The digest issue body includes the open tribal-knowledge questions, plus entity, symbol, and flag details when those fields are present in the manifest data.