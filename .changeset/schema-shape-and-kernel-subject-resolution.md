---
"docstube": patch
---

Three gaps between what docstube can prove and what it actually decides are closed, and the
measured checked ratio over the dogfood corpus goes from 29/341 (8.5%) to a projected 81/341
(23.8%) — 63/115 code-structure and 18/54 value; behavior claims stay unchecked by design.

KERNEL SUBJECT RESOLUTION. A canonically phrased claim ("`loadConfigFamily` exists.") carries
everything needed to check it, but shipped unchecked because the WRITER never proposed a symbol
hash — a repo of 1200+ symbols only ever shows it a slice, so the claim fell back to a whole-file
subscription and no grounding symbol ever reached verification. The kernel now reads the subject
out of the claim's own assertion, looks it up in the codemap by display name, and subscribes the
claim to that symbol when the name resolves to EXACTLY ONE record. Ambiguity is never guessed, and
every existing guard (subject binding on both sides, the checkability grammar, the fingerprint
snapshot) still gates the verdict.

SCHEMA SHAPE IS NOW A CHECKABLE FACT. Config and API reference pages are mostly claims about a
declared schema's fields, and nothing extracted shape: the value ladder only reads plain object
literals, so every `z.object({...})` was opaque. The TypeScript pack now reads field names,
optionality, and literal defaults statically from the AST — never by evaluating code — and a new
`schemaShapePrint` facet lets verification prove its re-extraction against the run's snapshot. Four
canonical grammar forms decide such claims through `schema-check` evidence:
`<schema> requires|accepts|defines|records|stores <field>`,
`<schema> defaults <field> to <value>`, and `<schema>.<field> defaults to <value>`. A field the
docs say is required but a caller may omit, or a default the declaration disagrees with, is
CONTRADICTED. Fail-closed throughout: an unrecognized factory, a computed field list, a
shape-altering combinator (`.extend`, `.merge`, `.partial`), a non-literal default, or a field name
that does not resolve to exactly one field all leave the claim unchecked — absence is never
reported as a lie, because static extraction cannot prove a field set is exhaustive.

QUOTED-KEY VALUE PATHS. Cited-value extraction has always emitted paths for quoted object keys and
enum members, and those keys routinely contain hyphens (`defaultModels.claude-cli`). The path
grammar only accepted identifier characters, so it refused the whole assertion and the fact was
extractable and citable but unspellable. A path segment now admits internal hyphens; leading,
trailing, doubled, and whitespace-separated forms still fail closed.
