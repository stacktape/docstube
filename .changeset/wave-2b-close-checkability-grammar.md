---
'docstube': patch
---

Fail-closed checkability via EXACT CANONICAL VISIBLE MATCH (wave 2b close, final). Existence and
value evidence (codemap grounding, the value-predicate comparison) now decide a claim's
correctness ONLY when the marker's VISIBLE text — after minimal cosmetic normalization (backticks
stripped, whitespace collapsed, one optional trailing period, Unicode NFC) — EXACTLY matches one
canonical assertion parameterized by the kernel-bound subject (and, for value claims, the bound
normalized citedValue), with the predicate stating the SAME assertion. Grammar (0.1.0):
"X exists" | "X is defined" | "X is available" | "X is exported" for existence (the never-verified
"exported from <module>" variant is removed until a codemap-verified module binding exists), and
"X is|equals|defaults to|is set to <value>" for value claims. The previous ±5-token visible
window, the neutral-vocabulary allowlist, the denial-word screen, and the ASCII tokenizer are all
deleted: ANY other word in the visible span — "returns", "absent", non-Latin prose, a distant
clause — fails the exact match, so the claim ships honestly UNCHECKED with a journaled note.
Nothing is enumerated, so there is no vocabulary arms race left to lose. The polarity/negation
fast paths remain only as earlier, better-messaged repair errors (no longer load-bearing). The
writer prompt now teaches that markers for checkable claims wrap ONLY the canonical assertion,
with surrounding prose outside the marker. Documented cost: wordy-but-true positives ("`greet`,
added in v2, exists") ship unchecked until the marker is tightened.
