## Design problems

Bottom line: the current provenance does not justify the “verified” page and section badges. It can honestly establish that content was generated against a commit, that an agent consulted certain inputs, that selected mechanical checks passed, and that some referenced identifiers exist. It cannot establish that every factual claim is true or visibly flagged. This needs redesign before 0.1.0, because the manifest schema, plugin verifier contract, public metric, and reader vocabulary will otherwise encode the overclaim.

### 1. Identifier existence is being promoted from grounding to proof — fundamental

The matcher can reliably detect one narrow defect: a claim whose referenced identifiers are all absent. It cannot prove the positive predicate of the claim. Nevertheless, if any referenced identifier exists, the claim is “grounded”; that result becomes `proven`, and fully grounded claims can lift their containing block and page to `proven` ([match-claims.ts:148](/C:/Projects/docstube/packages/core/src/audit/match-claims.ts:148), [claims-stage.ts:132](/C:/Projects/docstube/packages/core/src/pipeline/claims-stage.ts:132), [verify-page.ts:244](/C:/Projects/docstube/packages/core/src/pipeline/verify-page.ts:244)).

That is insufficient for the claim classes the extractor is explicitly asked to produce: defaults, configuration, API shapes, and behavior ([extract-claims.ts:26](/C:/Projects/docstube/packages/core/src/audit/extract-claims.ts:26)). For example, “`retry` defaults to 3” becomes proven when `retry` merely exists. “`connect()` encrypts every request” becomes proven when `connect` exists. The matcher is identifying a possible subject, not verifying the assertion about that subject.

The audit design itself correctly admits that v1 checks only identifier existence ([audit.md:54](/C:/Projects/docstube/knowledge/design/audit.md:54)); the mistake is reusing that result as evidence for the much broader product promise that every claim is mechanically checked ([PRODUCT.md:30](/C:/Projects/docstube/PRODUCT.md:30)).

Concrete better design:

- Separate `subjectResolution` from `predicateVerification`.
- Represent claims as typed proof obligations: subject references, predicate, expected value or behavior, claim class, and required evidence kinds.
- Let codemap matching produce only `source-linked` or `unresolved` evidence.
- Route obligations to claim-class-specific verifiers: signature comparison, schema validation, OpenAPI matching, CLI inspection, execution assertions, and so on.
- A claim is fully checked only when every required obligation passes. An available source link alone must never confer that state.
- Preserve the current missing-identifier detector as a valuable confirmed-defect check.

Changing now requires a claim-schema and matcher rewrite, but no public manifest compatibility is owed yet. After 0.1.0, it breaks committed manifests, plugin behavior, public badge semantics, audit reports, and any published comparative claims. More importantly, later correction would look like a retreat from the core trust promise.

### 2. Claims do not exist when deterministic verification runs — fundamental

Blocks are extracted with no claims ([extract-entities.ts:115](/C:/Projects/docstube/packages/core/src/entities/extract-entities.ts:115)). The pipeline runs verifiers and assigns guarantees first, then invokes the claim extractor only after those checks and persona reviews have passed ([page-runner.ts:162](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:162), [page-runner.ts:199](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:199), [page-runner.ts:202](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:202)).

This makes the architectural statement that claims are “the finest verification grain” untrue in the operational pipeline. Deterministic verifiers cannot inspect a claim’s class, predicate, or source mapping because those entities do not yet exist.

Claim completeness is also best-effort:

- Extraction is capped at 30 claims per page ([extract-claims.ts:11](/C:/Projects/docstube/packages/core/src/audit/extract-claims.ts:11)).
- Invalid extraction becomes zero claims plus a warning ([extract-claims.ts:66](/C:/Projects/docstube/packages/core/src/audit/extract-claims.ts:66)).
- Unanchored claims are dropped and merely warned about ([claims-stage.ts:119](/C:/Projects/docstube/packages/core/src/pipeline/claims-stage.ts:119)).
- Claimless narrative is invisible to the roll-up.

A system cannot promise “every claim is proven or flagged” while an unconstrained model selects a capped subset after verification has finished.

Concrete better design:

