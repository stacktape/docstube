---
'docstube': patch
---

`docstube help` is now rendered from the command registry instead of a hand-maintained copy of it.
Help had two sources: citty derived `docstube --help` and the unknown-command usage dump from the
registered commands, while `docstube help` printed a separate list written by hand. That list had
already drifted once, documenting `--fresh` flags the CLI never had.

There is now one renderer. `docstube help`, `docstube --help`, `docstube help <command>`,
`docstube <command> --help`, and the usage printed when a command is misspelled all render from the
same registry, so a command cannot be listed but unregistered or registered but unlisted, and every
command description lives only on its own definition.

User-visible consequences:

- The overview and per-command help use citty's layout. Per-command help now lists that command's
  actual arguments and options with their descriptions, and the overview documents `--port` and
  `--no-open` on the bare invocation, which the hand-written text never did.
- `docstube help <unknown>` now exits 1 with `Unknown command <name>`, matching what
  `docstube <unknown>` already did, instead of exiting 0.
- `docstube preview` is reported as `preview` in runtime telemetry. The allowlist of command names
  telemetry accepts was a second hand-maintained copy of the command list and had gone stale, so
  every `preview` run was being recorded as `unknown`.
