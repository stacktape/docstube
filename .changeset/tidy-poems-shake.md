---
'docstube': patch
---

Claim grounding now asks the codemap whether a symbol exists, not the fingerprint snapshot.

The fingerprint ladder exists for invalidation — knowing when to re-check — but anchoring was
using presence in the snapshot as an existence test. Because `extractFingerprints` is an additive
capability on top of the public plugin-sdk pack contract (which requires only `extractSymbols`), a
language pack can legitimately contribute every one of its symbols to the codemap and none to the
snapshot; every claim referencing one was rejected as a hallucinated identifier and escalated to a
hard defect on correct prose. Existence is now decided by the codemap, and a real symbol without
typed prints is reported as a missing facet, which keeps its conservative whole-file dependency.

The fingerprint snapshot also now records a whole-file content hash for the files packs *did*
fingerprint, not only the fallback files. A claim whose dependency is a normal source file
("the fact came from `packages/skills/src/skills.ts`") is no longer rejected as an unknown file
just because that file parsed cleanly and the page happened not to read it.

Finally, a code-dependent claim with no derivable dependency now degrades to unchecked instead of
failing the page, matching how an unbound subject already behaves: the kernel refuses to vouch,
never to publish.
