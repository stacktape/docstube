---
'docstube': patch
---

Code-review hardening batch:

- Strict config family: `docstube.yml`, `ia.yml`, and `glossary.yaml` now hard-error on unknown
  keys (typos no longer vanish silently), and `ia.yml` rejects duplicate page slugs and pageIds
  that would silently collide manifest shards and routes.
- Repo-relative paths (including plugin `writableRoots`) reject `..`/`.`/empty segments; plugin
  writes are checked on the resolved path so `cache/../../x` cannot escape a declared root.
- Commit ids accept SHA-256 git object ids (up to 64 hex chars).
- Run journal: a truncated trailing line (crash mid-write) no longer bricks resume, and a pipeline
  that fails with an error now journals a terminal `run-completed: failed` event instead of
  reading as running forever.
- Re-cutting a version label fully replaces the snapshot (stale shards from the prior cut are
  removed); scaffold is race-safe against concurrent config creation; programmatic YAML edits are
  validated before anything touches disk.
- Correctness: the agent-task cache re-hashes observed-read files on every hit, so an edited
  source file can never replay a stale cached page; a refresh over carried pages with standing
  open flags now reports `flagged` instead of `passed`; failed translations never emit
  untranslated MDX under a locale path, and a translation that alters a code block is rejected
  outright; transports map `content_filter`, `refusal`, `pause_turn`, and unknown stop reasons to
  error turns instead of shipping filtered/partial output as complete.
- Robustness: CRLF checkouts of `.docstube/knowledge/` parse correctly, absolute plugin paths
  load as-is, `docstube doctor` exits non-zero on an invalid `docstube.yml`, telemetry survives a
  read-only home directory and bounds its network send with a 2s timeout, refine reports
  estimated spend and journals `run-frozen` on plan-usage freezes, and the GitHub Action fails
  fast when `git fetch`/`git pull` cannot sync the base branch.
- Quality: retry prompts now carry the failed draft as an edit instruction, reviewers get the
  standard read-only tools for source-grounded review, skipped persona reviews and dropped
  (unanchored) claims are journaled, claim anchors disambiguate repeated quotes by prefix/suffix
  context, and `docstube audit` drops hallucinated claims (anchor quote not in the page) into a
  warning bucket instead of ever counting them as defects.
