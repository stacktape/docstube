---
'docstube': minor
---

Honest completeness badge, wider coverage-lint recall, and kernel-owned page frontmatter.

- The coverage linter's identifier signal is now BLOCK-scoped: an assertion sentence is flagged
  when its owning block names a code identifier anywhere, so a continuation like "It always
  returns 2." after a sentence naming `retry` no longer escapes the trust denominator.
  Assertion-shaped headings are scanned too, prose inside page-authored HTML/JSX is consistently
  excluded, and a bare dotted path no longer satisfies the "real prose" gate by itself.
- Every `docstube*` frontmatter key authored on a page is stripped before emission injects the
  kernel-computed values, and the claims chip re-derives the complete state from the numbers it
  renders — an artifact declaring `docstubeClaimsComplete: true` can never paint a partial page
  green.
- The complete/green state now states its meaning precisely wherever it is explained (chip
  popover, all three themes): every claim in the page's ledger is checked and no unmarked
  assertion was detected — not "this page contains no unverified statement". The deterministic
  linter is a floor with documented limits; semantic assertion-coverage is the risk critic's job
  and ships with the review-routing wave.
- The local review UI shows the full picture on a contradicted page — contradicted count,
  checked/total, and unmarked assertions together, instead of collapsing to the warning alone.
- Emission reports any non-ENOENT failure while scanning for obsolete routes, so stale routes can
  never be silently unreported, and rejects a page slug that would occupy a configured locale's
  route namespace (`de/foo` with `de` configured) at IA load and emission planning.
