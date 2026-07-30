---
'docstube': minor
---

**The evidence-fed risk critic ships.** Every page now gets exactly one critic call that receives
the page prose, its claim ledger (what each claim asserts, its correctness, and the evidence
backing it), the coverage linter's uncovered spans, and the page brief + primary persona — and
that is deliberately all it gets. It has no repository access and no tools. Giving a critic source
tools is what turned persona reviews into plausibility theater; a critic that can only compare the
prose against the evidence summary has exactly one useful thing to do, which is find where they
disagree.

It closes three open ends at once:

- **Semantic assertion coverage.** The deterministic coverage linter is a floor with documented
  limits — it cannot see an assertion with no identifier or no keyword ("the client gives up after
  a while"), or prose inside page-authored markup. Those are now the critic's `unmarked-assertion`
  findings. **The `complete` badge is unchanged in both directions:** a critic finding never
  withholds it (a model's opinion must not fail a correct page) and never grants it (an uncovered
  span still forbids completeness on the linter's own terms). Every surface now prints the
  deterministic count and the semantic count together, and says which one owns the badge.
- **Within-page structural judgment.** The structure pass ships deterministic detectors only, so
  two differently-titled sections covering the same ground (`duplicate-coverage`) and an example
  under the wrong heading (`misplaced-example`) ride the critic.
- **Residual factual risk.** Correctness left persona reviews (they judge audience fit and brief
  conformance now); `misleading-framing`, `dangerous-omission`, and `wrong-emphasis` are what the
  claim ledger structurally cannot catch.

Findings are typed, anchored to a real block or claim id, and carry a severity plus a rationale.
They are **assessments, never claims**: they live in provenance `assessments.riskCritic`, never
enter the claim ledger or the correctness axis, and are **nonblocking** — committed work items
`docstube refine` picks up, surfaced in their own PR section and their own review-UI surface, never
in the flag queue, never a merge gate.

Cost and honesty: one call per page, cached under `.docstube/cache/risk-critic/` on the page's
prose + ledger state + linter spans + brief/persona + prompt version + model, so a page that did
not change never re-bills. When the critic cannot run — no routable model, a frozen budget, a
transport failure — the page still publishes and the assessment records `pending`, never a silent
pass. A response that is not a verdict is recorded as a non-completion rather than parsed into
"zero findings".

New routable role `risk-critic` (`agents.roles.risk-critic`), so this per-page spend can be moved
to its own model independently of the writer and reviewer.
