## Design problems

The central recommendation is to make structural quality a separate, persisted assessment axis. It is not factual correctness, not persona fit, and not an exception requiring human attention. Reusing the current verifier/error/flag path would distort all three.

### 1. Structural quality has no first-class contract or durable state — fundamental

The new requirement names page- and navigation-level quality failures explicitly, but the current contracts cannot represent them. A `Finding` addresses at most one entity, has only verifier/review/lint provenance, and uses severity as its main policy signal. A navigation group, multiple sibling pages, detector confidence, applicability judgment, repair targets, and suppression lifecycle are all absent. Findings are journal events; committed state contains entities and flags, not open quality findings. [pipeline-v2.md](/C:/Projects/docstube/knowledge/design/pipeline-v2.md:49), [findings-schema.ts](/C:/Projects/docstube/packages/contracts/src/findings-schema.ts:6), [manifest-schema.ts](/C:/Projects/docstube/packages/contracts/src/manifest-schema.ts:43)

The existing coarse failure-mode registry is also unsuitable: it is telemetry-oriented and currently collapses unknown classes into `other`. [failure-modes.ts](/C:/Projects/docstube/packages/contracts/src/failure-modes.ts:5)

Concrete better design: introduce a committed `StructuralFinding`/`QualityFinding` contract, separate from verifier results and flags:

```ts
type StructuralFinding = {
  key: string; // stable semantic fingerprint
  code: string;
  scope:
    | { kind: 'entity'; address: EntityAddress }
    | { kind: 'nav-group'; groupId: string; pageIds: string[] };
  detector: {
    kind: 'deterministic' | 'ai-assessed';
    id: string;
    version: string;
    model?: string;
  };
  impact: 'high' | 'medium' | 'low';
  status: 'open' | 'resolved' | 'suppressed';
  evidence: unknown;
  repairTargets: Array<{ pageId: string; entityIds?: string[] }>;
  message: string;
  rationale?: string;
  scopeFingerprint: string;
};
```

Persist page-owned findings in page shards and navigation findings in one structural shard per navigation group, not in the monolithic manifest index. That permits stable deduplication, suppression, automatic resolution only after the same scope is re-evaluated, and incremental refinement. SQLite remains a derived ranking/index view.

The taxonomy should be narrow and detector-specific:

| Failure mode | Scope | Detection |
|---|---|---|
| Invalid or degenerate outline | Page | **Deterministic:** heading tree, empty sections, duplicate headings/anchors, section with no meaningful body |
| Duplicate sections | Page | **Hybrid:** exact substantial AST/content duplication is deterministic; shared claim subjects and similar headings create candidates for AI adjudication |
| Content/example in the wrong section | Page | **AI-assessed:** compare block content, referenced symbols, section purpose, and neighboring sections; deterministic only when an explicit plan slot is violated |
| Brief/outline mismatch | Page | **AI-assessed:** risk critic compares the outline and section summaries with the page brief |
| Broken prerequisite/order flow | Page | **AI-assessed; later:** concepts introduced after dependent steps, troubleshooting before setup, and similar judgment calls |
| Shared-facet asymmetry | Sibling cohort | **Deterministic** when `ia.yml` explicitly requires the facet; otherwise a deterministic outline-matrix candidate followed by AI applicability assessment |
| Shared-facet order drift | Sibling cohort | **Deterministic** under an explicit structural profile; inferred order norms should be AI-assessed |
| Duplicate topic ownership | Sibling cohort | **Hybrid; later:** claim-subject/source overlap proposes candidates; AI distinguishes duplication from intentional recap |
| Page does not belong in its nav group | Navigation | **AI-assessed; later:** compare the page brief, role, outline, and sibling summaries |

“Deterministic candidate” and “deterministic finding” must remain distinct. A 5/8 heading frequency is deterministic evidence, but not proof that all eight pages should contain that heading.

