---
'docstube': minor
---

Remove the public `refresh` command and the GitHub Action `mode` input. `docstube generate` is
the one idempotent reconciler (first run = full generation; later runs = affected work), and the
GitHub Action always runs `generate`. Workflows still passing `mode:` fail with an actionable
message instead of silently running something else.
