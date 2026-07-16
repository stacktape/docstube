---
'docstube': minor
'@docstube/plugin-sdk': minor
---

Ground-up v1 rewrite on the entity-model architecture (see ARCHITECTURE.md): unified entity model
(page/section/block/claim with stable IDs, guarantee levels, symbol-hash provenance), sharded
committed manifest, plugin kernel with the new public `@docstube/plugin-sdk` (verifiers, language
packs, content sources, importers, deploy targets, search providers, components), and a
docstube-owned agent harness — one loop and tool surface with observed-reads provenance; vendor
CLIs (claude, codex, gemini) act as raw model+billing transports.

The pipeline now runs write → per-persona review (explainable criteria) → deterministic verify →
gate with bounded retries, ships verified translations for declared locales (same entity IDs
across locales), regenerates only affected entities on `refresh` (provenance-driven symbol-hash
diff + topology pass), and cuts frozen version snapshots. Eight built-in verifiers ship as
plugins: mdx-compile, internal-links, code-typecheck-ts, entity-integrity, snippet-exec,
shellcheck, sample-parses, prose-lints, and diagram-d2 (D2 diagrams compile AND every node must
ground in a codemap symbol — `loose` fences downgrade to warnings for conceptual diagrams).

CLI: `generate`, `refresh`, `audit <docs-dir>` (verified-defects-per-100-claims report on any
docs directory), `check` (kinds derive from registered verifier plugins), `status`, `doctor`
(deterministic project detection), `validate`, `wizard` (local control plane: generation
dashboard + flag queue), `plugin scaffold <name>` (working starter plugin + the plugin-authoring
skill), `upgrade`. `refine` reworks the lowest-quality pages first (open flags, then lowest proven ratio). Tribal-knowledge
capture ships: the writer asks unanswerable "why" questions through a harness tool (`flag_question`),
each question becomes exactly one non-blocking flag, human answers are committed to
`.docstube/knowledge/` and injected into every future writer prompt. The GitHub
Action opens auto-merging PRs gated on the hardcoded flag rules, comments open flags on the PR,
and rolls tribal-knowledge questions into a digest issue.

Wave 4: task-specific tools now cross the vendor-CLI process boundary (record-style MCP
forwarding with parent-side replay), so tribal-knowledge capture works on every transport.
Generated pages carry extracted, codemap-grounded claims (grounded → proven, stale reference →
gated retry). The emitted site gains multi-locale routing with hreflang + locale switcher, a
version dropdown for frozen labels, Pagefind search, a self-contained docs MCP server
(read_wiki_structure / read_wiki_contents / ask_question), and visible provenance: a Sources
footer (linkified via the git remote) plus per-section guarantee chips.

Wave 5: `docstube answer` closes the tribal-knowledge loop from the terminal; Python ships as the
second language pack (AST-based, API-shape hashing); runs freeze with margin at
`agents.budgets.maxRunUsd` and report spend; the local control plane gains the full write surface
(answer/dismiss flags, categorized feedback intake, comment-preserving config/IA editing,
first-run scaffolding, AI IA proposals, theme-token extraction, run launching); refine gets
`--max-pages`/`--max-rounds-per-page`/`--total-rounds`. The codex transport is live-verified
end-to-end on a ChatGPT subscription.
