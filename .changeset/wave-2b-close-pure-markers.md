---
'docstube': patch
---

Render laundering closed (wave 2b close, final): checkable markers are pure text + inline code.
A claim can be canonically checkable only when its marker's AST content consists EXCLUSIVELY of
`text` and `inlineCode` nodes — the only node kinds whose rendered output provably equals the
scanned text. Fail-closed by structure, no enumeration:

1. JSX elements inside Claim markers are rejected outright at submit_page (new `marker-jsx`
   repair error; a kernel-invariant breach post-acceptance): a component renders arbitrary
   content — `<Badge label="greet does not exist.">greet exists.</Badge>` scans as its children
   but renders the contradicting prop text.
2. Every other non-pure node (images, links, footnote references, emphasis/strong, html, breaks —
   any node kind, known or not) stays legal MDX but makes the claim permanently unchecked: the
   scanner records a `pureText` flag, and the checkability grammar refuses non-pure markers
   before any canonical matching, so existence/value evidence is never minted for prose the
   reader may not actually see (image alt text, footnote superscripts). Journaled note, never a
   repair spiral.
3. The writer prompt teaches the rule: checkable markers contain only plain prose and backticked
   identifiers — no components, images, links, or formatting inside a checkable marker.
