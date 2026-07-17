---
'docstube': minor
---

New `docstube preview` command: builds the generated site only when its content changed (npm
handled automatically, including first-time dependency install) and serves it on localhost with a
built-in static server — no manual `npm install && npm run build && npm run preview` inside the
outDir. Opens the browser; `--port` pins a port, `--build` forces a rebuild.
