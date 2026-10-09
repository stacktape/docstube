---
'docstube': patch
---

Wave 2b close. The COVERAGE LINTER now runs its two halves at two explicitly different scopes: the
IDENTIFIER SIGNAL scan reads the whole block INCLUDING `<Claim>` subtrees (an identifier the reader
only meets inside a marker still means the block names code), while SENTENCE FLAGGING reads the
block MINUS those subtrees (covered prose is already claimed). Skipping marker subtrees for both
threw the identifier away with the covered text, so `<Claim>…\`retry\`…</Claim> It always returns 2.`
reported nothing at all; the uncovered continuation is now flagged and the covered text is still
never reported. KERNEL-OWNED FRONTMATTER is stripped by PARSING the authored block with the YAML
Document API instead of matching lines: ownership is decided on the resolved key, case-insensitively,
so quoted (`"docstubeReviewedFor"`), explicit (`? docstubeReviewedFor`), indented, and mixed-case
spellings can no longer smuggle a false editorial trust label onto an unreviewed page. Authored keys
keep their comments, quoting, and block style; frontmatter that cannot be parsed as a mapping fails
closed — the page renders with kernel-computed frontmatter only and the route is named in a warning.
LOCALE ROUTE PREFIXES are compared case-insensitively, so slug `pt-br/foo`with locale`pt-BR` is
rejected at planning instead of aliasing on case-insensitive Windows/macOS filesystems.
