---
'docstube': minor
---

Authored MDX is restricted to registered components with plain-literal props, and a run whose HEAD
moves mid-run is no longer labeled with the wrong revision.

- **Only registered components may appear as elements in a generated page.** The submission gate
  used to scan page source for prohibited patterns; a deny-list over arbitrary source text cannot
  be won, so the rule is now structural and fail-closed: an element is accepted only when its name
  is in the project's enabled component registry (`components:` in `docstube.yml`), plus the inline
  `<Claim>` marker. Raw HTML elements (`<div>`, `<span>`, `<img>`, …), JSX fragments, and
  unregistered components are rejected with a repair error explaining that the theme owns
  presentation. Plain Markdown is unaffected, and a fenced code block showing HTML is still
  documentation. A project that enables no components can author no elements at all.
- **Component props must be plain string literals.** `{...spreads}` and expression-valued
  attributes (`prop={…}`) are rejected, so every attribute name and value is readable directly from
  the document — which is what closes the uppercase (`ONERROR`, `CLASS`), quoted-`>`, and
  expression-wrapped spellings that previously slipped past. Event-handler props and docstube's own
  `dt-` / `data-docstube*` presentation namespace remain rejected as before.
- The writer prompt states these rules, so a page is never asked for something the gate refuses,
  and vendor-CLI transports validate identically in-session.
- **HEAD stability:** a commit landing mid-run leaves the working tree clean, so the end-of-run
  check never noticed it and evidence could be labeled with a revision that did not contain the
  checked bytes. `generate`, `maintain`, and `refine` now record HEAD at run start, re-read it at
  the end, and mark the run (no complete state, plus a warning naming both revisions) when it moved.
- Untracked/ignored source-file warnings now always name example paths instead of degrading to a
  generic "the working tree is dirty" line when git status had already reported dirt.