1. Make the writer produce MDX plus a structured claim ledger in the same task, with exact text anchors and proposed source references.
2. Validate and attach that ledger before any factual verifier or reviewer runs.
3. Resolve proposed sources deterministically; do not trust the writer’s mapping.
4. Route each claim to applicable proof obligations and verifiers.
5. Treat invalid, truncated, or unanchored claim output as a coverage failure that prevents a full-page trust badge.
6. Run an independent factual-coverage check for factual prose with no ledger entry.

If the founder wants the literal “every claim” promise, the robust long-term design is a claim-aware intermediate representation from which MDX is rendered. If raw MDX remains the primary writer output, the public promise should instead be “we show exactly which extracted claims were checked,” with explicit extraction coverage.

This is a substantial change now, but it is still local to the writer output contract, entity extraction, and pipeline ordering. After release it changes stable entity behavior, claim IDs, caches, fixtures, manifests, plugins, and public accuracy metrics.

### 3. The “pessimistic” roll-up is optimistic from the reader’s perspective — fundamental

The roll-up is pessimistic only among content the kernel has first elected to count. It explicitly excludes claimless narrative and `out-of-domain` blocks; sections with no provable content are transparent to the page. Therefore, a page containing one proven code block, several unchecked narrative assertions, and an unresolved owner question can display as `proven` ([provenance-schema.ts:20](/C:/Projects/docstube/packages/contracts/src/provenance-schema.ts:20), [verify-page.ts:219](/C:/Projects/docstube/packages/core/src/pipeline/verify-page.ts:219)).

The rendered label for that state is not “everything we classified as provable passed.” It is the unqualified word “verified” ([proof-source.ts:8](/C:/Projects/docstube/packages/theme/src/proof-source.ts:8)). That is the normal reader interpretation of the whole page or section.

This is not a pessimistic guarantee. It is a hidden-denominator guarantee.

Concrete better design:

- Replace the scalar correctness ladder with a coverage summary:
  - factual claims checked;
  - factual claims unchecked because no verifier exists;
  - claims needing maintainer input;
  - confirmed issues;
  - checks unavailable or errored.
- If a single compact status is required:
  - `fully checked` only when every registered factual claim passed, extraction coverage is complete, no checker errored, and no owner-input question remains;
  - `partially checked` for any mixture;
  - `issues found` when a check refutes a claim.
- Non-factual prose should be `not applicable`, not silently omitted from an ordinal minimum.
- Display counts using factual claims as the denominator, not all blocks.

Changing now affects contracts, theme frontmatter, review UI, PR reports, and tests. After release, it also changes a reader-visible trust contract embedded in generated sites and committed manifests, making migration and explanation much harder.

### 4. The verifier contract cannot express what a pass proves — fundamental

A verifier has a single `proves: boolean` and returns an undifferentiated list of covered entity IDs ([hook-types.ts:70](/C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:70)). Any passing verifier with that Boolean set can upgrade every returned entity to `proven` ([verify-page.ts:176](/C:/Projects/docstube/packages/core/src/pipeline/verify-page.ts:176)).

This cannot distinguish:

- syntax parsed;
- typechecked in isolation;
- executed without error;
- returned the documented result;
- conforms to a schema;
- matches an API contract;
- verifies a specific behavioral predicate.

It also lets a third-party plugin self-declare proof authority. Soft plugin permissions may be acceptable operationally, but a project-installed plugin should not silently mint the same reader-facing “verified” badge as a docstube-controlled proof.

The durable evidence model is also too thin. `VerificationRecord` lacks covered obligations, checked input hashes, source revision, toolchain fingerprint, execution environment, and evidence kind ([provenance-schema.ts:54](/C:/Projects/docstube/packages/contracts/src/provenance-schema.ts:54)). In the page path, transient verifier results assign guarantee values, while the final provenance augmentation persists review records only ([page-runner.ts:251](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:251)). A later signature would merely sign an inadequately specified assertion.

Concrete better design:

