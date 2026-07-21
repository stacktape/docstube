> Folded into PRODUCT.md / ARCHITECTURE.md on 2026-07-21; this file remains the decision record.

# Harness & state v2 — founder decisions (2026-07-21)

Source: Sol xhigh design review domains 06 (harness effectiveness) and 07 (state & storage),
adjudicated by the founder. Binding for 0.1.0 alongside trust-model-v2.md, i18n-lifecycle-v2.md,
pipeline-v2.md, and release-scope-v2.md.

## Harness decisions

1. **Exploration: codemap-backed evidence tools become primary.** The four generic read tools
   (read_file / list_dir / glob / grep) stay as escape hatches, but agents get semantic tools that
   answer docs questions directly: `search_symbols`, `read_symbol(hash, include: signature | body
   | tests | usages)`, `find_examples` / `find_tests`, batched `read_ranges`, plus preflight
   `check_snippet` and `validate_page_draft`. All content-bearing results emit evidence handles
   (symbol hash or file/span/hash) — this also closes the grep provenance hole (grep currently
   records no observed reads). Generic grep gets cheap fixes: case-insensitivity flag, glob
   filter, optional context lines, observed-read recording. No bundled ripgrep for 0.1.0; the JS
   implementation is adequate once agents stop using text search as the primary mechanism.

2. **PageContextPack — adopted, flagged HIGH-RISK by the founder.** A typed, token-budgeted
   per-page evidence pack (purpose, primary persona, assigned symbols/topics, relevant
   signatures/tests/examples, neighbor-page summaries, source trust labels, declared omissions)
   replaces the "first 200 codemap symbols in codemap order" context. Founder constraint: the
   pack must be ADDITIVE — on-demand exploration always remains available, packs declare what
   they omitted, and a badly built pack may degrade a page but must never wall the writer off
   from the repository. Design carefully; this is a load-bearing contract.

3. **Unrun reviews are nonblocking: publish with label withheld.** When the primary persona's
   review could not run (budget freeze, model failure) but claims are checked, the page
   publishes; "AI-reviewed for <persona>" appears only when the review genuinely completes (the
   reconciler schedules it as pending work). Reviews that RAN and found required criteria not-met
   still block — this covers only unrun reviews. Matches the nonblocking-translation precedent
   and the minimal-review tenet.

4. **Correctness leaves persona reviews; one evidence-fed risk critic per page.** Persona
   reviews judge audience fit + brief conformance only (their real competence). Factual
   correctness is owned by the claim ledger; a single risk critic per page receives the
   claim/evidence summary (not the raw repo) and hunts what the ledger structurally cannot
   catch: misleading framing, dangerous omissions, wrong emphasis. Kills plausibility-review
   theater (dogfood evidence: a review with zero tool calls marked correctness "met" as
   "plausible within the page itself").

5. **Claim anchors are INLINE markers in the MDX** (e.g. a lightweight `<Claim id>` component
   around the asserted span). Anchors cannot drift through diff-edits; translation units inherit
   claim refs for free (strict isomorphism needs this); the already-decided inline citations
   render straight from the markers. Validated at submit time. Sol's coverage linter ships
   regardless: deterministic detection of assertion-shaped prose (identifiers, defaults,
   numbers, modal statements) not covered by any claim, so ledger omission cannot manufacture
   "100% checked".

6. **NEW REQUIREMENT (founder): every page has a pure-markdown rendition.** Because claims are
   inline components, the site must also emit a clean `.md` twin per page, easily readable by
   agents and humans without clutter. Consequence: every supported theme/React component
   contracts BOTH renderToHTML and renderToMarkdown representations. This is the channel for
   llms.txt-style agent consumption and applies to all components, not just Claim.

7. **One writer per page, always.** No section fan-out / assembler machinery. A cheap PagePlan
   step may still exist as an outline (it also feeds the structural-consistency feature), but a
   single writer session produces the whole page. Very deep pages accept the quality tradeoff;
   revisit only with eval evidence.

8. **Prior generated docs: labeled channels only — PROVISIONAL, to be settled by evals.**
   Generated output (outDir, docs content, .docstube state) is excluded from agent read roots
   (the dogfood self-reference incident: a writer read generated MDX as source, 413k input
   tokens). Prior content enters only through explicit labeled inputs: the prior version of the
   SAME page for diff-edit repair, and neighbor-page summaries in the context pack. The founder
   declined to decide this on argument alone — see the eval queue below.

9. **Eval queue (founder-initiated, first-class deliverable).** Policy questions that argument
   cannot settle get real experiments: a suite of ~10+ live end-to-end generation runs (real
   provider APIs, secrets-gated workflow, NEVER in CI) that A/B a policy and score outputs.
   First registered experiments: (a) prior-docs access policy (decision 8), (b) context-pack
   composition vs on-demand exploration balance. Extends the existing evals infrastructure.

## State & storage decisions

10. **Monorepos: a docset IS an initialized directory** (founder's model). docstube operates on
    the directory where it was initialized: repo root → one docs site for everything;
    per-package docs → run init inside that package. No multi-docset machinery, no docset
    abstraction in config or state. Rule: an outer project excludes nested docstube project
    roots from its own scope (no double documentation). Nested projects are otherwise fully
    independent.

11. **Cross-project overview pages are OUT OF SCOPE for v1** — explicit non-goal. docstube
    documents one repository. Cross-repo aggregation waits for a real design for cross-repo
    provenance and staleness; nobody improvises it.

12. **Manifest shards become canonical JSON + semantic diff rendering.** Machine-owned committed
    state (`.docstube/manifest/…`) moves from YAML to sorted-key canonical JSON (compact, fast,
    byte-stable when content is unchanged → minimal diffs). The human surface is the semantic
    delta in the PR summary the Action already posts ("page X: 3 claims re-verified, 1 added;
    de: stale→ready"). Human-owned files (docstube.yml, ia.yml, criteria, instructions) STAY
    YAML. (Founder adopted on recommendation.)

## Sequencing

Items 1–2 and 5–6 land inside the claim-ledger rework (evidence handles, submit_page validation,
markdown renditions are one artifact-contract change). Item 12 lands with the manifest reshape
the ledger forces anyway — one state migration while manifests are private. Items 3–4 land with
the review routing changes from release-scope-v2 (primary-persona gating). Item 9 extends evals
and should exist BEFORE the context-pack design is frozen, so decision 8 can be validated.
