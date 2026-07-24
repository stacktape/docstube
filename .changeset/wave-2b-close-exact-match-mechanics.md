---
'docstube': patch
---

Exact-match checkability mechanics hardened (wave 2b close, final round). Four badge-minting
paths are closed:

1. Backticks are literal content. The cosmetic normalization no longer strips backticks: marker
   visible text is AST-derived rendered text where inline-code formatting already contributed its
   bare content, so a surviving backtick is an escaped literal (`ex\`ists`) and now fails the
   exact match instead of silently collapsing to the canonical assertion. Predicates spell
   identifiers bare.
2. MDX expressions are prohibited inside Claim markers. `<Claim>greet {'never '}exists.</Claim>`
   renders text the kernel's visible-text scan cannot see; submit_page now rejects any marker
   containing an expression node with a precise `marker-expression` repair error, and anchoring
   re-checks it as a kernel invariant post-acceptance.
3. Full value-path subjects. A canonical value assertion's subject must be EXACTLY the rendered
   bound cited-value path — dotted paths as themselves (`retryDefaults.backoff.factor is 2`),
   parameter defaults call-shaped (`createClient(retries) defaults to 3`). The root object alone
   never substitutes for a nested leaf; bare const names are unchanged.
4. `is exported` checks exportedness. Symbol `visibility` is now an affirmative, optional field:
   `public` mints checked, `internal`/`private` CONTRADICTS the claim with outcome-fail grounding
   evidence and a blocking finding, and an absent field leaves exportedness unknowable — the
   claim ships honestly unchecked. Presence-only forms (exists/is defined/is available) are
   unaffected.