Cost now vs after 0.1.0: moderate now because the claim-ledger/manifest redesign already requires one private-state migration. High after release because committed manifests, dashboard queries, PR summaries, and refinement history would otherwise have to migrate from flags or ephemeral journal events.

### 2. The existing verifier/site-scope contract is the wrong execution model — fundamental

A site verifier receives only `PageArtifact[]` plus config, codemap, and glossary. It does not receive the IA tree, sibling relationships, page briefs, structural profiles, planned outlines, changed set, or prior structural snapshot. Its declared `site` scope changes when it runs, not the shape of its input. [hook-types.ts](/C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:52)

`includeSiteScope: true` also runs block and page checks again; the result is then reduced to error findings. That lifecycle is appropriate for a final hard topology gate, but ineffective for advisory, AI-assessed, persistently ranked quality findings. [verify-page.ts](/C:/Projects/docstube/packages/core/src/pipeline/verify-page.ts:121), [generate.ts](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:266)

Concrete better design: build a `StructuralSnapshot` over the complete staged canonical source site:

```text
staged canonical pages
        ↓
claim checks + primary-persona review + risk critic
        ↓
StructuralSnapshot
  IA groups · briefs · profiles · outlines · blocks
  claim subjects/source refs · page plans · changed scopes
        ↓
deterministic structural detectors
        ↓ candidates only
targeted AI page/group assessment
        ↓
persist findings → refine ranking → PR quality summary
```

The snapshot should be partitioned by current version and source locale and contain:

- Stable navigation groups and sibling cohorts.
- Page brief, depth, primary persona, and structural profile.
- Section IDs, heading hierarchy, block types, claim subjects/source references, and code-example symbol affinity.
- Explicit IA structural rules and exceptions.
- Optional PagePlan/GroupPlan data.
- Previous findings and changed page/group IDs.

Do not extend `VerifierDefinition` to cover this. Verification is being redesigned around claim obligations and evidence; structural quality does not mint correctness evidence. Add a separate `host.structuralCheck()` or `host.qualityCheck()` hook for deterministic plugin checks. AI assessment remains a kernel-owned structured agent task so its cost, model identity, cache, and result schema are controlled consistently.

On incremental generation, rebuild the cheap outline index globally, but run page checks only for changed pages and group checks only for their old/new parent groups. Run AI only when a deterministic candidate changed or an existing AI finding must be re-evaluated. This is compatible with the idempotent reconciler and staged publication already required by the binding pipeline design. [pipeline-v2.md](/C:/Projects/docstube/knowledge/design/pipeline-v2.md:8)

Cost now vs after 0.1.0: moderate now while the plugin SDK is explicitly experimental and the pipeline is already moving to staged snapshots. High later once plugins encode the current page-array site hook and incremental state is built around it.

### 3. “Sibling” is syntactic today; the design lacks a comparability and applicability model — fundamental

The current IA uses the absence of `brief` to imply a grouping node. It has no stable group identity, page role/profile, shared structural expectations, or exceptions. Even the binding primary-persona field has not yet reached this schema. [ia-schema.ts](/C:/Projects/docstube/packages/contracts/src/ia-schema.ts:11), [release-scope-v2.md](/C:/Projects/docstube/knowledge/design/release-scope-v2.md:13)

Without comparability, majority voting will manufacture defects. A navigation group can legitimately contain an overview, tutorial, reference page, migration guide, and troubleshooting page. Pricing may apply to deployable resources but not a free or abstract resource.

Concrete better design: make IA nodes an explicit discriminated union before release:

```yaml
- kind: group
  groupId: ng_compute
  title: Compute resources
  consistency:
    mode: auto
    requiredFacets: []       # optional explicit user rules
  children:
    - kind: page
      pageId: pg_function
      brief: Serverless function resource
      primaryPersona: application-developer
      structureProfile: compute-resource
      structuralExceptions: []
```

`structureProfile` should be an open string. An explicit parent rule or page exception is authoritative; inferred profiles and expectations are AI-derived and labeled as such.

Use this evidence ladder:

