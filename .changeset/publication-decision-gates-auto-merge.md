---
'docstube': patch
---

Auto-merge now requires a valid kernel publication decision — a run that did not finish can no
longer merge itself.

- `docstube generate --ci` emits a `PublicationDecision` plus the `OutputInventory` it is bound to,
  under `.docstube/runs/` (machine-local, gitignored, never committed). The decision records what
  actually executed (completed / paused-budget / failed), how the plan reconciles (planned =
  completed + deferred), the deterministic gate result, a real base-vs-candidate ledger comparison,
  `publishable`, `autoMergeEligible`, and the reason codes that fired.
- The GitHub Action no longer decides publishability from open flags alone. It validates the
  decision against the published contracts and enforces it. Auto-merge is withheld when the
  artifact is absent, unreadable, schema-invalid, bound to a different output tree or a different
  commit, or carries a reason code this Action's registry version does not know — and whenever the
  kernel reports the candidate not publishable or not auto-merge eligible. Open blocking flags
  still block; they are now one input among several. Frozen (budget-capped) runs never merge.
- Guarantee-downgrade detection became semantic: badge loss, a checked claim moving to
  unchecked/contradicted, a checked-count drop not explained by claim deletion, deciding-evidence
  authority weakening, and attestation loss are compared against the committed manifest the run
  started from. New blocking claim dispositions block; pre-existing ones do not (no new debt).
- The commit boundary is an output-inventory allowlist: the Action stages only paths the run
  declared, verifies their content hashes, and reports any undeclared dirty path (an edited source
  file, a stray write) while marking the candidate ineligible. Undeclared paths are never committed.
- The PR body and job summary now state the decision plainly — what executed, what was deferred,
  why the merge was withheld, and which reason codes fired. A withheld merge never reads as a
  silent no-op.
