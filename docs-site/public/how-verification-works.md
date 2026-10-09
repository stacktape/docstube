---
title: 'How verification works'
description: 'How docstube turns writer claims into anchored, checked, unchecked, or contradicted documentation states.'
---

# How verification works

The shortest version is the contract: <Claim id="c1">`writerClaimLedgerSchema` exists.</Claim> The writer does not only return prose; <Claim id="c2">`draftClaimSchema` records a `markerId` field.</Claim> <Claim id="c3">`draftClaimSchema` records a `class` field.</Claim> <Claim id="c4">`draftClaimSchema` records a `predicate` field.</Claim> <Claim id="c5">`draftClaimSchema` records a `proposedEvidence` field.</Claim> <Claim id="c6">`draftClaimSchema` records a `proposedSubscriptions` field.</Claim>

That shape matters because the marker is the visible denominator. <Claim id="c7">`claimMarkerIdSchema` exists.</Claim> <Claim id="c8">`anchorWriterLedger` scans inline `Claim` markers in the MDX.</Claim> <Claim id="c9">`anchorWriterLedger` rejects a marker that has no ledger entry.</Claim> <Claim id="c10">`anchorWriterLedger` rejects a ledger entry whose marker is absent from the MDX.</Claim>

## The ledger path

After a page is accepted, the kernel owns the durable record. <Claim id="c11">`claimLedgerSchema` exists.</Claim> <Claim id="c12">`claimLedgerSchema` records a `sourceRevision` field.</Claim> <Claim id="c13">`ledgerClaimSchema` records an `anchor` field.</Claim> <Claim id="c14">`ledgerClaimSchema` records a `quote` field.</Claim> <Claim id="c15">`ledgerClaimSchema` records a `correctness` field.</Claim> <Claim id="c16">`ledgerClaimSchema` records a `disposition` field.</Claim>

Anchoring is deliberately conservative. <Claim id="c17">`anchorWriterLedger` initializes each anchored code-dependent claim as `unchecked`.</Claim> <Claim id="c18">`anchorWriterLedger` initializes each anchored `intent-history` claim with the `maintainer-input-needed` disposition.</Claim> <Claim id="c19">`anchorWriterLedger` stores uncovered coverage-lint spans in `coverageLint.uncovered`.</Claim>

Verification then updates the trust state. <Claim id="c20">`CLAIM_VERIFICATION_CHECK` is claim-verification</Claim>. <Claim id="c21">`verifyClaims` assigns each claim a `correctness` value.</Claim> <Claim id="c22">`verifyClaims` emits `ClaimEvidence` records for reader-facing trust data.</Claim> <Claim id="c23">`claimCorrectnessSchema` allows `checked`.</Claim> <Claim id="c24">`claimCorrectnessSchema` allows `unchecked`.</Claim> <Claim id="c25">`claimCorrectnessSchema` allows `contradicted`.</Claim>

## Checkable wording

A claim is checkable only when the visible marker text and the ledger predicate say the same canonical thing. <Claim id="c26">`assessClaimCheckability` exists.</Claim> <Claim id="c27">`canonicalizeAssertionText` collapses whitespace.</Claim> <Claim id="c28">`canonicalizeAssertionText` removes one trailing period.</Claim>

The existence grammar is small on purpose. <Claim id="c29">`existenceAssertionForms` is exists,is defined,is available,is exported</Claim>. In page prose, write the marker around only the atomic fact, such as `runGenerateCommand exists`, then keep surrounding context outside the marker.

Value claims use the bound value path as the subject. <Claim id="c30">`renderValuePathSubject` renders parameter defaults as a call-shaped subject.</Claim> <Claim id="c31">`parseValueAssertionText` parses value assertions with `is set to`.</Claim> <Claim id="c32">`parseValueAssertionText` parses value assertions with `defaults to`.</Claim> <Claim id="c33">`parseValueAssertionText` parses value assertions with `equals`.</Claim> <Claim id="c34">`parseValueAssertionText` parses value assertions with `is`.</Claim>

Schema claims have their own canonical forms. <Claim id="c35">`schemaPresenceVerbs` is requires,accepts,defines,records,stores</Claim>. <Claim id="c36">`parseSchemaDefaultAssertionText` accepts the split default spelling.</Claim> <Claim id="c37">`parseSchemaDefaultAssertionText` accepts the dotted default spelling.</Claim>

The visible text also has to bind the subject and value. <Claim id="c38">`bindClaimSubject` requires the subject name in the visible marker text.</Claim> <Claim id="c39">`bindClaimSubject` requires the subject name in the predicate.</Claim> <Claim id="c40">`bindCitedValue` requires the cited value in the visible marker text.</Claim> <Claim id="c41">`bindCitedValue` requires the cited value in the predicate.</Claim>

## Claim decisions

The claim verifier has four built-in classes. <Claim id="c42">`builtinClaimClasses` is code-structure,value,behavior,intent-history</Claim>.