1. Explicit `ia.yml` rule plus no exception → deterministic finding.
2. Shared facet in an accepted user-authored template/profile → deterministic finding.
3. AI-derived GroupPlan/PagePlan → deterministic conformance evidence, but the resulting quality judgment remains labeled AI-derived.
4. Inferred sibling convention → deterministic candidate only, then AI assesses applicability per missing page.
5. AI returns `uncertain` → no finding and no refine target.

For the Stacktape example:

- The source-locale outline matrix finds `Pricing` on 5/8 pages in one `compute-resource` cohort.
- The ≥60% threshold summons the group assessor; it does not itself declare a defect.
- The assessor returns `expected`, `not-applicable`, or `uncertain` for each missing page, with reasoning grounded in briefs, PagePlans, claim subjects, and source assignments.
- One group finding is emitted only for the pages judged `expected`; the other missing page can be recorded as legitimately different.
- The finding identifies the five exemplar siblings and the specific pages eligible for repair.

Hardcode conservative 0.1.0 candidate rules: group size at least four, same explicit or confidently assessed profile, source locale only, and no inference when page roles are mixed. A suppression must carry a reason and the scope fingerprint; it should reopen only when group membership, the affected brief/profile, or the detector version changes.

A small `plan-nav-group` structured task is justified: one inexpensive call per changed group can produce coherent per-page outlines and shared-facet proposals before writers run. Its output guides the writer and assessor but is never source truth. This fits the already approved notion that PagePlan feeds structural consistency. [harness-state-v2.md](/C:/Projects/docstube/knowledge/design/harness-state-v2.md:56)

Cost now vs after 0.1.0: moderate now because IA already needs `primaryPersona` and manifest identity changes. High later because implicit group identity and ad hoc suppression keys will become user-authored state that cannot be migrated reliably.

### 4. `refine` currently has no monotonic improvement contract — fundamental

The current implementation ranks open non-tribal flags, then proven-block ratio, then age. It does not rank persisted review or structural findings. More seriously, it regenerates a selected page and writes the resulting MDX and shard immediately; there is no old-versus-candidate acceptance decision. [refine.ts](/C:/Projects/docstube/packages/core/src/pipeline/refine.ts:19), [refine.ts](/C:/Projects/docstube/packages/core/src/pipeline/refine.ts:63), [refine.ts](/C:/Projects/docstube/packages/core/src/pipeline/refine.ts:223)

That directly conflicts with the binding founder decision: findings first, then persona fit, then staleness, with a candidate accepted only when strictly better. [pipeline-v2.md](/C:/Projects/docstube/knowledge/design/pipeline-v2.md:15)

Concrete better design:

1. Rank pages by:

   - Open auto-repairable structural/review findings, ordered by impact.
   - Primary-persona criterion outcomes: most `not-met` first.
   - Staleness.
   - Stable page ID tie-break.

2. Expand a group finding into its minimal repair targets. Do not reroll all eight siblings because three lack a facet.

3. Generate into staged candidate state from the prior MDX, target findings, PagePlan, and neighbor-page summaries. Full sibling pages should not enter the writer context; labeled neighbor summaries are sufficient and consistent with the prior-doc access decision. [harness-state-v2.md](/C:/Projects/docstube/knowledge/design/harness-state-v2.md:61)

4. Re-run:

   - Ledger completeness and every affected claim obligation.
   - Page and site hard checks.
   - The primary-persona criteria.
   - Page structural checks.
   - The affected navigation group check against a virtual snapshot containing the candidate.

5. Accept only under a conservative Pareto gate:

   - No new blocking correctness finding.
   - No claim loses checked evidence or becomes unanchored.
   - No guarantee/evidence disposition regresses.
   - No new structural or review finding of equal/higher impact.
   - Primary-persona criterion outcomes do not regress.
   - At least one target finding resolves, or—when there was no concrete finding—at least one primary-persona criterion moves from `not-met` to `met`.

