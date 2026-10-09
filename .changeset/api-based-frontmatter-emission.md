---
'docstube': patch
---

Wave 2b close. ROUTE FRONTMATTER is now built through the YAML Document API end to end: the authored
block is parsed once, kernel-owned `docstube*` keys are deleted from that document, the
kernel-computed keys are SET on the same document, and it is serialized exactly once. Appending the
computed keys as TEXT to a re-serialized block was a second, incompatible syntax — an authored flow
mapping (`{ title: Docs }`) followed by block lines is not YAML, so an ordinary page emitted a route
Astro could not parse; a flow root is now normalized to block style and both the authored and the
computed keys land in one valid mapping. Frontmatter that uses a construct the kernel cannot vet by
key name — anchors, aliases, merge keys (`<<`), or explicit/unresolved tags, any of which can insert
a `docstubeReviewedFor` the key scan never sees — fails closed with a warning naming the route, like
unparsable frontmatter already did. `locales.targets` rejects the source locale and
duplicate targets, naming the offending value, instead of quietly translating a page into its own
language or paying for the same rendition twice.
