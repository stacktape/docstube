---
"docstube": patch
---

Wave 2b close. GENERATED PAGES CARRY NO `{…}` EXPRESSIONS. The authored-element whitelist walks
elements, but an MDX expression is a single opaque node to the parser, so `{<div>}`, `{<Sneaky/>}`,
`{<>…</>}` and `{<Callout tone={x}/>}` compiled into real elements, fragments and dynamic attributes
that the element, fragment and attribute rules never saw. Rather than deny-list what an expression
may contain, `submit_page` refuses the node kind outright with a repair error — documentation never
needs an embedded expression, and one evaluated at render time can show the reader something the
kernel never checked. Braces inside a code fence or inline code are documentation and stay legal,
and an expression inside a `<Claim>` keeps its own, more precise marker error. The writer prompt
states the rule, so prompt and gate stay in lockstep.

The element policy that whitelist reads is now validated by ONE schema at BOTH ends — when the
kernel builds the tool and when the MCP child rebuilds it from the descriptors file. A malformed
policy degrades to `<Claim>`-only instead of throwing (a non-iterable component list) or silently
widening (a bare string spread into a per-character allow-list). Event-handler names smuggled inside
a string-valued prop are matched by the same case-insensitive shape rule used everywhere else, so
`onError`, `ONERROR` and `OnError` no longer pass where `onerror` was caught.

Run diagnostics are honest about what was observed: HEAD movement is journaled with both revisions
even when the run was already dirty at start, and the unversioned-source warning says the tree
"looked clean" only when `git status` actually reported it clean.
