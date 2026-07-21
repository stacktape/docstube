---
'docstube': patch
---

Claim-ledger hardening (wave 2b-i gate fixes): `submit_page` is validated INSIDE the vendor MCP
child, so Claude/Codex session transports get real repair errors in-session instead of a blind
"recorded" ack; claim markers are now collected from the MDX AST — literal `<Claim>` examples in
code stay text, flow/heading/expression placements get precise repair errors, and the inline
marker no longer changes its owning block's type (`component:Claim` is gone); regeneration
matches claim identity (same block thread + same class + same quote/predicate reuses the previous
claim id) while every other field — trust state included — is rebuilt from the current ledger and
the legacy bridge replaces, never preserves, old per-block claims; anchoring is fail-closed with
typed errors (an unanchorable claim fails the page attempt into writer repair rather than
shrinking the ledger, and post-acceptance scan drift is a kernel error); code-dependent claims
always end anchoring with a resolved subscription or a kernel-derived whole-file fallback, with
dropped proposals recorded as rejected-proposal warnings; source-linked evidence locations come
from the codemap, never from writer output; the submit_page tool descriptor now carries the full
writer-ledger JSON Schema and the writer prompt teaches atomic markers, forbidden placements,
predicate/prose agreement, per-class examples, and the file-content fallback; the legacy bridge
throws on a contradicted claim instead of projecting it as neutral scored content.
