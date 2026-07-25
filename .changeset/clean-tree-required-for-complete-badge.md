---
'docstube': minor
---

A dirty working tree can no longer mint the complete/green page state.

- The badge asserts a claim about committed source, so completeness now additionally requires a
  clean working tree. A run over uncommitted changes (or a checkout with no HEAD) still renders the
  page's true, content-hash-bound counts, plus an explicit "checked against uncommitted changes"
  note — but never the complete state, in any theme or in the local review UI.
- Reader surfaces stop presenting the HEAD commit as such a page's source revision: the sources
  footer withholds the commit label and its `/blob/<commit>` links, because HEAD did not contain
  the bytes that were checked, and shows the uncommitted-tree wording in their place.
- CI runs on clean checkouts are unaffected; committing the source and re-running
  `docstube generate` restores the badge.
