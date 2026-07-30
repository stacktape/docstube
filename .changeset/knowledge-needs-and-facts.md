---
'docstube': patch
---

Tribal knowledge gets durable semantic identity: the question-text-hash store is replaced by
committed **KnowledgeNeed + KnowledgeFact** records (PRODUCT §3.10, dx-knowledge-v2 decision 6).

The store that shipped keyed every answer by a hash of the model's PHRASING and deduped questions
by global text similarity. Four traced consequences, all fixed here:

- **Identity is the subject, not the wording.** The dedup key is now subject (entity thread /
  symbol / topic) + kind-of-missing-fact slot. Two different symbols producing near-identical
  questions both survive; an unresolvable subject dedups only within its requesting page. Text
  similarity now only decides whether a rewording is the SAME gap about the SAME subject (ask
  once) or a different one (its own discriminated slot) — and never suppresses a need across
  subjects. Cross-subject similarity is surfaced as a queue *suggestion*; merges are explicit.
- **A paraphrase of an answered question can no longer suppress a genuinely new question.**
- **Answers are additive.** Re-answering supersedes: the previous fact is retained with its own
  author and timestamp, the new fact records `supersedes`, and answers carry real attribution
  (the answering surface plus the repository's git identity) and the answer-time revision
  fingerprint.
- **Answers go stale.** A fact binds to its subject through the material facets of the typed
  fingerprint ladder (signature, cited values, declared schema shape — never the body). A cosmetic
  refactor rebinds silently with no re-ask; a material change flips the fact to
  `needs-revalidation`, flags exactly the pages citing it, and reopens the need for one targeted
  re-ask.

Answering also propagates: a fact moves `answered → propagation-pending → applied`, and exactly
the pages that consumed it (or asked the question) are marked dirty and regenerate — consuming the
`dependencies.consumed` records provenance already writes. `docstube answer` now reports how many
pages will regenerate.

Committed knowledge lives at `.docstube/knowledge/needs/<needId>.json` and
`.docstube/knowledge/facts/<factId>.json` as canonical JSON — a public data format. Unreadable
records fail closed like the manifest store; pre-existing `.md` answer files are treated as absent
and named in a warning (they record no subject, author, or revision, so converting them would
fabricate provenance). CLI and local-UI answering keep working throughout, including for flags
raised before needs existed.
