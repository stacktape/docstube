---
'docstube': patch
---

Wave 2b close. FRONTMATTER SPLITTING now accepts every block Astro accepts. A UTF-8 BOM before the
opening `---`, blank lines above it, or an empty block (`---\n---`) used to be missed entirely, and a
missed block is not a harmless no-op: its raw YAML was emitted as page BODY, so the author's keys
turned into visible junk on the rendered page and any `docstube*` key among them was never vetted.
A document that genuinely opens with something else is still untouched, so a `---` thematic break in
the body is never mistaken for a delimiter. Comment migration off deleted `docstube*` keys is gone:
such a comment is now dropped with the pair it was written above (the YAML document's own behavior).
Migrating it was cosmetic and produced a spurious `#null` comment, reversed the order of existing
trailing comments, and silently skipped complex keys. Emit warnings printed by `docstube generate`,
`docstube refine`, and the wizard are labelled `emit-warning` instead of `unverified`: the channel
carries dropped authored frontmatter and ignored stale locale files as well as MDX↔shard binding
failures, and a dropped frontmatter block leaves the page's proof exactly as verified as it was.
