---
'docstube': minor
---

Authored MDX may no longer carry import/export statements or markup inside a component prop, and
run diagnostics stop describing git states that were never observed.

- **No ESM statements in a generated page.** MDX has a third executable node kind besides elements
  and `{…}` expressions: `import`/`export`. `export default function Evil() { return <script>…</script> }`
  produced no element and no expression node, so it passed the submission gate and MDX compiled it
  into the page's own rendered wrapper. Generated documentation never needs an import or an export —
  the theme owns components and the site build provides the layout — so the whole node kind is now
  rejected with a repair error. An import shown in a code fence is documentation and stays fine.
- **Component props carry plain text, not markup.** Detecting executable payloads inside a prop
  value meant regexing HTML, which cannot be made tokenizer-safe: `<img title='>' ONERROR=alert(1)>`
  ends the tag early for any `[^>]*` pattern while a browser keeps parsing attributes, and
  `<img/onError=…>` needs no whitespace before the handler. A string-valued attribute whose value
  contains a tag-open shape — `<` immediately followed by a letter or `/` — is now rejected
  outright. A `<` followed by a space, digit, or `=` is an ordinary less-than sign and stays legal
  (`latency < 5ms`), and markup you want to show belongs in a code fence. The existing
  script/style, event-handler, and `dt-`/`data-docstube*` namespace checks remain as defense in
  depth.
- **Run diagnostics say only what git actually reported.** A missing HEAD or an unreadable
  `git status` used to arrive at the warning as the same value an observed dirty tree does, so the
  run log claimed `git status` reported the tree dirty when porcelain never ran. Unknown state now
  has its own wording (the trust behavior is unchanged — an unknown state still marks the run), and
  the actionable path samples are kept in every case.
- A HEAD that moves during a run that was **already dirty at start** no longer reuses the
  clean-tree sentence; that branch names both revisions with wording that matches what happened.
