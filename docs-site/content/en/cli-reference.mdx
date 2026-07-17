---
title: "CLI reference"
description: "Command reference for the docstube CLI."
---

# CLI reference

Use `docstube help [command]` to print command usage.

```bash
docstube help generate
```

## `wizard`

Opens the local setup wizard and control plane. The `--port <n>` flag sets the local control-plane port; without it, the server chooses a port.

```bash
docstube wizard --port 3001
```

## `generate`

Generates docs from the existing config. The `--max-attempts <n>` flag sets the maximum write attempts per page for that run.

```bash
docstube generate --max-attempts 3
```

## `refresh`

Regenerates only entities affected by code changes. The `--max-attempts <n>` flag sets the maximum write attempts per page for that run.

```bash
docstube refresh --max-attempts 2
```

## `refine`

Improves generated pages. Pass a page slug to target one page, or use `--failed` to consider only pages with open flags.

Budget flags:

- `--max-pages <n>` limits how many pages are refined.
- `--max-rounds-per-page <n>` limits rewrite rounds for each page.
- `--total-rounds <n>` sets a global rewrite-round budget for the run.

```bash
docstube refine cli-reference --failed --max-pages 1 --max-rounds-per-page 2 --total-rounds 2
```

## `audit`

Measures verified defects in an existing docs directory. The required `<docs-dir>` argument points at Markdown or MDX docs. The `--json` flag emits the report as JSON.

```bash
docstube audit docs --json
```

## `answer`

Lists open maintainer questions, or records an answer for one question id. When answering, pass the id and the answer text.

```bash
docstube answer
```

```bash
docstube answer abc12345 "This behavior is intentional because the parser owns command shape."
```

## `check`

Runs deterministic checks over generated docs. Check kinds come from registered verifier plugins, so use `--list` to see the checks available in the current project. Passing `[kind]` runs only that verifier.

```bash
docstube check --list
```

```bash
docstube check claim-grounding
```

## `status`

Shows the generated manifest state, page guarantee levels, provable-block distribution, and open flag count.

```bash
docstube status
```

## `doctor`

Checks local runtime and project setup. It checks Node, Git, project detection, config loading, and the configured agent runtime for the project.

```bash
docstube doctor
```

## `plugin scaffold`

Scaffolds a docstube plugin under `plugins/`, writes a matching spec file, and materializes the plugin-authoring skill under `.docstube/skills/plugin-authoring/SKILL.md`.

```bash
docstube plugin scaffold wordcount
```

## `validate`

Validates the docstube config family and reports the loaded doc type, persona count, IA top-level node count, and glossary term count.

```bash
docstube validate
```

## `upgrade`

Upgrades the docstube tool itself. Use `--check` to compare the current version with the target version without installing. Use `--to <version>` to target a specific version; otherwise the command targets the latest version it resolves.

```bash
docstube upgrade --check
```

```bash
docstube upgrade --to 0.0.3
```

## `version`

Prints the docstube version.

```bash
docstube version
```

## `help`

Prints the command overview or command-specific help.

```bash
docstube help refine
```