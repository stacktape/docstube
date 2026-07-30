---
'docstube': patch
---

Structural quality: docstube now judges the SHAPE of the docs, not just their correctness.

A dedicated structure pass runs over the staged canonical site after every page has landed and
before anything publishes — the only moment the whole shape of what the reader is about to get
exists in one place. It builds a `StructuralSnapshot` (nav cohorts with their ia.yml consistency
posture, per-page brief / primary persona / structure profile / outline / block composition /
claim subjects, what changed, what was skipped, prior findings) and runs detectors over it.

- **Deterministic detectors** emit findings with no model in the loop: `structure.empty-section`
  (a heading that promises content the page does not deliver), `structure.duplicate-heading` (the
  same ground covered twice on one page), and `structure.required-facet-missing` (a
  `required-facets` consistency rule the user wrote in ia.yml).
- **Sibling shared-facet asymmetry**, the flagship, is AI-assessed: an outline matrix finds a
  section that ≥60% of a cohort of ≥4 comparable siblings carry and some do not, and that
  threshold **summons a question, it is never a verdict**. A group assessor judges each missing
  page `expected | not-applicable | uncertain` from its own brief, plan and documented subjects,
  and ONE group finding is emitted naming only the pages judged `expected`. `uncertain` produces
  no finding at all. Conservative 0.1.0 rules: cohort ≥ 4, same structure profile and page role,
  source locale only, and pages ia.yml declares exempt leave the ratio entirely.
- **Every structural finding is nonblocking** — even an explicit-rule violation. They are
  committed work items: page findings on page shards, group findings in
  `.docstube/manifest/structure/<groupId>.json`, surfaced as dashboard/NavTree counts
  (`structural.list`) and as their own PR-summary section ("Structural quality: 3 open ·
  nonblocking"). They never enter the flag queue, never gate a merge, never touch the claim
  ledger, and are never called a "verified defect".
- **Lifecycle**: a stable semantic key collapses a re-detected defect onto one record; auto-resolve
  fires only after the same scope was actually re-evaluated; a suppression carries its reason and a
  scope fingerprint and reopens when the content it was about materially changes.
- **Cost**: at most one group assessment per changed group per run, cached on the group plan +
  member outline hashes + detector/prompt version + model, never per-locale, never all-pairs. A
  budget-exhausted pass records the scope as pending and lets the run publish.
- **`docstube refine`** now ranks open auto-repairable structural findings first, impact-ordered,
  and expands a group finding to its MINIMAL repair targets — it will not reroll all eight siblings
  because three lack a section.