6. Otherwise discard the candidate, preserve the published page byte-for-byte, and journal the rejection reason.

For AI-derived persona fit, compare categorical per-criterion outcomes rather than inventing a scalar score. Ideally evaluate old and candidate together in one blinded paired task with the same persona, criteria, prompt version, and model. A tie is rejection. This keeps “strictly better” explainable.

Cost now vs after 0.1.0: medium now, but it overlaps the staged/atomic publication and diff-edit work already mandated. Very high later because public use of `refine` will otherwise create irreversible content churn while teaching users that “improve” does not mean monotonic improvement.

### 5. Structural quality must not enter the correctness claim ledger — significant

The binding trust model explicitly removes editorial/persona review from the factual correctness ladder. The page badge means complete factual claim checking, not general document quality. [trust-model-v2.md](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:15), [trust-model-v2.md](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:30)

The current known claim classes include `structural`, which creates a naming trap: a factual claim about code structure and a quality observation about page structure are not the same thing. [entity-schema.ts](/C:/Projects/docstube/packages/contracts/src/entity-schema.ts:44)

Concrete better design:

- Keep the claim ledger exclusively about factual assertions and their evidence obligations.
- Rename the factual class to something unambiguous such as `code-structure` or `system-structure`; never encode “Pricing section missing” as a claim.
- Let structural detection reference claim IDs, canonical subjects, source references, and block ownership as signals. Those references explain why two sections look duplicative or why an example appears misplaced; they do not prove the quality judgment.
- A structural repair must submit a complete replacement claim ledger. Moving or deleting content forces re-anchoring and rechecking before acceptance.
- Structural findings do not enter “defects per 100 checked claims,” the page correctness badge, or the correctness disposition denominator.
- Store AI structural assessments alongside other assessments, not in `ClaimEvidence` or `GenerationLineage`.

This preserves the trust-model split into correctness evidence and separate assessments while still extracting substantial value from the ledger.

Cost now vs after 0.1.0: low now because the ledger schema is already the central unreleased migration. High later because changing badge denominators and reclassifying committed “structural” claims would be a public trust migration.

### 6. Current delivery forces structural findings to be either invisible or falsely blocking — significant

Warnings from prose and reviews are journaled but not committed into the page shard, while site errors become open `system` flags. The PR summary is built around guarantees and open flags only. [page-runner.ts](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:184), [generate.ts](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:63), [delta-report.ts](/C:/Projects/docstube/apps/github-action/src/delta-report.ts:45)

Neither behavior is right for “quality a human would spot.” If it is only a warning, `refine` cannot rank it on a future run. If it becomes a system or structural-change flag, it blocks auto-merge and turns the flag queue into routine editorial supervision—the opposite of the L4 posture. `structural-change` already means an authoritative IA transition, not inconsistent content. [flag-schema.ts](/C:/Projects/docstube/packages/contracts/src/flag-schema.ts:8), [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:87)

Concrete better design:

- Structural quality findings are committed, nonblocking work items by default.
- Do not put them in the flag queue and do not reuse `structural-change`.
- Dashboard/NavTree: show page and group finding counts, detector label, affected siblings, and repair eligibility.
- Review UI: anchor within-page findings to sections/blocks and group findings to the navigation node.
- `status`: report correctness, persona-review completion, and structural quality as separate dimensions.
- `refine`: consume the committed findings directly.
- PR summary: add a separate section such as:

  > Structural quality: 3 open · 2 deterministic · 1 AI-assessed · nonblocking  
  > Compute resources: “Pricing” appears on 5/8 comparable pages; 2 missing pages were assessed as applicable.

- A refine PR should show accepted and rejected candidate counts, finding deltas, and per-criterion persona transitions.
- If an AI structural assessment cannot run, record the scope as `pending`, not passed or failed. Publish remains allowed and the reconciler schedules it later, matching the existing decision for unrun reviews.

Cost now vs after 0.1.0: moderate now across contracts, dashboard/status, and the PR renderer. Higher later because users and automation will have learned that every durable concern is a flag and every non-flag warning is disposable.