For structure claims, the deciding path is narrow. <Claim id="c43">`verifyClaims` checks canonical `code-structure` existence claims with `codemap-grounding` evidence.</Claim> <Claim id="c44">`verifyClaims` can contradict an `is exported` claim when the codemap visibility is not public.</Claim> <Claim id="c45">`verifyClaims` can decide schema presence claims with `schema-check` evidence.</Claim>

For value claims, the source value has to match the cited value. <Claim id="c46">`verifyClaims` compares cited-value subscriptions with extracted cited values.</Claim> <Claim id="c47">`verifyClaims` marks a mismatched value claim as `contradicted`.</Claim> <Claim id="c48">`verifyClaims` leaves an unresolvable value claim as `unchecked`.</Claim> <Claim id="c49">`verifyClaims` can decide schema default claims with `schema-check` evidence.</Claim>

For behavior and history, the current state is explicit. <Claim id="c50">`verifyClaims` leaves `behavior` claims as `unchecked` in 0.1.0.</Claim> <Claim id="c51">`verifyClaims` leaves `intent-history` claims with the `maintainer-input-needed` disposition.</Claim>

## Built-in page checks

The built-in verifier plugin is registered through the same plugin path as other verifiers. <Claim id="c52">`builtinVerifierIds` exists.</Claim> <Claim id="c53">`verifiersPluginName` is @docstube/verifiers</Claim>.

Current built-ins:

- <Claim id="c54">`mdxCompileVerifier` uses verifier id `mdx-compile`.</Claim>
- <Claim id="c55">`internalLinksVerifier` uses verifier id `internal-links`.</Claim>
- <Claim id="c56">`codeTypecheckTsVerifier` uses verifier id `code-typecheck-ts`.</Claim>
- <Claim id="c57">`entityIntegrityVerifier` uses verifier id `entity-integrity`.</Claim>
- <Claim id="c58">`snippetExecVerifier` uses verifier id `snippet-exec`.</Claim>
- <Claim id="c59">`shellcheckVerifier` uses verifier id `shellcheck`.</Claim>
- <Claim id="c60">`sampleParsesVerifier` uses verifier id `sample-parses`.</Claim>
- <Claim id="c61">`proseLintsVerifier` uses verifier id `prose-lints`.</Claim>
- <Claim id="c62">`diagramD2Verifier` uses verifier id `diagram-d2`.</Claim>

Those checks mostly protect pages and examples, not the prose claim state. <Claim id="c63">`mdxCompileVerifier` checks MDX compilation.</Claim> <Claim id="c64">`mdxCompileVerifier` checks frontmatter YAML parsing.</Claim> <Claim id="c65">`internalLinksVerifier` checks same-page anchors.</Claim> <Claim id="c66">`internalLinksVerifier` checks internal page slugs.</Claim> <Claim id="c67">`codeTypecheckTsVerifier` typechecks `ts`, `tsx`, and `typescript` code-example blocks.</Claim> <Claim id="c68">`snippetExecVerifier` executes JavaScript and TypeScript samples by default.</Claim> <Claim id="c69">`snippetExecVerifier` executes shell samples only when the fence metadata contains `exec`.</Claim> <Claim id="c70">`shellcheckVerifier` runs shellcheck for `bash` and `sh` code-example blocks.</Claim> <Claim id="c71">`sampleParsesVerifier` parses `json`, `yaml`, and `yml` code-example blocks.</Claim> <Claim id="c72">`diagramD2Verifier` compiles `d2` code-example blocks.</Claim> <Claim id="c73">`diagramD2Verifier` warns for ungrounded diagram nodes unless the fence metadata contains `strict`.</Claim> <Claim id="c74">`proseLintsVerifier` emits warning findings for banned prose phrases.</Claim>

## Coverage and the badge

The coverage linter is a deterministic floor. <Claim id="c75">`lintUncoveredAssertions` exists.</Claim> <Claim id="c76">`coverageLintRules.numericLiteral` is identifier-with-numeric-literal</Claim>. <Claim id="c77">`coverageLintRules.assertionVerb` is identifier-with-assertion-verb</Claim>. <Claim id="c78">`lintUncoveredAssertions` ignores code-example blocks.</Claim> <Claim id="c79">`lintUncoveredAssertions` records at most 20 spans per page.</Claim>

A complete badge is computed from the committed trust data. <Claim id="c80">`projectShardProof` counts `checked` claim evidence records.</Claim> <Claim id="c81">`projectShardProof` counts `contradicted` claim evidence records.</Claim> <Claim id="c82">`projectShardProof` sets `complete` to false when `uncoveredAssertions` is greater than 0.</Claim> <Claim id="c83">`projectShardProof` sets `complete` to false when `dirtyWorkingTree` is true.</Claim> <Claim id="c84">`projectShardProof` sets `complete` to true only when `totalClaims` is greater than 0.</Claim>

Read that badge literally. <Claim id="c85">`projectShardProof` does not use `riskCriticFindings` to compute `complete`.</Claim> <Claim id="c86">`projectShardProof` exposes `semanticAssertionRisks` separately from `uncoveredAssertions`.</Claim> A complete page means the kernel found checked evidence for every claim in the ledger, found no deterministic uncovered assertion spans, and did not withhold completeness for a dirty working tree. It does not mean a human never needs to review the page.
