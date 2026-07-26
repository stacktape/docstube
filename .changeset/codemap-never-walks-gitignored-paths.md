---
'docstube': patch
---

The codemap never walks gitignored paths — build output is not documentation source.

- Repo scanning now asks git once (`git ls-files --cached --others --exclude-standard`) for the
  files git actually versions and walks only those, so gitignored build output, caches and local
  artifacts at any depth are no longer read as documentation source. On this repository the walk
  drops from 733 files to 675 (353 TypeScript files instead of 372) and reads zero unversioned
  files instead of 58.
- Because unversioned reads mark a run as checked against uncommitted bytes, the previous behavior
  made the complete badge unreachable in any repository with gitignored build output. Pages in such
  repositories can now reach the complete state again.
- The unversioned-sources rule is unchanged and still marks a run for genuinely unversioned reads —
  a new source file the author has not added yet, or an agent read of an ignored path — and its
  warning now says which of those it saw.
- When git is unavailable, the directory is not a repository, or the scanned root is itself ignored
  by an outer repository (the dogfood workspace), scanning falls back to the built-in skip list
  instead of returning nothing. The explicit `ignore` option and the built-in skips still apply.
