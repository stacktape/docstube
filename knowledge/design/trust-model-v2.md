> Folded into PRODUCT.md / ARCHITECTURE.md on 2026-07-21; this file remains the decision record.

# Trust model v2 — founder decisions (2026-07-19)

Source: the Sol xhigh design review, domains 01 (entity identity) and 02 (provenance &
guarantees), adjudicated decision-by-decision by the founder. This document is BINDING for the
0.1.0 redesign; the remaining review domains may add to it but not silently contradict it.

## Decisions

1. **Claim-aware writer.** The writer produces MDX plus a structured claim ledger in the same
   task: every factual claim with its exact text anchor, claim class, and proposed source
   references. The kernel validates and anchors the ledger BEFORE verification runs; invalid,
   truncated, or unanchored ledger output is a coverage failure that blocks the full-page badge.
   The post-hoc capped extractor dies (it survives only inside `audit` for foreign docs).

2. **Badge primary; the badge means 100%.** The single page badge appears when 100% of ledger
   claims are checked (per decision 3's definition) — the ledger removes the hidden denominator,
   so the badge is honest. The counts breakdown ("12/18 checked · 1 issue · 2 need input") lives
   one interaction away (chip popover) and is the surface for partial pages.

3. **"Checked" splits by claim class.**
   - Shape claims (existence/shape of a named API or config field: "there is a function
     retry(options)", "config has maxRunUsd") — grounding against the codemap suffices; the
     identifier's existence is most of the assertion.
   - Value/behavior claims ("defaults to 3", "throws on timeout") — grounding confers only
     `source-linked` (subject real, assertion unchecked). They count as checked only when a
     claim-class predicate verifier passes (signature/default-value comparison, execution
     assertions, schema validation — the v1.x verifier roadmap). Grounding failures (missing
     identifiers) remain hard defects for every class: killing hallucinated references stays.

4. **Review is a separate assessment axis.** Editorial/persona review leaves the correctness
   ladder. It renders as "AI-reviewed for <persona>" ONLY when the review genuinely completed,
   with criteria outcomes recorded per entity. Correctness states describe factual checking only.

5. **Owner-attested counts toward 100%.** A recorded maintainer answer (authorship + timestamp in
   the evidence record) is legitimate evidence for intent/history claims; the popover
   distinguishes attestation from mechanical checks.

6. **Citations are inline per claim.** A claim's evidence (source span, passed check, or
   attestation) attaches to the claim itself. The flat page-footer sources list dies; a compact
   "files consulted" disclosure survives for debugging, clearly not labeled as evidence.

7. **Page-level regeneration is the explicit 0.1.0 scope.** The ledger is designed so block-level
   regen stays possible later (claims anchored to blocks; per-block dependencies) but the
   machinery is not built now. ARCHITECTURE.md's block/section-granularity promise gets scoped.

8. **Identity under ambiguity — the threading hybrid** (founder delegated; design decision):
   - Trust state is NEVER carried by matching — guarantees/evidence recompute every run (already
     true; now explicit as the invariant that makes continuity safe).
   - Confident match → ID and human threads (feedback, flags, review history) carry.
   - Ambiguous match → ID carries FOR THREADING ONLY, and every carried human thread gets a
     drift marker: the UI shows "content changed substantially since this was written" with
     one-click detach. Matching confidence is recorded on the shard.
   - No plausible match → new ID; the old entity's threads surface as orphans for re-attachment
     or dismissal. Expected to be rare.

## Provisional calls (aligned with the above; founder may veto)

- Plugin verifiers do NOT mint the same badge status as built-ins: their evidence is labeled
  "project-defined check" unless explicitly promoted in config. (Sol Q4; follows from making the
  badge defensible.)
- The public audit metric changes before launch: defect rate = defective claims / CHECKED claims,
  with extraction coverage and unresolved counts reported separately. One claim = one outcome.
  (Sol Q9; the current all-extracted denominator is gameable by emitting unchecked claims.)
- Provenance splits into GenerationLineage / Dependencies / ClaimEvidence / Assessments per Sol
  domain-02 problem 5; reader surfaces read ONLY ClaimEvidence.
- `out-of-domain` is replaced by explicit dispositions (not-applicable, no-checker-available,
  maintainer-input-needed, owner-attested) derived from claim class + verifier availability.

## Deferred to remaining review domains

- pageId home (ia.yml vs manifest binding) and translation structural isomorphism — decide with
  the i18n-lifecycle domain (03).
- Verifier capability declarations replacing `proves: boolean` — decide with the verification
  domain (04); must express the claim-class obligations from decision 3.
- Whether generate/refresh/refine collapse into fewer commands — pipeline domain (05).

## Implementation sequencing (after all domains are adjudicated)

The claim-ledger rework touches: write-page contract, entity extraction, pipeline ordering,
provenance schema, verify/guarantee assignment, theme proof primitives, status/UI surfaces, and
the audit metric. It is THE 0.1.0 workstream; nothing above ships piecemeal — one coherent
migration while manifests are still private.
