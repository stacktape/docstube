---
'docstube': minor
---

Multi-theme foundation: `theme.name` in docstube.yml selects a built-in theme (default `basic`,
always written explicitly by the wizard). Themes are authored as real source directories and
shipped as compiled bundles; the kernel now owns astro.config.mjs and package.json (generated from
invariants plus the theme's typed build hooks, with dependency-conflict detection), emits the
mandatory proof primitives (guarantee badge, section chips, sources footer, entity wrapper with
stable `data-docstube-*` attributes) under `src/docstube/`, and records theme-owned files in
`.docstube/theme-files.json` so switching themes deletes stale unmodified files while preserving
and reporting user-modified ones. Four semantic tokens (`accent`, `accentDark`, `fontBody`,
`fontCode`) are honored by every theme.
