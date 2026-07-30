---
'docstube': patch
---

`docstube doctor --ci --json` preflights everything a CI run needs before any model spend, and the
GitHub Action now runs it first.

- New `--ci` mode runs the CI-relevant preflight and exits non-zero when a check would waste money
  or produce an unmergeable PR. `--json` emits one versioned `CiPreflightReport` (closed, versioned
  check-id registry, the same cross-version discipline as the `PublicationDecision`) that the
  Action parses.
- The transport credential check resolves the transport the run will ACTUALLY use — the parsed
  `agents:` block plus the internal transport override, mirroring `createTransportFromConfig`
  exactly — instead of scanning docstube.yml for `apiKeyEnv:` strings. Vendor CLIs are checked for
  their binary and for an unattended token (a CI runner cannot complete an interactive login); API
  transports are checked for the one env var they actually read; a keyless OpenAI-compatible
  endpoint passes when it is a local server and fails when it is a hosted API that will 401 mid-run.
  A missing credential for the configured transport is fatal and names the env var; another
  provider's key being absent is not.
- In a GitHub Actions context the preflight reports what the token can and cannot do: repository
  write, pull-request access, issue access for the tribal-knowledge digest, whether the repository
  allows auto-merge, and whether the target branch's protection would let one complete.
- Auth honesty: a GitHub App installation token — which is what the workflow's own `GITHUB_TOKEN`
  is, and whose PRs GitHub will not run workflows for — reports the mode as **approval-assisted**,
  never full-auto. `full-auto` is only claimed when the token, the repository setting, and the
  branch policy are all proven; the report schema itself rejects a full-auto claim over an unproven
  precondition.
- Checks that cannot be performed report `unknown` with their reason. Unknown is never a pass and
  never fatal by itself.
- The Action runs the preflight before the generate step and aborts with the report rendered into
  the job summary when a blocking check fails — zero model spend on a failed preflight. New
  `preflight` and `automation-mode` outputs. The old environment credential heuristic is retained
  only as the fallback for a pinned CLI that predates this command, and the Action says so out loud
  when it degrades.
