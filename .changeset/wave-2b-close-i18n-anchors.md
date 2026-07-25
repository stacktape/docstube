---
'docstube': patch
---

Wave 2b close hardening across translation hygiene, locale routing, anchors, and refine emission:

- Translation hygiene now compares Claim markers by (owning block, marker id) pairs in document
  order, so a marker relocated into another same-typed block fails with `[marker-block]` instead
  of passing the global sequence check and annotating the wrong prose. Malformed translated MDX
  can no longer throw the run — it becomes a nonblocking translation failure for that page-locale.
- A configured locale with no shard for a page now emits the source-fallback route with the
  not-yet-translated notice and a warning, instead of being skipped (no 404s, no hidden pages).
- Section anchors are generated with `github-slugger`, byte-identical to the heading ids Astro
  emits — Unicode headings and repeated headings now get chips that actually resolve.
- `docstube refine` re-emits the site from persisted state when the run throws mid-way, matching
  `docstube generate`, so rendered routes never disagree with committed shards.
- Translations carry an explicit translation-assurance state and every theme renders
  "Translation: not yet reviewed" as a distinct line beside the correctness counts — a translation
  the bilingual fidelity review has not judged never reads as fully checked.