- Replace `proves` with declared proof capabilities such as `symbol-exists`, `signature-equals`, `sample-parses`, `sample-typechecks`, `sample-executes`, or `output-equals`.
- Verifiers should return evidence per claim obligation, not per arbitrary entity.
- Persist an evidence record containing:
  - claim and obligation IDs;
  - verifier and plugin package/version;
  - proof capability;
  - checked content/input hash;
  - source commit;
  - toolchain/environment fingerprint;
  - outcome and concise details;
  - journal artifact reference.
- Have the kernel validate that returned evidence matches a capability the verifier registered.
- Distinguish built-in or approved checks from `project-defined check` evidence. Custom checks should confer a global trust state only through an explicit policy decision.

The public plugin SDK is still experimental, making this relatively cheap now. After plugin authors begin implementing `proves: true`, correcting the contract becomes both a migration problem and an ecosystem trust dispute.

### 5. Provenance conflates evidence, generation lineage, and invalidation dependencies — significant

The schema places sources, seed inputs, observed reads, verification records, and reviews in one `provenance` object ([provenance-schema.ts:81](/C:/Projects/docstube/packages/contracts/src/provenance-schema.ts:81)). These records answer different questions:

- What caused the generator to produce this content?
- What should invalidate it after a code change?
- What evidence supports this claim?
- What quality assessment was performed?

Treating them as one kind of provenance causes the visible source problem. Page generation takes every symbol located in every file the writer happened to read and records all of them as page sources ([page-runner.ts:135](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:135)). The theme then flattens page, block, and claim sources into one page footer ([emit-site.ts:193](/C:/Projects/docstube/packages/theme/src/emit-site.ts:193)).

Opening a file is not evidence that every symbol in it supports the page. This produces three harmful effects:

- Readers receive noisy citations that do not identify which claim a source supports.
- Coverage can count unrelated symbols as documented because it derives documented symbol hashes from these provenance sources ([maintain.ts:407](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:407)).
- Refresh dependencies become broader than the actual factual dependency.

Concrete better design:

- `GenerationLineage`: prompt inputs, briefs, instructions, model/task identity.
- `Dependencies`: source symbols, files, or tool-result hashes that should trigger regeneration.
- `ClaimEvidence`: exact source span or external truth record, relation to the claim, and supporting verifier result.
- `Assessments`: persona/editorial review records.

Reader-facing citations should be generated only from `ClaimEvidence`, ideally adjacent to the claim or in a section-level evidence drawer. Broader dependencies can remain in the manifest for maintenance without being presented as factual citations. A separate “files consulted during generation” disclosure may be useful for debugging, but it should not be labeled “Sources.”

Changing now is a moderate schema and emitter change. After 0.1.0 it requires manifest migrations and invalidates the meaning of already published citations and coverage numbers.

### 6. `scored` is neither a score nor reliable evidence that content was reviewed — significant

Blocks and pages begin life as `scored` before any reviewer runs ([extract-entities.ts:129](/C:/Projects/docstube/packages/core/src/entities/extract-entities.ts:129)). The reader sees that state as “reviewed” ([proof-source.ts:8](/C:/Projects/docstube/packages/theme/src/proof-source.ts:8)).

A malformed or missing persona review is a warning and the page ships without that review ([review-page.ts:95](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:95)). Review records are then attached only to page provenance, with persona and criterion outcomes but no entity coverage, criterion definition/version, model, task input hash, or committed reasoning ([page-runner.ts:251](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:251)). There is no defensible `scoredBy` relation for the individual claim or block displaying `scored`.

The state also mixes editorial quality with factual confidence. Audience fit and brief conformance are valuable, but an AI persona review is not a fallback correctness guarantee beneath deterministic proof.

Concrete better design:

- Remove `scored` from the correctness ladder.
- Model editorial assessment separately as `AI-reviewed for <persona>`.
- Record target entity IDs, criterion ID and version/hash, outcome, reviewer model/task digest, and run reference.
- Show “AI-reviewed” only when the configured review actually completed with valid coverage.
- Keep correctness-risk review findings as risk detection, not proof.
- Let factual claims remain explicitly unchecked when no deterministic evidence exists.

Changing now is moderate. After release, correcting it changes a visible label that users may already interpret as a quality endorsement.