### Recommended 0.1.0 boundary

Ship in 0.1.0:

- `StructuralSnapshot`, `StructuralFinding`, group shards, stable lifecycle, and suppression.
- Explicit IA page/group node kinds, stable group identity, primary persona, optional profile/rules/exceptions.
- Source-locale-only detection.
- Deterministic outline integrity.
- Within-page duplicate-section and misplaced-example candidate generation, adjudicated through the single evidence-fed risk critic.
- The flagship sibling shared-facet detector: outline matrix plus targeted AI applicability assessment.
- Dedicated structure pass over staged canonical pages.
- Monotonic `refine` ranking and candidate acceptance.
- Dashboard/status/PR separation from correctness and flags.
- Replay fixtures plus a planted eval where 5/8 siblings have Pricing, two missing pages should have it, and one is legitimately exempt.

Defer:

- Site-wide semantic duplication outside sibling groups.
- Navigation-membership judgment and prerequisite-flow analysis.
- Learned structural profiles, embeddings, or fleet-derived conventions.
- Automatic background refinement without an explicit `refine` budget.
- Configurable quality policy and blocking thresholds.
- Cross-page factual contradiction detection; that belongs to claim consistency, not this feature.
- Per-locale structural assessment: strict structural isomorphism means localized renditions inherit the canonical structure. [i18n-lifecycle-v2.md](/C:/Projects/docstube/knowledge/design/i18n-lifecycle-v2.md:28)

## Effectiveness and UX

- Do not add one structural model call per persona. The binding design already narrows persona gating to the primary persona and introduces one evidence-fed risk critic; within-page structural judgment should ride that critic. [harness-state-v2.md](/C:/Projects/docstube/knowledge/design/harness-state-v2.md:34)
- Run at most one group assessment per changed candidate group. Cache it by IA/group-plan fingerprint, member outline hashes, detector/prompt version, and model.
- Do not run structural AI per locale. Assess canonical source once and inherit it across structurally isomorphic renditions.
- Avoid all-pairs page comparison. The outline matrix is linear in headings; claim-subject indexes nominate only plausible duplicate pairs.
- A majority threshold is a cost-control trigger, not a verdict. Showing “5/8” without applicability adjudication would train users to distrust the feature.
- Use “AI-assessed structural inconsistency,” never “verified defect.” The latter belongs to checked factual claims.
- Suppression must be one action with a reason, not a permanent global ignore. Reopen only when the relevant scope changes materially.
- `refine` should report rejected candidates as a success of the guardrail: “candidate discarded; introduced one new structure finding.” Quietly doing nothing will look broken.
- If the structural-quality budget is exhausted, show “assessment pending” in the run/PR summary. Do not freeze or block an otherwise complete correctness run.
- Persist only structured outcomes and concise reasoning in committed state; full model transcripts remain in the run journal.

## What is genuinely good

- Stable page/section/block/claim identity provides the right repair and UI anchors.
- Separating factual checking from persona assessment is the essential trust boundary to preserve.
- Strict source-locale structural isomorphism prevents an otherwise enormous per-locale quality-cost multiplier.

## Open questions for the founder

1. Should every structural-quality finding be nonblocking in 0.1.0, or should violations of explicit user-authored IA structural rules block auto-merge?
2. Should automatically inferred sibling conventions become actionable after AI applicability assessment, or should only explicit IA rules drive refinement while inferred conventions remain suggestions?
3. Should structural profiles, shared facets, and exceptions be durable intent in `ia.yml`, or should profiles remain derived PagePlan state with only user suppressions committed as intent?
4. Should `refine` remain an explicit, separately budgeted command in 0.1.0, or should `generate` automatically spend a bounded quality budget on the highest-ranked structural findings before promotion?
5. Should structural assessment remain an internal dashboard/PR signal, or should the rendered site expose a separate reader-facing “structure assessed” affordance?
