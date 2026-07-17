---
title: "How verification works"
description: "How docstube assigns proof levels, runs built-in verifiers, grounds claims, and ships visible flags instead of silent errors."
---

# How verification works

Docstube stores verification state in the entity model, not only in CLI output. `PageEntity`, `SectionEntity`, `BlockEntity`, and `ClaimEntity` each include a `guarantee` field backed by `guaranteeLevelSchema`. The allowed `GuaranteeLevel` values are `proven`, `scored`, and `out-of-domain`.

`proven` means a deterministic proving path covered the entity. `scored` means the entity was assessed by criteria-based review but was not deterministically proven. `out-of-domain` is for material that cannot be proven from source, such as intent or tribal knowledge.

Rollups are pessimistic through `rollUpGuarantee`: a parent displays the weakest guarantee among the provable child levels passed to it. When there is nothing provable under a parent, the rollup is `scored`.

## The pipeline

`runGenerate` builds a codemap before page generation by calling `buildCodemap` with the current commit and registered language packs. The codemap is the source index used later by writers, claim grounding, and verifiers.

For each page, `generatePage` runs a bounded loop. Each attempt builds a `write-page` task with the page brief, config, glossary, codemap, prior findings, enabled components, instructions, stored knowledge, and the `flagQuestion` tool.

After the writer returns MDX, `generatePage` extracts a `PageEntity`, records observed file reads from the transcript, and creates a `PageArtifact` containing the entity tree, MDX text, MDX path, locale, and version.

The draft then goes through deterministic verification and persona review:

- `runVerifiers` runs registered verifiers that apply to the current artifact.
- `reviewPage` runs one reviewer task for each configured persona.
- Error-severity verifier findings and error-severity review findings feed the same retry loop.

When no verifier or review errors remain, `attachExtractedClaims` runs the claims stage. It extracts checkable claims from the generated page, matches them against the codemap with `matchClaim`, and attaches claim entities to blocks. A grounded claim becomes `proven`; an unverifiable claim becomes `scored`; a defective claim creates a `claim-grounding` error finding.

After successful claim grounding, `liftClaimGroundedBlocks` promotes a prose block to `proven` when every attached claim is `proven`, then recomputes page and section rollups.

If errors remain after the configured attempts, `generatePage` writes a shard with an open system flag instead of hiding the problem. The page outcome is `flagged`, and the flag detail includes the remaining finding checks and messages.

## Deterministic verifier results

Each verifier returns a `VerifierRunResult` through `runVerifier`. A verifier result is `pass` when it has no error-severity findings, `fail` when it has at least one error-severity finding, and `error` when the verifier itself crashes. Some verifiers can also return `skipped`.

Only verifiers whose definitions set `proves: true` can upgrade covered entities through `assignGuarantees`. A passing proving verifier adds its `coveredEntityIds` to the proven set. If an error finding names an entity, that entity is removed from the proven set.

## Built-in verifier ids

The built-in verifier plugin is `@docstube/verifiers`. Its `builtinVerifierIds` are registered in this order:

| Verifier id | Scope | Locale behavior | Proves | What it checks |
| --- | --- | --- | --- | --- |
| `mdx-compile` | page | per-locale | no | Compiles each page with the MDX compiler and separately validates fenced frontmatter as YAML. |
| `internal-links` | site | per-locale | no | Finds markdown links and JSX anchor hrefs, ignores external targets, checks same-page anchors against section anchors, and checks internal page paths against generated slugs. |
| `code-typecheck-ts` | block | source-only | yes | Typechecks `ts`, `tsx`, and `typescript` code-example blocks in isolation with TypeScript diagnostics. |
| `entity-integrity` | page | per-locale | no | Checks unique entity ids, unique section anchors, valid block content hashes, known component block types, and component metadata schemas. |
| `snippet-exec` | block | source-only | yes | Runs executable `bash`, `sh`, `js`, `javascript`, `ts`, and `typescript` code examples unless the fence has `no-exec`. |
| `shellcheck` | block | source-only | no | Runs ShellCheck on `bash` and `sh` code-example blocks when `shellcheck` is available. |
| `sample-parses` | block | per-locale | yes | Checks `json`, `yaml`, and `yml` code-example blocks with `parseJsonSample` or `parseYamlSample`. |
| `prose-lints` | page | per-locale | no | Runs deterministic prose lints for banned phrases, repeated sentence openings, and monotone sentence lengths outside code and JSX. |
| `diagram-d2` | block | source-only | yes | Compiles `d2` diagrams and checks whether extracted diagram nodes ground to codemap symbols. |

Warnings are still visible. `runVerifier` treats warnings-only output as `pass`, but warnings do not make an entity proven unless the verifier is proving and covers that entity. Several verifiers deliberately use warnings for conditions that should be visible without becoming a hard gate, such as missing matching fences, unknown component block types, style lints, or ungrounded non-strict D2 nodes.

## Claim grounding

The claims stage is separate from the built-in verifier list. It runs on the clean path after deterministic verification and persona review.

`attachExtractedClaims` calls the claim extractor, locates each claim anchor in the MDX, maps the anchor to a block source range, and checks the extracted claim against a codemap index. The resulting `claim-grounding` finding is an error when a claim references something defective. That error sends the page back through the bounded retry loop.

A grounded claim becomes `proven`. An unverifiable claim becomes `scored`. A claim whose anchor quote cannot be located is counted as unanchored and is not attached to a block.

## Why flags ship

Docstube does not treat unresolved verification as invisible failure. `generatePage` writes flags into the page shard when verification or review still fails after retries. The GitHub Action later reads committed manifest shards with `loadVerifiedDelta`, counts content-bearing block and claim guarantees with `countPageGuarantees`, and includes open flags in the verified delta.

That means a page can be present while still showing exactly what remained unproven or broken. Flagged-but-visible is the fallback path for bounded automation: the docs stay usable, and the unresolved risk is carried in machine-readable state instead of being buried in generated prose.