### 7. `out-of-domain` is an overloaded implementation category rather than a usable epistemic state — significant

An identifier-free or otherwise uncheckable extracted claim becomes `scored`, not `out-of-domain` ([claims-stage.ts:146](/C:/Projects/docstube/packages/core/src/pipeline/claims-stage.ts:146)). Tribal uncertainty is detected only when the writer voluntarily calls `flag_question` ([write-page.ts:60](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:60)); the result becomes a page flag, not a claim-level guarantee disposition ([page-runner.ts:272](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:272)).

Consequently, `out-of-domain` does not reliably mean “this assertion cannot be established from code.” It also cannot distinguish:

- inherently owner-known intent or history;
- a checkable class for which docstube lacks a verifier;
- a verifier that was unavailable;
- content with no factual assertion;
- unsupported structure.

Those cases have different user actions and different trust implications.

Concrete better design:

- Replace the single state with explicit dispositions:
  - `not-applicable`;
  - `no-checker-available`;
  - `check-unavailable`;
  - `maintainer-input-needed`;
  - `owner-attested`;
  - `checked`.
- Derive the disposition from claim class and verifier availability, not only writer self-report.
- Treat a maintainer answer as owner-attested evidence with authorship and timestamp, not deterministic proof.
- Keep unsupported components and system failures as structural/system findings, not epistemic out-of-domain content.

Changing now is low to moderate because the workflow exists but is not yet coherently connected to entities. After release, flag queues, manifests, UI filters, and user expectations will depend on the old category.

### 8. `seedContext` and `observedReads` are too incomplete for lineage and too coarse for maintenance — significant

`seedContext` is an array of opaque strings ([provenance-schema.ts:81](/C:/Projects/docstube/packages/contracts/src/provenance-schema.ts:81)). The page records only a hash of the entire codemap symbol list and a hash of the brief ([page-runner.ts:146](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:146)), even though the writer prompt also embeds project configuration, personas, glossary, writing instructions, and owner knowledge ([write-page.ts:37](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:37)). The committed record therefore cannot explain or invalidate against the full input that actually shaped the prose.

Observed reads have the opposite problem. A ranged `read_file` records a full-file hash ([tools.ts:213](/C:/Projects/docstube/packages/agent-runtime/src/tools.ts:213)), while `grep` reads and exposes file contents without recording those files as observed reads ([tools.ts:303](/C:/Projects/docstube/packages/agent-runtime/src/tools.ts:303)). Thus the trace is simultaneously over-broad for some changes and incomplete for other model-visible content.

Concrete better design:

- Make task lineage automatic from the resolved task input rather than manually assembled in `page-runner`.
- Use typed input references: kind, stable ID/path, content hash, origin, and sensitivity policy.
- Record every model-visible tool result as a dependency, including grep matches and directory/glob results.
- For source reads, record the returned span and its hash plus the containing file revision hash.
- Build narrow symbol/span dependencies where known and retain a conservative file fallback when mapping is uncertain.
- Record exact relevant codemap slices, not a single whole-codemap hash.

Changing now requires agent-runtime and manifest work, but no compatibility burden. After release, it changes cache semantics and which refreshes regenerate content, so migrations and user surprise become unavoidable.

### 9. The public audit metric has a misleading denominator — significant

“Verified defects per 100 claims” includes unverifiable claims in the denominator specifically so they dilute the rate ([audit.md:8](/C:/Projects/docstube/knowledge/design/audit.md:8), [run-audit.ts:32](/C:/Projects/docstube/packages/core/src/audit/run-audit.ts:32)). Meanwhile, one claim can contribute several missing-identifier defects, so numerator and denominator are not even the same unit ([audit.md:18](/C:/Projects/docstube/knowledge/design/audit.md:18)).

This metric can improve when the extractor emits more unchecked claims, when an extractor model changes its claim selection, or when a page contains more uncheckable narrative. The 30-claim cap further makes cross-project and cross-version comparisons sensitive to selection. Calling the result the product’s falsifiable accuracy metric overstates what it measures.

Concrete better design:

Report separate raw counts and rates:

