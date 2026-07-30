---
'docstube': patch
---

The CLI no longer fails after a successful command.

- `docstube generate` used to run the whole pipeline, publish the site, report `passed`, and then
  print `Unknown command: generate`, dump the help text and exit 1. Every subcommand was affected
  (`generate`, `status`, `validate`, `version`, `help`, `check`, `answer`, `refine`, …), so in CI a
  successful documentation run still failed the workflow and the GitHub Action's own
  success/failure handling never got a chance to run.
- Cause: the root command carried both a subcommand registry and its own `run` handler. citty runs
  a parent's `run` in addition to the matched subcommand, so the root handler fired after every
  command and judged the command's own name — `generate` — as an unknown command. Bare `docstube`
  is now declared as the default subcommand instead of a root handler, so nothing runs after a
  subcommand.
- Bare `docstube` still opens the local control plane, `--port` and `--no-open` still work without a
  command, and a typo such as `docstube generatee` still reports an unknown command with usage and
  exits 1. A command name inherited from `Object.prototype`, such as `docstube constructor`, is now
  rejected as a typo instead of being looked up as a command.
- CLI dispatch is now covered end to end: the tests spawn the real binary with real argv and assert
  the process exit code for the bare invocation, every registered subcommand, subcommand
  positionals, the flag-only forms, and unknown commands.
