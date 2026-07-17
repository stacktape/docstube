# `docstube audit` — claim extraction and matching on foreign docs

Design doc for open question 5 (PRODUCT §7.5, ARCHITECTURE §13 row 5). Referenced by
`packages/core/src/audit/`. The metric it produces is the public accuracy metric
(PRODUCT §1.3) and the GTM wedge (PRODUCT §2): run it on famous OSS repos, publish
drift reports, offer to fix.

## The metric

**Verified defects per 100 extracted claims.**

- Denominator: ALL extracted claims — grounded + defective + unverifiable. Unverifiable
  claims dilute the rate; they are never counted as defects. This is deliberate: the
  metric must never overclaim, or the head-to-head comparisons it exists for collapse.
- Numerator: verified defects only — each one is an identifier the docs depend on that
  deterministically does not exist in the audited repo's codemap (the Tan/Wagner/Treude
  stale-reference class: "28.9% of popular repos document symbols that no longer exist").
- A claim with several stale identifiers contributes one defect per missing identifier
  (each is independently verified); the claim itself leaves the grounded/unverifiable
  buckets. `defectsPer100Claims = defects.length / claims * 100`.
- `exit 1` when defects > 0: audit is a measuring device, and a verified defect is a
  failure of the docs under test.

## Pipeline

```
foreign docs dir ──> parse-foreign-docs ──> page entities (same entity model as ours)
audited repo     ──> codemap (tree-sitter/compiler language packs via plugin host)
per page         ──> audit-extract-claims agent task ──> structured claims
claims × codemap ──> match-claims (deterministic) ──> grounded | defect | unverifiable
```

1. **Parse** — walk the docs dir for `.md`/`.mdx` (skipping `node_modules`, dot-dirs,
   build output), run each file through `extractPageEntity` — foreign docs get the same
   page → section → block entity trees our own output gets; the slug derives from the
   relative path. Files the MDX parser rejects (foreign markdown is not always valid
   MDX) are reported as skipped, never silently dropped.
2. **Extract claims** — one `audit-extract-claims` agent task per page, structured
   output (`{ claims: [{ text, anchor, claimClass, identifiers }] }`, JSON schema from
   the shared `claimAnchorSchema`/`claimClassSchema` contracts). The prompt asks for
   CHECKABLE claims only — API shapes, identifier existence, defaults, CLI flags,
   concrete code behavior — never opinions or marketing, capped at ~30 per page.
   `identifiers` are the backtick-quoted or obviously-referenced code identifiers the
   claim's truth depends on.
3. **Match** — deterministic, no AI. Each identifier is checked against the codemap:
   exact symbol name, containerPath segment (module/class containers), or dotted path
   matching a containerPath-tail + name suffix (`Greeter.send`). ANY checkable
   identifier found → the claim is **grounded**; only a claim where EVERY checkable
   identifier fails to ground is a **defect** of kind `stale-reference`. (Live
   calibration: claims usually name their anchor symbol plus incidental
   parameter/property tokens — `options.loud` — and any-missing-is-a-defect produced
   false positives on those.) No identifiers → **unverifiable**.

## What v1 measures honestly — and the never-overclaim guards

v1 verifies exactly one claim class end-to-end: **identifier-grounded existence**. That
is the right first class — it is the dominant documented human failure mode, it is
fully deterministic, and a skeptical reader can re-check every reported defect by hand.

Guards that keep false positives out of the numerator:

- **Ambient names are not defects.** `Promise`, `JSON`, `string`, `process`, … are
  language/runtime ambients no repo codemap contains; identifiers on the ambient
  stoplist are excluded from checking (a claim with only ambient identifiers is
  unverifiable).
- **Only identifier-shaped tokens are checked.** File paths, URLs, CLI flags
  (`--json`), shell fragments — anything not matching a dotted code-identifier shape —
  is uncheckable in v1 and lands in unverifiable, not defects.
- **Dotted paths must match a real container suffix**, not just have both halves exist
  somewhere.

Known v1 limitation (accepted, documented): the codemap indexes the exported API
surface, so a doc referencing a genuinely internal symbol can surface as a defect.
Public docs describing non-public symbols is itself a docs smell, but it means audit
reports are reviewed before publishing (the GTM flow does this anyway).

## What v1 cannot measure — v2 direction

**Behavioral claims** ("returns null when the user is missing", "defaults to 3
retries", "throws on invalid input") extract fine — they get `claimClass:
'behavioral'` — but matching them needs verifier-backed checking, not name lookup: the
v2 direction is routing claim classes to the deterministic verifier registry
(PRODUCT §4.1) — snippet execution/typecheck for `code-sample` claims, config-schema
validation for `configuration` claims, OpenAPI matching for endpoint claims, CLI-flag
extraction for flag claims. Until a verifier can prove or refute a class, its claims
stay in the unverifiable bucket — in the denominator, never the numerator. A
`code-sample` typecheck hook (reusing the language packs' `snippetToolchain`) is the
first planned upgrade; see the TODO in `match-claims.ts`.
