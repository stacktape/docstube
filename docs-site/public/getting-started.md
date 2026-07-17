---
title: "Getting started"
description: "Install docstube, open the setup wizard, and generate the first documentation site."
---

# Getting started

The npm package is named `docstube` and exposes a `docstube` binary. For projects that already use Node tooling, the first-run path can be run through `npx`:

```text
npx docstube wizard
npx docstube generate
npx docstube status
```

For a standalone binary, use the install scripts hosted at `installs.docstube.dev`. The project README names `https://installs.docstube.dev/linux.sh` for Linux and `https://installs.docstube.dev/windows.ps1` for Windows. After installing the standalone binary, use the same commands without the `npx` prefix.

## Open the wizard

`docstube wizard` starts the local control plane. The command accepts an optional port:

```text
npx docstube wizard --port 4317
```

When the server starts, the CLI prints:

```text
docstube control plane running at:

  <local URL>

Press Ctrl+C to stop.
```

Open the printed URL. The local UI includes a Wizard tab. On a first run, the wizard uses scaffold mode; its final step writes the config family and starts a `generate` run.

## Generate the site

If you start generation from the terminal, run:

```text
npx docstube generate
```

The `generate` command loads the config, creates the task runner from that config, and runs the documentation pipeline. During the run, it prints one line per generated page or translation, using `ok` for passed output and `FLAG` for output with open flags.

The generated site is emitted to the configured `outDir`. The config schema defaults that directory to:

```text
docs-site/
```

After emission, the CLI prints the site directory and the build hint:

```text
site emitted to docs-site/ — build it with: npm install && npm run build
```

docstube also writes verified run state under:

```text
.docstube/manifest/
```

That manifest directory contains `manifest.yml` and page shard files under `pages/<locale>/`.

## Check the result

Run status after the first generation:

```text
npx docstube status
```

When a manifest exists, `status` reports the docs version, locales, page count, each page guarantee state, and the open flag count. If no manifest exists yet, it prints:

```text
No manifest yet — run `docstube generate` first.
```