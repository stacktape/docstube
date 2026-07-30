---
'docstube': patch
---

`docstube generate` now publishes its whole plan at once, or publishes nothing at all.

- Pages no longer land in your docs site one at a time as they finish. Completed pages, their
  manifest shards and the index accumulate in `.docstube/staging/` (machine-local and gitignored)
  and are published in a single step when the plan completes. A run that freezes at the budget cap,
  crashes, or dies on a transport error therefore leaves your published site and manifest
  byte-identical to what they were — the site can no longer show half of a source change.
- Because of that, `--ci`'s `publishable: false` now means literally nothing was written to the
  published tree, instead of "some of it landed anyway". The output inventory the decision binds to
  is collected after the publish, so it describes what is actually published.
- Rerunning `docstube generate` after a freeze resumes: pages the frozen run already finished are
  reused verbatim from staged work — no agent call, nothing re-billed — and only the remaining
  pages are generated. Staged work is discarded (and regenerated) when the config, the IA, or any
  source file the run read has changed since; changing only `agents.budgets` keeps it, so raising
  the cap to finish a frozen run does not throw the work away.
- Publishing has exactly one implementation now: shard persistence and site emission are steps in
  the same ordered publish, with the manifest index written last, so a partial publish can never
  advertise a page whose files are missing. If a publish is interrupted, the next `generate`
  detects it and finishes the same publish before doing anything else.
- `docstube preview`, the local UI, and the GitHub Action only ever see published state:
  `.docstube/staging/` is excluded from the output inventory and from the Action's commit paths.
