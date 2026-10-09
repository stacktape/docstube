---
title: 'CLI reference'
description: 'Command syntax and flags for the docstube CLI.'
---

# CLI reference

<Claim id="c1">The `docstube` CLI registers subcommands through `main.subCommands`.</Claim> Run `docstube help` when you want the same command list printed by the executable.

## `docstube`

Purpose: <Claim id="c2">Bare `docstube` opens the local control plane.</Claim> <Claim id="c3">Bare `docstube` treats a positional command name as an unknown command.</Claim>

Flags: <Claim id="c4">Bare `docstube --port` sets the local control-plane port.</Claim> <Claim id="c5">Bare `docstube --no-open` disables browser opening.</Claim>

Usage example:

```bash
docstube --no-open
```

## `docstube wizard`

Purpose: <Claim id="c6">`docstube wizard` opens the local setup wizard and control plane.</Claim>

Flags: <Claim id="c7">`docstube wizard --port` sets the local control-plane port.</Claim> <Claim id="c8">`docstube wizard --no-open` disables browser opening.</Claim>

Usage example:

```bash
docstube wizard --port 4242 --no-open
```

## `docstube generate`

Purpose: <Claim id="c9">`docstube generate` generates docs from existing config.</Claim> <Claim id="c10">`docstube generate` is the idempotent reconciler for later runs.</Claim>

Flags: <Claim id="c11">`docstube generate --max-attempts` sets the max write attempts per page.</Claim> <Claim id="c12">`docstube generate --ci` emits the fail-closed publication decision used by the GitHub Action.</Claim> <Claim id="c13">`docstube generate --max-attempts` requires an integer of at least 1.</Claim>

Usage example:

```bash
docstube generate --max-attempts 4
```

## `docstube refine`

Purpose: <Claim id="c14">`docstube refine` improves the lowest-quality generated pages first.</Claim>

Flags and arguments: <Claim id="c15">`docstube refine target` sets the page slug to refine.</Claim> <Claim id="c16">`docstube refine --failed` considers only pages with open flags.</Claim> <Claim id="c17">`docstube refine --max-pages` sets the max pages refined in one run.</Claim> <Claim id="c18">`docstube refine --max-rounds-per-page` sets the max rewrite rounds per page.</Claim> <Claim id="c19">`docstube refine --total-rounds` sets the global rewrite-round budget for the whole run.</Claim> <Claim id="c20">`docstube refine` numeric budget flags require integers of at least 1.</Claim>

Usage example:

```bash
docstube refine cli-reference --failed --max-pages 1
```

## `docstube preview`

Purpose: <Claim id="c21">`docstube preview` builds and serves the generated docs site locally.</Claim>

Flags: <Claim id="c22">`docstube preview --port` sets the local preview server port.</Claim> <Claim id="c23">`docstube preview --build` forces a rebuild.</Claim> <Claim id="c24">`docstube preview --port` requires an integer from 0 through 65535.</Claim>

Usage example:

```bash
docstube preview --build --port 4173
```

## `docstube audit`

Purpose: <Claim id="c25">`docstube audit` extracts claims from an existing docs site and verifies them against the codebase.</Claim>

Flags and arguments: <Claim id="c26">`docstube audit docs-dir` is required.</Claim> <Claim id="c27">`docstube audit --json` emits the audit report as JSON.</Claim>

Usage example:

```bash
docstube audit docs --json
```

## `docstube answer`

Purpose: <Claim id="c28">`docstube answer` lists and answers open maintainer questions.</Claim>

Arguments: <Claim id="c29">`docstube answer id` selects a question id.</Claim> <Claim id="c30">`docstube answer text` supplies the answer text.</Claim>

Usage example:

```bash
docstube answer fl_12345678 "The retry limit mirrors the upstream API limit."
```

## `docstube validate`

Purpose: <Claim id="c31">`docstube validate` validates the docstube config family.</Claim>

Usage example:

```bash
docstube validate
```

## `docstube check`

Purpose: <Claim id="c32">`docstube check` runs deterministic checks over the generated docs.</Claim>

Flags and arguments: <Claim id="c33">`docstube check kind` selects a verifier id.</Claim> <Claim id="c34">`docstube check --list` lists registered checks.</Claim>

Usage example:

```bash
docstube check --list
```

## `docstube status`

Purpose: <Claim id="c35">`docstube status` shows manifest, claim counts, and open flags.</Claim>

Usage example:

```bash
docstube status
```

## `docstube doctor`

Purpose: <Claim id="c36">`docstube doctor` checks local runtime and project setup.</Claim>

Flags: <Claim id="c37">`docstube doctor --ci` runs the CI preflight.</Claim> <Claim id="c38">`docstube doctor --json` emits the versioned preflight report as JSON.</Claim>

Usage example:

```bash
docstube doctor --ci --json
```

## `docstube plugin`

Purpose: <Claim id="c39">`docstube plugin` scaffolds and manages docstube plugins.</Claim>

Arguments: <Claim id="c40">`docstube plugin action` is required.</Claim> <Claim id="c41">`docstube plugin name` supplies the plugin name.</Claim>

Usage example:

```bash
docstube plugin scaffold wordcount
```

## `docstube upgrade`

Purpose: <Claim id="c42">`docstube upgrade` upgrades the docstube tool itself.</Claim>

Flags: <Claim id="c43">`docstube upgrade --check` only checks the current version.</Claim> <Claim id="c44">`docstube upgrade --to` sets the target version.</Claim>

Usage example:

```bash
docstube upgrade --check
```

## `docstube version`

Purpose: <Claim id="c45">`docstube version` prints the docstube version.</Claim>

Usage example:

```bash
docstube version
```

## `docstube help`

Purpose: <Claim id="c46">`docstube help` prints command help.</Claim>

Arguments: <Claim id="c47">`docstube help command` selects a command to describe.</Claim>

Usage example:

```bash
docstube help generate
```
