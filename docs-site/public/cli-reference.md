---
title: "CLI reference"
description: "Command reference for the docstube CLI, including generation, refresh, verification, status, plugin, and upgrade commands."
---

# CLI reference

The CLI command surface includes `wizard`, `generate`, `refresh`, `refine`, `audit`, `answer`, `validate`, `check`, `status`, `doctor`, `plugin`, `upgrade`, `version`, and `help`.

## `wizard`

Opens the local setup wizard and control plane.

Key flag:

- `--port <n>` sets the local control-plane port. The parser accepts integers from `0` through `65535`.

```bash
docstube wizard --port 4317
```

## `generate`

Generates docs from the existing config, then emits the site to the configured output directory.

Key flag:

- `--max-attempts <n>` sets the maximum write attempts per page. The parser requires a positive integer.

```bash
docstube generate --max-attempts 3
```

## `refresh`

Regenerates entities affected by code changes since the committed manifest, then emits the site to the configured output directory.

Key flag:

- `--max-attempts <n>` sets the maximum write attempts per page. The parser requires a positive integer.

```bash
docstube refresh --max-attempts 2
```

## `refine`

Improves generated pages by running rewrite rounds through the configured task runner.

Key arguments and flags:

- `[page]` targets one page slug.
- `--failed` limits selection to pages with open flags.
- `--max-pages <n>` limits how many pages are refined in the run.
- `--max-rounds-per-page <n>` limits rewrite rounds for each selected page.
- `--total-rounds <n>` sets a global rewrite-round budget for the run.

Each refine budget flag must be a positive integer.

```bash
docstube refine getting-started --failed --max-pages 1 --max-rounds-per-page 2 --total-rounds 2
```

## `audit`

Audits an existing docs directory by extracting claims and verifying them against the codebase. The command exits with code `1` when the report contains verified defects.

Key argument and flag:

- `<docs-dir>` is the docs directory to audit.
- `--json` prints the audit report as formatted JSON.

```bash
docstube audit docs --json
```

## `answer`

Lists open maintainer questions or answers one question by ID prefix. When an answer is accepted, the command writes it into `.docstube/knowledge/` for future runs.

Arguments:

- `<id>` is an open question ID prefix from `docstube answer`.
- `"your answer"` is the answer text.

```bash
docstube answer
```

```bash
docstube answer abc12345 "This behavior is intentionally kept for compatibility."
```

## `validate`

Validates the docstube config family and reports the loaded doc type, persona count, top-level IA node count, and glossary term count.

```bash
docstube validate
```

## `check`

Runs deterministic checks over generated docs. Check kinds are not a fixed CLI enum: the command builds a plugin host, registers built-in plugins, loads configured plugins, and derives available verifier IDs from that host.

Key argument and flag:

- `[kind]` runs only one verifier ID.
- `--list` prints the verifier IDs registered for the project.

```bash
docstube check --list
```

```bash
docstube check claim-grounding
```

## `status`

Shows the current docs version, locales, pages, per-page guarantee status, flag counts, and aggregate guarantee counts. If no manifest exists yet, it prints a message telling the user to run generation first.

```bash
docstube status
```

## `doctor`

Checks local runtime and project setup. The command checks Node version, Git availability, project detection, config-family loading, and the configured agent transport requirements.

```bash
docstube doctor
```

## `plugin scaffold`

Scaffolds a plugin source file and test file under `plugins/`, then materializes the `plugin-authoring` skill under `.docstube/skills/`.

Argument:

- `<name>` is normalized to lowercase, strips a leading `docstube-plugin-`, replaces non-alphanumeric separators with `-`, and is used for `plugins/<name>.ts` and `plugins/<name>.spec.ts`.

```bash
docstube plugin scaffold linkstats
```

## `upgrade`

Upgrades the docstube tool or reports upgrade instructions for install sources that the command should not modify directly.

Key flags:

- `--check` prints the current version, latest or target version, and whether an upgrade is available.
- `--to <version>` selects a target version instead of the fetched latest version.

```bash
docstube upgrade --check
```

```bash
docstube upgrade --to 0.0.3
```

## `version`

Prints the CLI version.

```bash
docstube version
```

## `help`

Prints the command overview or command-specific help.

```bash
docstube help refine
```