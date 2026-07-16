---
title: "How verification works"
description: "How docstube assigns guarantee levels, runs built-in verifier checks, grounds claims, retries failed drafts, and keeps unresolved risk visible as flags."
---

# How verification works

docstube stores verification state on entities. Pages, sections, blocks, and claims all carry one guarantee level: `proven`, `scored`, or `out-of-domain`.

`proven` is computed from deterministic verifier coverage. `scored` means the entity has not been mechanically proven. `out-of-domain` is the contract value for declared-unprovable material such as tribal knowledge or intent. Parent guarantees roll up pessimistically from children, and an empty rollup returns `out-of-domain`.

Freshly extracted pages, sections, and blocks start as `scored`. Verifier results can upgrade covered entities to `proven`; claim grounding can attach `proven` or `scored` claims.

## Pipeline

1. Build the codemap

   `runGenerate` builds a codemap for the current commit with registered language packs. `buildCodemap` walks matching files, calls each pack, validates each symbol record, and sorts symbols by file, span, and hash.

2. Write a page

   `generatePage` creates a write task for one IA node. If a retry is needed, the previous attempt's findings are included in the next writer prompt.

3. Extract entities

   The generated MDX is parsed into a page entity tree. Code fences become `code-example` blocks. MDX flow components become `component:<Name>` blocks. Import and export statements are ignored as page plumbing.

4. Run deterministic verifiers

   `runVerifiers` runs registered verifiers that apply to the page artifact. Source-only verifiers run only for the configured source locale. Per-locale verifiers run for every locale artifact.

5. Run persona review

   `reviewPage` runs one review task per configured persona. Review findings with severity `error` gate the draft, but review does not assign `proven`.

6. Ground claims

   On a draft with no verifier or review errors, `attachExtractedClaims` extracts checkable claims and matches identifier-shaped references against the codemap. Grounded claims become `proven`; claims with no checkable identifiers become `scored`; stale references emit `claim-grounding` errors.

7. Gate and retry

   `generatePage` retries while error findings remain. The default page retry budget is three attempts. If errors remain after the budget, the page shard is written with an open `system` flag.

After source pages are generated, `runGenerate` also runs site-scope verification across the generated artifact set. Site-scope errors are returned as `siteFindings` and make the run outcome `flagged`.

## Guarantee Assignment

Verifier definitions include `proves: boolean`.

`assignGuarantees` upgrades an entity to `proven` only when the verifier has `proves: true`, the verifier result is `pass`, and the entity id appears in `coveredEntityIds`.

A passing verifier does not override a failing verifier. If any error finding names an entity, that entity is removed from the proven set.

Claims have an additional grounding path. `matchClaim` normalizes identifier-shaped references, ignores ambient runtime identifiers such as `Promise`, `JSON`, and `console`, and checks symbol names, container segments, and dotted container-tail paths in the codemap. A claim is a stale-reference defect only when every checkable identifier fails to ground.

## Built-In Verifiers

The built-in verifier plugin is `@docstube/verifiers`. It registers these verifier ids:

| Verifier id | Scope | Locale scope | Proves | What it checks |
| --- | --- | --- | --- | --- |
| `mdx-compile` | page | per-locale | no | Validates YAML frontmatter and compiles the page with `@mdx-js/mdx`. |
| `internal-links` | site | per-locale | yes | Resolves internal links against page slugs and validates same-page anchors against section anchors. External URLs are skipped. Cross-page anchors are not validated. |
| `code-typecheck-ts` | block | source-only | yes | Typechecks `ts`, `tsx`, and `typescript` `code-example` blocks in isolation with TypeScript. Missing-module diagnostics are skipped. |
| `entity-integrity` | page | per-locale | no | Checks duplicate entity ids, duplicate section anchors, SHA-256 block content hashes, registered component block types, and component metadata schemas. |
| `snippet-exec` | block | source-only | yes | Executes runnable `bash`, `sh`, `js`, `javascript`, `ts`, and `typescript` code examples. Fences with `no-exec` are skipped. |
| `shellcheck` | block | source-only | no | Runs `shellcheck -s bash -f json -` on `bash` and `sh` code examples when `shellcheck` is available. Shellcheck levels below `error` become warnings. |
| `sample-parses` | block | per-locale | yes | Parses `json`, `yaml`, and `yml` code examples. JSON uses `JSON.parse`; YAML uses the `yaml` package. |
| `prose-lints` | page | per-locale | no | Runs deterministic prose lints for banned phrases, repeated sentence openings, and monotone sentence lengths. Code fences, inline code, import/export statements, and JSX tags are excluded. |
| `diagram-d2` | block | source-only | yes | Compiles `d2` code examples and checks whether extracted diagram nodes ground to codemap symbols. Ungrounded nodes warn by default; a `strict` fence makes grounding failures errors. |

Warnings alone do not make a verifier fail. The shared verifier helper returns `fail` only when at least one finding has severity `error`. An internal verifier crash becomes an `error` result with a visible error finding.

## Other Check IDs

Some check ids are emitted by pipeline stages rather than registered verifier definitions:

| Check id | Source |
| --- | --- |
| `claim-grounding` | Emitted when extracted claims reference identifiers that do not exist in the codemap. |
| `claim-extraction` | Emitted as a warning when claim extraction returns no valid structured claim result. |
| `translation-structure` | Emitted when a translated page cannot be aligned to the source page structure. |
| `review-error` | Emitted as a warning when a persona reviewer returns no valid structured review. |

## Visible Flags

A failed page is not treated as clean after the retry budget is exhausted. The page shard receives an open `system` flag whose detail contains the remaining findings. Tribal-knowledge questions raised during writing become flags too, and previously open tribal-knowledge flags are carried into regenerated shards.

The GitHub Action reads committed manifest shards to compute a verified delta. It counts `proven`, `scored`, and `out-of-domain` guarantees for content-bearing blocks and claims, and it collects open flags from page shards plus manifest system flags.

Auto-merge is blocked when any open flag has one of these kinds: `out-of-domain`, `tribal-knowledge`, `guarantee-downgrade`, `structural-change`, or `system`. Open `coverage` flags are visible, but they are not in the hardcoded auto-merge blocking list.

<Callout>
Flagged-but-visible is the implemented failure mode: verified content can pass, uncertain or broken content remains inspectable, and blocking flags prevent unresolved states from silently auto-merging.
</Callout>

## Running Checks

`docstube check --list` prints the verifier ids registered for the current project, including configured plugins.

`docstube check` loads the manifest, reads source-locale page shards and MDX files, rebuilds the codemap for the current version commit, runs registered verifiers with site scope enabled, and prints each selected verifier result. It exits with code `1` when selected results contain error findings and exits with code `0` otherwise.

## Plugin Verifiers

Plugin authors register verifier definitions with `host.verifier`. The plugin host checks registrations against the plugin manifest: registering an undeclared verifier is an error, declaring a verifier without registering it produces a warning, and duplicate verifier ids are rejected.

Verifier plugins run with a constrained context. File writes are limited to the plugin's declared writable roots, and process execution is limited to the executables declared in `permissions.exec`.