---
title: "Getting started"
description: "Install docstube, open the setup wizard, and generate your first verified docs site."
---

# Getting started

Install docstube in the repository you want to document, then run the wizard and generate the site from the saved configuration.

1. Install the npm package:

`npm install --save-dev docstube`

For a standalone binary instead of an npm install, use the installer for your platform from `https://installs.docstube.dev/`.

2. Open the local setup wizard:

`npx docstube wizard`

The wizard command starts the local control plane and prints its local URL. It accepts an optional port:

`npx docstube wizard --port 4321`

3. Generate the first docs site:

`npx docstube generate`

`generate` loads the docstube config from the current workspace, runs the configured agent transport, writes generated MDX pages, writes manifest state, and emits the site.

After the first successful run, the default output directory is:

`docs-site/`

The committed manifest state is written under:

`.docstube/manifest/`

That manifest includes `.docstube/manifest/manifest.yml` and page shards under `.docstube/manifest/pages/<locale>/`. The generated site uses the configured output directory; by default that is `docs-site`. When the site is emitted, the CLI prints that directory and the build command:

`npm install && npm run build`

If a run finishes with open flags, the CLI tells you to review them with:

`npx docstube status`

The `generate` command also accepts a per-page retry budget:

`npx docstube generate --max-attempts 3`