---
'docstube': patch
---

Only one docstube run can touch a workspace at a time — concurrent runs can no longer corrupt each
other's state.

- Runs share `.docstube/staging/` (a single mutable staging area with a phase machine) and the
  manifest store, so two at once could interleave staged pages and publish the site twice. Double
  clicking **Start run** in the local UI, clicking it while first-run setup's generate is still
  going, or running `docstube generate` in a terminal with the UI open could all do it. Now a run
  holds a lock on the workspace for its whole duration.
- In the local UI a second start is harmless and never an error: it does not begin a second run, it
  points you at the run already going. The UI says which happened — "Run … started" versus "a run
  was already in flight — following it" — and the dashboard shows what currently holds the
  workspace, including a run started from a terminal rather than the UI.
- `docstube generate` and `docstube refine` refuse to start while another run holds the workspace,
  naming the run, its mode and the process that owns it, and exit without touching anything.
- The lock self-heals, so a crashed run can never wedge a workspace: a lock whose process is gone
  is taken over immediately by the next run (which is also what repairs an interrupted publish),
  and any lock that has stopped heartbeating for 60 seconds is taken over regardless — including
  one left behind on another machine sharing the checkout.
- The lock lives at `.docstube/run.lock`. Like `.docstube/runs/`, `cache/` and `staging/`, it is
  machine-local: gitignored, never part of the CI output inventory, and never committed by the
  GitHub Action.
