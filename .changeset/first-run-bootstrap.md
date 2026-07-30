---
'docstube': patch
---

First-run setup actually works on a first run.

- **Bare `docstube` is the entry point.** With no `docstube.yml` it opens the browser directly into
  first-run setup; with one it opens the dashboard. It is TTY-safe — a non-interactive shell or CI
  prints the URL instead of launching a browser — and `--no-open` always works. An unknown command
  is reported as a typo instead of silently opening a UI.
- **The UI's landing surface is decided by the control plane**, not guessed in the browser: the new
  `setup.status` procedure answers "setup or dashboard". During first run the setup wizard owns the
  whole window instead of sitting behind a tab next to a dashboard, flag queue and review UI that a
  fresh repository cannot populate.
- **An onboarding draft fixes the setup circularity.** Setup's AI-backed steps (IA proposal, theme
  extraction) need an agent transport, which used to be read from a `docstube.yml` that setup had
  not written yet — so the steps designed for first run could not run on a first run. Setup now
  autosaves its in-progress intent to a machine-local, gitignored `.docstube/onboarding-draft.json`,
  and those steps resolve their config from the draft when no config is committed. A browser refresh
  or a crash mid-setup resumes instead of restarting. Committed config always wins over a draft, and
  `status`, `check`, the GitHub Action and the manifest store still read only committed files.
- **Provider selection is real.** Setup detects installed agent CLIs and credential environment
  variable names (never their values). Exactly one viable provider is preselected with its reason
  shown; several stay an explicit choice. A tiny live preflight call proves the credential works, so
  an auth failure surfaces during setup instead of forty minutes into a run. The preflight never
  runs in CI or under the test runner and can be disabled with `DOCSTUBE_SKIP_PREFLIGHT`.
- **Generate is one atomic action.** The final setup step preflights, writes `docstube.yml` +
  `ia.yml`, runs generation and publishes the site in a single call; a failed preflight writes
  nothing at all. Rewriting an existing config still goes through the comment-preserving YAML
  document API, so hand-written comments survive.