- extraction coverage and truncation;
- checked claims / extracted factual claims;
- defective claims / checked claims;
- unresolved claims / extracted claims;
- missing identifier references as a separate count.

Use one claim as one outcome in the defect rate. A claim with several missing references can expose all reference defects in details without counting multiple times in the claim-rate numerator. Comparisons should record the extractor model, prompt/schema version, and coverage constraints.

Changing the CLI and report format is cheap now, though PRODUCT and marketing language must change with it. After public drift reports are published, changing the denominator risks invalidating the GTM evidence and damaging credibility.

## Effectiveness and UX

The pipeline currently spends expensive model calls before the factual verification model is ready to use them. Every attempt performs the writer call, all applicable verifiers, one sequential reviewer call per persona, and then a separate claim-extraction call. A deterministic failure still pays for persona review, and a later claim-grounding failure causes another full attempt ([page-runner.ts:102](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:102), [review-page.ts:110](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:110)).

A more economical order is:

1. Writer returns MDX plus claim ledger.
2. Parse, anchor, source-resolve, and run cheap static checks.
3. Run only the verifiers required by the resulting obligations.
4. Retry factual failures.
5. Batch persona/editorial assessment once the factual draft is clean.
6. Run final topology checks.

Other avoidable costs and confusion:

- Every writer prompt includes up to 200 public symbols whether relevant or not ([write-page.ts:24](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:24)). Brief-driven retrieval or symbol tools would reduce input tokens and make dependencies more precise.
- File-level observed reads cause broad regeneration, while page-level provenance means the system cannot yet realize the promised block/section refresh granularity.
- A page footer containing every symbol from every consulted file creates citation fatigue; readers will stop inspecting it.
- The theme reports block counts while the product badge is specified in terms of verified claims. Those denominators should not be mixed.
- Review reasoning is left in the machine-local run journal, so a reader seeing “reviewed” cannot inspect why.

The current and recommended vocabulary are not equivalent:

| Current stored state | Reader sees | Problem | Better reader language |
|---|---|---|---|
| `proven` | verified | Too absolute; hides which property was checked | “12 of 18 factual claims checked,” with exact check names |
| `scored` | reviewed | No score; may be default or review may have failed | Separate “AI-reviewed for \<persona\>” assessment |
| `out-of-domain` | unverified | Conflates several causes and actions | “Needs maintainer input,” “No checker available,” or “Check unavailable” |
| `grounded` | implicit proof | Means only that a referenced name exists | “Source-linked” |

“Verified” can remain useful for a specific evidence result—“sample executed,” “API signature matched”—or for a page with genuinely complete claim coverage. `proven`, `scored`, and `out-of-domain` should not remain the user-facing correctness vocabulary, and probably should not remain a single internal enum either.

## What is genuinely good

- Claim entities with exact quote/prefix/suffix anchors are the right finest-grain unit; preserve them.
- Content-addressed symbol revisions and conservative invalidation are strong freshness primitives when kept separate from proof semantics.
- Harness-recorded model inputs and a committed manifest are the right raw materials for an auditable system.

## Open questions for the founder

1. Should 0.1.0 enforce “every factual claim is registered and checked or visibly unresolved” through a claim-aware writer contract, or narrow the promise to “we show which extracted claims were checked”?

2. Should a page ever show a single “verified” badge, or should the default reader surface always be explicit counts such as “12/18 checked · 1 issue · 2 need input”?

3. Should identifier existence be allowed to confer any correctness status, or only the separate “source-linked” state? I recommend the latter.

4. May any third-party verifier mint the same trust status as a built-in verifier, or must custom checks be labeled project-defined unless explicitly approved by policy?

5. Does a maintainer answer make a claim `owner-attested` and eligible to ship, or must deterministic-only pages remain the sole candidates for a full “verified” badge?

6. Should persona review remain mandatory on every page and retry, or become a separate configurable editorial assessment that runs only after factual checks pass?

7. Should the public benchmark remain defects per all extracted claims, or change before launch to defective claims per checked claims plus a separate checkability/coverage rate?

8. Should reader citations be attached inline to individual claims, or grouped by section with a page-level evidence explorer? A flat page footer should not remain the primary provenance UX.
