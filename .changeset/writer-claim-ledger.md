---
'docstube': minor
---

The writer now authors claims inline (wave 2b-i of the claim-ledger redesign): pages carry
`<Claim id>` markers plus a writer claim ledger, delivered in one `submit_page` tool call with
in-session repair errors. The kernel anchors markers to blocks, mints claim/evidence ids, and
resolves dependency subscriptions against the typed fingerprint snapshot; the post-hoc claim
extraction call is removed from the generate path (it remains inside `docstube audit` for
foreign docs).
