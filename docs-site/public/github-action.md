---
title: 'CI and the GitHub Action'
description: 'How the docstube GitHub Action runs generation, reports verified changes, and gates auto-merge.'
---

# CI and the GitHub Action

The GitHub Action is the CI wrapper around the CLI. <Claim id="c1">`createDocstubeCliArgs` runs `generate` with `--ci`.</Claim> <Claim id="c2">`createDocstubePreflightArgs` runs `doctor` with `--ci` and `--json`.</Claim>

Use your workflow triggers to decide when docs regenerate. A common starting point is to run the Action on pushes to the branch that owns your docs and on manual dispatch:

```yaml
name: docstube

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docstube/action@v0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Preflight

Before generation, <Claim id="c3">`runGitHubAction` evaluates CI preflight before it checks out the base branch.</Claim> <Claim id="c4">`runGitHubAction` returns before generation when CI preflight is blocked.</Claim> When the preflight report cannot be used, <Claim id="c5">`runGitHubAction` falls back to `checkModelCredential`.</Claim>

The Action also exposes the preflight result to later workflow steps: <Claim id="c6">`setActionOutputs` writes the `preflight` output.</Claim> <Claim id="c7">`setActionOutputs` writes the `automation-mode` output.</Claim>

## Generate And Commit

The Action prepares a branch and then runs the CLI. <Claim id="c8">`runGitHubAction` checks out the base branch before it creates the docstube branch.</Claim> <Claim id="c9">`runGitHubAction` reads the head commit before it runs docstube.</Claim>

The committed manifest is the docs lockfile for the PR report. <Claim id="c10">`manifestIndexRelativePath` is `.docstube/manifest/manifest.json`.</Claim> <Claim id="c11">`loadVerifiedDelta` reads the manifest index from `manifestIndexRelativePath`.</Claim> <Claim id="c12">`loadVerifiedDelta` returns `undefined` when the manifest index is missing.</Claim>

The Action stages a bounded set of paths. <Claim id="c13">`selectCommitPaths` filters changed files through `machineLocalPatterns`.</Claim> <Claim id="c14">`verifyOutputInventory` returns staged paths, undeclared paths, and hash mismatches.</Claim> <Claim id="c15">`runGitHubAction` commits `inventoryCheck.stagedPaths` when an inventory check exists.</Claim>

## Pull Request Report

When there is committed work, <Claim id="c16">`runGitHubAction` creates a pull request when no open pull request exists for the docstube branch.</Claim> <Claim id="c17">`runGitHubAction` updates the open pull request when one already exists for the docstube branch.</Claim>

The PR body is generated from the verified delta and merge decision. <Claim id="c18">`buildPullRequestBody` includes the changed pages section when a verified delta exists.</Claim> <Claim id="c19">`buildPullRequestBody` includes the open flags section when a verified delta exists.</Claim> <Claim id="c20">`buildPullRequestBody` includes the publication decision section.</Claim>

The job summary follows the same run outcome. <Claim id="c21">`buildJobSummary` reports no branch and no pull request for failed runs.</Claim> <Claim id="c22">`buildJobSummary` reports no documentation changes for no-change runs.</Claim> <Claim id="c23">`buildJobSummary` reports the pull request URL for pull-request runs.</Claim>

## Auto-Merge Gate

Auto-merge is gated by the publication artifacts, open blocking flags, and inventory validation. <Claim id="c24">`publicationDecisionRelativePath` is `.docstube/runs/publication-decision.json`.</Claim> <Claim id="c25">`outputInventoryRelativePath` is `.docstube/runs/output-inventory.json`.</Claim> <Claim id="c26">`loadPublicationArtifacts` returns a failed validation when the output inventory file is missing.</Claim> <Claim id="c27">`loadPublicationArtifacts` returns a failed validation when the publication decision file is missing.</Claim>

The Action enforces that decision after the CLI has run. <Claim id="c28">`decideAutoMerge` withholds auto-merge when a blocking open flag exists.</Claim> <Claim id="c29">`decideAutoMerge` withholds auto-merge when publication validation is not ok.</Claim> <Claim id="c30">`decideAutoMerge` withholds auto-merge when undeclared paths exist.</Claim> <Claim id="c31">`decideAutoMerge` enables auto-merge when `withheldReasons` is empty.</Claim>

If the gate passes and GitHub accepts the request, <Claim id="c32">`runGitHubAction` enables auto-merge through `mergeControl.enableAutoMerge`.</Claim> <Claim id="c33">`createMergeControl` requests the squash merge method.</Claim>

## Flags And Tribal Knowledge

Flags are delivered on the pull request when the PR number is known. <Claim id="c34">`runGitHubAction` calls `deliverFlags` when the merge decision has open flags.</Claim> <Claim id="c35">`planCommentUpsert` updates an existing comment when that comment body includes the marker.</Claim> <Claim id="c36">`planCommentUpsert` creates a comment when no existing comment body includes the marker.</Claim>

Tribal-knowledge flags also feed a durable issue. <Claim id="c37">`digestIssueTitle` is `docstube: open questions`.</Claim> <Claim id="c38">`upsertTribalDigestIssue` filters open flags to `tribal-knowledge` flags.</Claim> <Claim id="c39">`upsertTribalDigestIssue` creates the digest issue when tribal-knowledge flags exist and no digest issue exists.</Claim> <Claim id="c40">`upsertTribalDigestIssue` updates the digest issue when a digest issue already exists.</Claim>
