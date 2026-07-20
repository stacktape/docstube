# Structural quality, CI, reader UX & release posture v2 — founder decisions (2026-07-21)

Source: Sol xhigh design review domains 10 (reader UX), 11 (CI & auto-merge), 12 (product
coherence), 14 (structural consistency failure modes), adjudicated by the founder. Completes the
design-review adjudication. Binding for 0.1.0 with the other *-v2 docs.

## Release posture (domain 12)

1. **Scope: keep broad, label honestly.** 0.1.0 keeps TS + Python + the wider advertised surface,
   but every capability below full assurance depth is marked **preview** to the user. A
   three-state support matrix (supported | preview | unavailable) is generated from the actual
   registries and consumed by the website, wizard, doctor, and Action validation. Assurance
   claims are scoped to supported surfaces; preview features are explicitly outside them.
2. **i18n STAYS in 0.1.0** (founder call, rejecting Sol's cut recommendation). i18n-lifecycle-v2
   ships in the release.
3. **L4 marketing stays** (founder: overpromise is normal marketing). The PRODUCT surfaces stay
   honest: in-product copy says the guarantee does not cover every use case; the AssuranceProfile
   (versioned per-project declaration of covered languages/claim classes/evidence kinds) ships as
   the in-product honesty mechanism, and the planted-defect conformance suite is built — it
   informs quality, it does not gate the launch claim. Measure autonomous completion rate,
   interventions per 100 changes, verified-claim coverage, maintenance latency, cost per page.
4. **Audit ships honestly as a stale public-reference checker** (pages scanned, identifiers
   checked, missing/renamed; behavioral claims excluded from the denominator). Not marketed as
   overall accuracy until claim predicates exist.
5. **Trust vocabulary: three orthogonal axes** — correctness (checked | unchecked | contradicted
   + evidence kind), editorial (reviewed | not | issues), workflow (publishable | attention |
   blocked). `proven`/`scored`/`out-of-domain` leave public surfaces. The factual claim class
   `structural` is renamed `code-structure` (page-structure quality is never a claim).
6. **Source-of-truth consolidation before implementation:** every *-v2 decision folds into
   PRODUCT.md and ARCHITECTURE.md; the v2 files remain as decision records, not parallel specs.
7. Reserved-but-ignored config (`autonomy`, `screenshots`) is removed — no fake affordances.
   `generate --explain` gives a non-generative impact/cost preview (no approval gate).
8. Privacy copy standardized: "docstube does not receive your source; the AI provider you
   configure receives the context required for generation." Transport data-flow table generated
   from the registry. (Website fix belongs to the web workstream.)

## CI & auto-merge (domain 11)

9. **Kernel-owned fail-closed PublicationDecision.** `generate --ci` emits one typed artifact
   (schema/tool version, base+source SHA, candidate hash, execution state, plan counts, gate
   result, regressions, publishable, autoMergeEligible, reason codes) bound to the candidate
   tree. The Action validates and enforces; absence, mismatch, missing shards, deferred work, or
   unknown codes fail closed. Frozen runs → publishable:false, no mergeable PR (staged-atomic).
10. **Budget = admission control over durable reconciliation:** plan persisted before agent
    calls; conservative per-page-family reservation from historical usage; work units that don't
    fit aren't started; staged work persists across workflow runs (no rebilling); rolling
    repo-level daily/weekly ceilings for API billing; per-vendor windows and reset timestamps
    preserved for subscriptions.
11. **Commit boundary is an output-inventory allowlist.** The reconciler emits an exact inventory
    with hashes; the Action stages only declared paths, reports undeclared writes, and marks the
    candidate ineligible on any mismatch.
12. **Guarantee-downgrade becomes real:** a kernel-produced semantic base-vs-candidate ledger
    comparison (badge loss, disposition regression, checked-count drop without deletion,
    evidence-authority weakening, attestation loss). Review/assessment changes report separately.
13. **Debt policy: no new debt** (founder). New blocking conditions block; existing conditions
    block only changes in their scope; regressions always block; unrelated fixes merge with debt
    visible. Coverage becomes a ratchet over explicit obligations (documented requires a
    claim/entity reference — not a file read; statuses documented / generated-reference-only /
    intentionally-omitted / not-public-for-docs / unassigned; IA pages own source scopes so new
    symbols route to candidate pages; 100% absolute coverage is an opt-in release policy).
    Dismissals become recorded waivers (actor, reason, scope, optional expiry; invalidated when
    the claim materially changes).
14. **Auth honesty:** full-auto mode requires a GitHub App/PAT + supported branch policy; with
    plain GITHUB_TOKEN the mode is labeled approval-assisted. `docstube doctor --ci --json`
    preflights transport auth AND all GitHub permissions/settings BEFORE any model spend.
15. **One supported reusable workflow:** concurrency set before the job, invokes only
    `generate --ci`, least-privilege permissions documented, Action+CLI pinned as one unit;
    `docstube-package` override retained only with auto-merge disabled unless the custom CLI
    presents a compatible decision schema. Stale queued runs coalesce.
16. Comment hygiene: marker comments upsert even when the last flag clears; flag lines carry
    new-vs-existing status and links; the `/answer` ingestion decided in dx-knowledge-v2 makes
    the "answer below" copy true.

## Structural quality (domain 14 — the founder's consistency feature)

17. **Contracts:** committed `StructuralFinding` (stable semantic key, code, entity|nav-group
    scope, detector {deterministic|ai-assessed, id, version, model}, impact, status
    open|resolved|suppressed, evidence, repairTargets, scopeFingerprint) — separate from
    verifier results, flags, and the claim ledger. Page findings live in page shards; group
    findings in one structural shard per nav group. Auto-resolve only after the same scope is
    re-evaluated. Suppression carries reason + scope fingerprint; reopens on material change.
18. **Execution:** a dedicated structure pass over the staged canonical site builds a
    `StructuralSnapshot` (IA groups/cohorts, briefs, primary personas, profiles, outlines, block
    types, claim subjects, plans, changed scopes, prior findings). Deterministic detectors emit
    candidates; targeted AI assessment adjudicates applicability. Within-page judgment rides the
    single risk critic. Not a VerifierDefinition — a separate `host.structuralCheck()` hook for
    deterministic plugin checks; AI assessment stays kernel-owned.
19. **IA schema v2:** explicit discriminated union (kind: group | page), stable groupId,
    primaryPersona (per release-scope-v2), optional structureProfile / consistency rules /
    structuralExceptions. Evidence ladder: explicit rule → deterministic finding; accepted
    profile → deterministic; AI-derived plan conformance → labeled AI-derived; inferred sibling
    convention → candidate only + per-page AI applicability; `uncertain` → no finding. AI-derived
    profiles are derived state; ia.yml holds only user intent. Conservative 0.1.0 candidate
    rules: cohort ≥ 4, same profile, source locale only, no inference across mixed page roles.
20. **Flagship detector:** sibling shared-facet asymmetry (outline matrix → ≥60% threshold
    summons the group assessor → per-missing-page expected | not-applicable | uncertain → one
    group finding targeting only 'expected' pages). Plus deterministic outline integrity and
    within-page duplicate-section / misplaced-example candidates. A planted eval ships (5/8
    siblings have Pricing; two should; one legitimately exempt). Deferred: site-wide semantic
    duplication, nav-membership judgment, prerequisite flow, learned profiles, per-locale
    assessment (isomorphism inherits structure), cross-page contradiction (claim consistency).
21. **ALL structural findings are NONBLOCKING in 0.1.0** (founder — even explicit-rule
    violations). They are committed work items: dashboard/NavTree counts, review-UI anchors, a
    separate PR-summary section ("Structural quality: 3 open · nonblocking"), never the flag
    queue, never `structural-change`. Budget exhausted → scope `pending`, publish allowed.
    Naming: "AI-assessed structural inconsistency", never "verified defect". No reader-facing
    structure affordance on the site.
22. **`refine` stays an explicit, separately budgeted command** (founder) with the monotonic
    contract: rank by open auto-repairable findings (impact-ordered) → primary-persona `not-met`
    criteria → staleness → stable tie-break; expand group findings to minimal repair targets;
    regenerate into staged state (prior MDX + findings + PagePlan + neighbor summaries only);
    re-run affected obligations/checks/criteria + virtual group check; accept only under the
    Pareto gate (≥1 target finding resolves or a criterion flips to met; nothing regresses:
    no new blocking finding, no claim loses evidence/anchor, no disposition or criterion
    regression); otherwise discard byte-for-byte and journal why. Persona-fit comparison is
    categorical per-criterion (blinded paired judgment; tie = rejection). Rejections are
    reported as the guardrail working.

## Reader UX (domain 10)

23. **Trust chip: "Verified · 23/23 checked"** — brand word + literal denominator in the chip;
    green reserved for 100%; partial pages show "18/23 checked · 2 issues" without the brand
    word; separate rows for "AI-reviewed for <persona>" and translation fidelity. Click →
    popover: denominator, evidence mix, unresolved dispositions, last-checked commit/date,
    definition of "checked". Positive section chips disappear (exceptions only). A generated
    `/verification/` trust-report page ships (methodology, coverage, unresolved issues).
24. **Evidence UI: quiet default, loud exceptions.** Checked claims are visually quiet; per-claim
    popover on hover/click + page-level "show evidence" toggle (claim, disposition, evidence
    type, source span/attestation, check + outcome, commit, source link). Unchecked /
    contradicted / needs-input claims are always visibly marked. Footer renamed "Files
    consulted", collapsed, labeled as lineage not evidence. Private repos default to
    link/path-only evidence; excerpt embedding is policy opt-in.
25. **Canonical machine corpus, everything else a projection** (subsumes the markdown-rendition
    requirement from harness-state-v2): one corpus with resolved IA/routes, page/entity IDs +
    revision, locale + publication state, normalized Markdown (via per-component
    renderToMarkdown), claim ledger with dispositions, optional evidence detail. Projections:
    llms.txt (discovery map), per-page .md (normalized content + minimal trust metadata),
    llms-full.txt (only under a documented size threshold, else split by IA section), MCP as a
    query/read adapter (`includeEvidence: summary | full`).
26. **MCP posture: local repository tool for 0.1.0** (consistent with deployment = local
    artifact). Honest tools — search_docs, read_page, read_structure — over a precomputed index;
    ready-to-paste client config emitted. No pretense of a public static-site endpoint; a public
    MCP waits for a deployment adapter.
27. **Navigation: the emitter consumes ia.yml.** A resolved nav tree (group|page kind, route,
    ancestry, per-locale availability, active state, prev/next, exception markers) replaces
    slug-prefix reconstruction. `sectioned` is removed for 0.1.0 — one excellent nested layout
    (collapsible groups, real home page, breadcrumbs, prev/next, related links); tabs return
    later as another rendering of the same tree. All version-switcher surfaces removed (cut).
    Locale/version routing goes through one route matrix (pageId × locale) resolving to
    ready | stale | source-fallback | unavailable with reader-visible explanations.
28. **Search is an emitter-owned contract:** data-pagefind-body on the article only; nav/TOC/
    proof-chrome/footers ignored; metadata (pageId, IA section, locale, publication state);
    default locale-scoped with explicit all-languages mode; source-fallback pages excluded from
    localized coverage; breadcrumbs + section excerpts in results.
29. **Dogfood docs are rebuilt reader-first before launch** (overview/guides/concepts/reference/
    AI-access/trust-report IA; reader jobs before implementation names; internal links,
    prev/next). The dogfood site is the permanent screenshot.

## Sequencing

Contracts (17, 19, ledger-adjacent parts of 9/12/13) join the single claim-ledger state
migration. The structure pass, refine contract, and PublicationDecision land with the
generate-reconciler. Reader-UX items land with the theme/emitter rework (nav tree first — it
unblocks the dogfood rebuild). The support matrix (1) and consolidation (6) precede public copy.
