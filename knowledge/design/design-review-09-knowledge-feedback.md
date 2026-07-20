Verdict: these loops are convincing in a demo but will accumulate stale, globally applied context over months. The largest issue is not model quality; it is that knowledge and feedback have no durable scope, lifecycle, or dependency path back to the pages they should improve. Neither question-text hashes nor current symbol hashes are sufficient durable identities.

## Design problems

### 1. Tribal knowledge has no durable semantic identity

**Severity: fundamental**

**Why the current design is wrong**

The product requires answers to be keyed to a symbol/entity, but the actual primary key is a 16-character hash of normalized question text. `subjectSymbol` is merely optional frontmatter and is not used for lookup, deduplication, retrieval, or invalidation ([tribal-knowledge.ts:17](/C:/Projects/docstube/packages/core/src/pipeline/tribal-knowledge.ts:17), [tribal-knowledge.ts:102](/C:/Projects/docstube/packages/core/src/pipeline/tribal-knowledge.ts:102)). That means the thing with durable identity is the model’s phrasing, not the fact being learned.

The lexical paraphrase dedup is global and ignores subject. Two different symbols can generate similar questions and be merged; two phrasings of the same missing fact can still escape the threshold. Worse, a false match against an answered question can suppress the new need indefinitely, despite the comment claiming it merely costs one later ask ([tribal-knowledge.ts:34](/C:/Projects/docstube/packages/core/src/pipeline/tribal-knowledge.ts:34), [tribal-knowledge.ts:273](/C:/Projects/docstube/packages/core/src/pipeline/tribal-knowledge.ts:273)).

A current symbol hash would not be a sufficient replacement. It is a content-revision identity: ordinary declaration changes deliberately produce a new hash ([symbol-hash.ts:29](/C:/Projects/docstube/packages/codemap/src/symbol-hash.ts:29)). Durable tribal knowledge needs to survive compatible revisions while becoming suspect when the underlying concept materially changes.

There is also no first-class lifecycle for an answer: no scope, author in the knowledge record, validity range, supersession, conflict, or stale state. Writing the same question again overwrites the prior file.

**Concrete better design**

Introduce two versioned contracts:

- `KnowledgeNeed`: stable ID, missing-knowledge kind, semantic subject bindings, requesting entity/page references, original question, context snapshot, aliases, and status.
- `KnowledgeFact`: stable ID, answer/statement, explicit scope, author, answered revision, current source bindings, status, and `supersedes`.

Use a structured dedup key such as `subject logical identity + knowledge kind + missing field`. Treat lexical or embedding similarity as a suggested merge for the queue, never as permission to silently discard a need. An unresolved subject should deduplicate only within the requesting page/entity.

Represent a source subject as a durable logical binding plus its current symbol-revision hash. Symbol diffs can then rebind an unchanged concept or mark the fact `needs-revalidation`.

**Cost now vs after 0.1.0**

Now: high contract and storage work, but the existing fixture knowledge can be migrated mechanically.

After 0.1.0: very high. Committed knowledge files become a public data format, and lost authorship, overwritten answers, or false dedup decisions cannot be reconstructed.

---

### 2. Answers and feedback do not causally invalidate the docs they should improve

**Severity: fundamental**

**Why the current design is wrong**

Answering immediately marks a question resolved and stores the answer, but it does not mark any documentation as needing regeneration. Refresh determines affected pages only from source-symbol disappearance and observed file reads ([maintain.ts:101](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:101), [maintain.ts:301](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:301)). Instruction, criterion, glossary, and knowledge changes are outside that dependency calculation.

`refine` does not close this gap. It explicitly excludes tribal questions from its ranking and may never select the page whose question was answered ([refine.ts:138](/C:/Projects/docstube/packages/core/src/pipeline/refine.ts:138), [refine.ts:149](/C:/Projects/docstube/packages/core/src/pipeline/refine.ts:149)). Feedback submission likewise ends after appending a file; it creates no regeneration request or dirty dependency ([trpc-router.ts:354](/C:/Projects/docstube/packages/core/src/server/trpc-router.ts:354)).

Consequently, “incorporated on the next run” is not a dependable contract. A refresh with no relevant code change can leave the intended page untouched, while unrelated regenerated pages receive the globally injected answer.

**Concrete better design**

Make all generation context addressable and dependency-tracked. Each generation unit should record the IDs and hashes of:

- knowledge facts;
- writing policies;
- review criteria;
- glossary entries;
- relevant config and IA fragments.

Changing one of those artifacts marks its dependent generation units dirty. An answer should transition through `answered → propagation-pending → applied`, with the UI reporting “answer saved; 2 pages pending regeneration.”

For broad rules, scope controls fan-out. Project-wide changes may dirty every page, but the backlog should be explicit and budgeted rather than silently waiting for unrelated source changes.

**Cost now vs after 0.1.0**

Now: medium. The pipeline already records seed context, so this is an extension of the dependency model.

After 0.1.0: high. Users will already have learned that answering does not reliably change the docs, and retrofitting dependency history into existing shards will require conservative full regeneration.

---

### 3. Feedback is promoted into ungoverned global prompt text

**Severity: fundamental**

**Why the current design is wrong**

One feedback item is immediately generalized and appended to a project-wide file. The categorizer sees only the user text and opaque entity address—no selected prose, page brief, existing policies, glossary, config, or surrounding source ([feedback.ts:74](/C:/Projects/docstube/packages/core/src/server/feedback.ts:74), [feedback.ts:87](/C:/Projects/docstube/packages/core/src/server/feedback.ts:87)). It cannot reliably decide whether “too much detail here” means this block, this page, this persona, or the entire project.

The exactly-one taxonomy is also conceptually weak. A rule such as “installation guides must include rollback steps” should guide both writing and review. Routing it only to `instructions` means reviewers do not enforce it; routing it only to `criteria` forces an avoidable failed review/retry before the writer learns it.

The resulting files are timestamped append logs with no rule IDs, scope, status, deduplication, conflict handling, or undo. They are loaded as entire Markdown files ([context-files.ts:8](/C:/Projects/docstube/packages/core/src/pipeline/context-files.ts:8)). Once any learned criteria file exists, it replaces the built-in review criteria rather than composing with them ([review-page.ts:110](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:110)). Over time, this becomes an unbounded, contradictory prompt.

The promised category set is incomplete, and the shipped channels are not all effective:

- `config` is absent despite being promised in PRODUCT.
- `glossary` writes a note under `.docstube/glossary/`, but generation reads `glossary.yaml`; the header itself says to fold it manually.
- Only criteria and instructions actually reach prompt consumers ([feedback.ts:13](/C:/Projects/docstube/packages/core/src/server/feedback.ts:13), [feedback.ts:17](/C:/Projects/docstube/packages/core/src/server/feedback.ts:17)).

This is especially inconsistent with PRODUCT’s decision to defer cluster-and-threshold auto-promotion to v2: v1 currently auto-promotes every single item.

**Concrete better design**

Store immutable raw `FeedbackEvent` records first. Categorization should produce one or more typed proposals containing:

- intent;
- proposed scope;
- affected consumers;
- canonical wording;
- target operation;
- confidence and rationale.

Use a canonical `DocumentationPolicy` record from which writer instructions and reviewer assertions are derived, rather than two unrelated text channels. Defaults must always compose with learned policies.

For v1:

- default feedback scope to the selected entity or page;
- let the user explicitly choose broader scope;
- apply exact local feedback immediately;
- require confirmation before project-wide promotion;
- write terminology directly through the typed `glossary.yaml` editor;
- treat config feedback as a validated YAML patch preview, not prompt text.

V2 can promote repeated feedback after clustering and thresholding, as PRODUCT already proposes.

**Cost now vs after 0.1.0**

Now: medium. Feedback volume is still low and the current files can be discarded or imported as unscoped proposals.

After 0.1.0: very high. Free-form global rules will have accumulated without enough metadata to split, scope, supersede, or resolve contradictions safely.

---

### 4. Maintainer answers are globally injected without provenance or guarantee semantics

**Severity: fundamental**

**Why the current design is wrong**

Every stored answer is inserted into every writer prompt and described as “trustworthy, cite freely” ([write-page.ts:69](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:69)). Subject bindings do not restrict relevance. As the knowledge base grows, every page pays for every answer, and stale intent about one subsystem can influence unrelated content.

The manifest does not record which answers shaped a page. Page seed context currently records the codemap and brief, despite the actual prompt also containing personas, glossary, instructions, and maintainer knowledge ([page-runner.ts:146](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:146), [provenance-schema.ts:81](/C:/Projects/docstube/packages/contracts/src/provenance-schema.ts:81)). A reader cannot trace a “why” claim back to the maintainer answer, and refresh cannot invalidate it when that answer changes.

Maintainer testimony is also not deterministic proof. The three-level guarantee model already has the right place for it—out-of-domain—but the current path does not persist an attestation evidence type. “Trustworthy, cite freely” invites tribal assertions to become indistinguishable from code-grounded claims.

**Concrete better design**

Retrieve only knowledge relevant to the current generation unit through subject/entity bindings, scope, persona, locale, and version. Project-wide facts should be explicitly declared project-wide.

Add `knowledgeRefs` to generation lineage and claim provenance, including fact ID, revision/hash, author, and subject binding. A maintainer-backed claim should remain `out-of-domain` with an `attested-by-maintainer` evidence subtype. It can be fully usable documentation without being mislabeled as mechanically proven.

When a subject changes or disappears, mark the fact stale and either exclude it or surface a targeted confirmation question.

**Cost now vs after 0.1.0**

Now: medium. Prompt assembly and provenance contracts change, but there is little historical knowledge to migrate.

After 0.1.0: high. Existing generated claims may already depend on answers that cannot be traced or selectively invalidated.

---

### 5. A durable knowledge need should not be owned by the first page shard that asked it

**Severity: significant**

**Why the current design is wrong**

Flags on page shards are appropriate for current page-local verification state. They are a poor home for a cross-page knowledge need.

Global dedup means the first page that asks owns the only flag. Later pages with the same need are suppressed, but no association to those pages is added. The flag’s entity address is page-level even when a subject symbol was resolved ([tribal-knowledge.ts:284](/C:/Projects/docstube/packages/core/src/pipeline/tribal-knowledge.ts:284)). Removing or replacing the owning page can therefore orphan the only queue record.

All tribal flags—including resolved and dismissed history—are carried through future regenerations ([page-runner.ts:267](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:267)). The UI then deliberately lists resolved answers alongside open work ([flag-queue.tsx:47](/C:/Projects/docstube/apps/local-ui/src/flag-queue.tsx:47)). Over months, the exception queue becomes a knowledge-history browser, while still lacking an actual knowledge-management surface.

**Concrete better design**

Keep page-local verification flags in page shards, but store knowledge needs separately, for example:

```text
.docstube/questions/<need-id>.yml
.docstube/knowledge/<fact-id>.yml
```

Page shards should carry references to relevant need IDs, preserving branch-local context without making one page the owner. A need can then list every affected entity/page, survive page removal, and resolve all linked occurrences together.

The flag queue should show active work only. Resolved facts belong in a searchable Knowledge history with edit, supersede, stale, and provenance views.

**Cost now vs after 0.1.0**

Now: medium manifest and queue work.

After 0.1.0: high. Existing shards will contain mixed current exceptions and permanent Q&A history that needs migration and deduplication.

---

### 6. Queue actions do not reflect the semantics of different flag kinds

**Severity: significant**

**Why the current design is wrong**

The UI offers “Answer” and “Dismiss” for every open flag, not just tribal questions ([flag-queue.tsx:152](/C:/Projects/docstube/apps/local-ui/src/flag-queue.tsx:152)). The backend intentionally accepts answers for system flags ([trpc-router.spec.ts:278](/C:/Projects/docstube/packages/core/src/server/trpc-router.spec.ts:278)). Because the merge gate considers only `open` flags, changing a machine-detected system flag to `answered` removes it from the blocking set without re-running detection or creating a typed correction ([merge-decision.ts:12](/C:/Projects/docstube/apps/github-action/src/merge-decision.ts:12)).

An answer can be valuable—for example, “the Bazel files are vendored”—but it should produce a config/knowledge correction and a re-evaluation. It should not directly mutate a verification exception into a non-blocking status. Likewise, dismissal is currently an unrecorded permanent waiver with no reason, scope, or expiration.

**Concrete better design**

Give each flag kind its own transition model:

- Tribal knowledge: answer → create fact → propagate → resolve.
- Verification/system: view evidence → retry/re-evaluate; resolve only when the condition clears.
- Coverage: accept declared partial coverage or change scope through a typed policy/config operation.
- Structural change: accept or revert an IA/config diff.
- Guarantee downgrade: fix it or create an explicit waiver.

If v1 permits waivers, model them as auditable policy records with author, reason, scope, expiry, and visible trust impact. Do not encode them as generic `dismissed`.

**Cost now vs after 0.1.0**

Now: low-to-medium; mostly contracts, router procedures, and queue actions.

After 0.1.0: significant. Users may already rely on “answer” or “dismiss” as an undocumented way to bypass the auto-merge gate.

---

### 7. “Worst-first” refine ranks proxies, then rewrites without an objective

**Severity: significant**

**Why the current design is wrong**

Ranking uses:

1. count of open non-tribal flags;
2. proven-block ratio;
3. generation age.

Flag count ignores severity and duplication. Proven ratio measures verifier coverage and content shape, not documentation usefulness. Pages with no provable blocks are assigned a perfect ratio of 1, while review outcomes, user feedback, repeated failures, page importance, and expected repair cost are absent ([refine.ts:63](/C:/Projects/docstube/packages/core/src/pipeline/refine.ts:63), [refine.ts:79](/C:/Projects/docstube/packages/core/src/pipeline/refine.ts:79)).

Selection is not converted into an improvement objective. On its first attempt, `generatePage` receives no old flag details, pending feedback, selected weak criteria, or current MDX as an edit baseline. It starts a normal fresh write; only failures from that new attempt are attached on later retries ([page-runner.ts:104](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:104), [page-runner.ts:128](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:128)). The page may improve by chance, churn harmless content, or regress while consuming a writer call, one reviewer per persona, verifiers, and claim extraction.

**Concrete better design**

Rank actionable issues, not pages. A `RefinementCandidate` should carry:

- exact entity and current content revision;
- the finding, feedback, stale fact, or failed criterion to resolve;
- severity and age;
- repeat count;
- page/persona importance;
- estimated regeneration cost;
- affected downstream entities.

Prioritize expected verified defect reduction per token, with blocking severity as a hard lane above optimization work.

The first writer attempt should receive the current MDX plus the selected objectives and be instructed to make the smallest appropriate change. Stop when those objectives clear and no regression appears. A low proven ratio may remain a secondary discovery signal, but it is not itself a repair plan.

**Cost now vs after 0.1.0**

Now: medium; ranking and refinement task contracts need redesign.

After 0.1.0: medium technically, but expensive reputationally if users learn that `refine` means costly nondeterministic rewrites rather than directed improvement.

## Effectiveness and UX

- The maintainer queue lacks answerable context. It shows the question, optional model-written detail, and raw entity IDs, but not the relevant documentation excerpt, source symbol name/file/span, code context, affected pages, or the proposed sentence the answer would enable ([flag-queue.tsx:107](/C:/Projects/docstube/apps/local-ui/src/flag-queue.tsx:107)). Maintainers will need to leave the queue and reconstruct why the question was asked.

- `flag_question` makes both subject and “why it matters” optional. The model can therefore create a permanent human task with only a sentence of prose and no resolvable evidence ([tribal-knowledge.ts:198](/C:/Projects/docstube/packages/core/src/pipeline/tribal-knowledge.ts:198)). Require a knowledge kind, subject/evidence or explicit “project-wide,” and intended documentation impact.

- The queue has no severity, affected-count, owner, topic grouping, stale indicator, or open/history filter. Newest-first is inadequate once there are dozens of questions.

- Resolved tribal flags remain visible forever and are labeled “committed to knowledge,” even though that says nothing about whether any page has consumed the answer. Separate stored, propagation-pending, applied, stale, and superseded states.

- The GitHub PR comment says maintainers can resolve flags “by answering below,” but the traced implementation only renders that text; issue/PR comment answers are not ingested. Actual answer paths are the local UI and `docstube answer` CLI ([delta-report.ts:91](/C:/Projects/docstube/apps/github-action/src/delta-report.ts:91), [answer-command.ts:19](/C:/Projects/docstube/apps/cli/src/commands/answer-command.ts:19)). Either implement a strict bot-command workflow or display an executable CLI instruction instead.

- The persistent digest issue is a good notification location, but it presents raw entity and symbol hashes rather than source links, excerpts, affected pages, or an answer command. It is durable but not efficient triage ([delta-report.ts:112](/C:/Projects/docstube/apps/github-action/src/delta-report.ts:112)).

- Every feedback submission in “auto” mode pays for an agent call to choose among a tiny taxonomy, even though the result is applied irreversibly without preview. Spend the model call on scope, conflict detection, and a typed proposal—or use an inexpensive deterministic category suggestion.

- The flag queue polls every two seconds, while `flags.list` reparses all current page shards and locales. That is acceptable for fixtures but unnecessary I/O on a large documentation set; the architecture already calls for a SQLite-derived queue.

- Every writer prompt grows with all knowledge and instruction files. With `P` regenerated pages and `K` accumulated answers, the knowledge-token cost trends toward `P × K`, regardless of relevance.

- `refine` defaults to up to three whole-page rewrites, with reviewer calls per persona and a claim-extraction call, before it has established an actionable problem. The ranking should expose expected cost and target defect reduction before spending.

- Feedback success is reported as “routed to file,” an implementation detail. Users need “applies to this page,” “will affect 14 pages,” “pending regeneration,” and an undo/edit action.

## What is genuinely good

- Non-blocking `flag_question` capture is the correct autonomy posture; generation must not wait for a maintainer.

- Committed, diffable knowledge and branch-local references are worth preserving, even if questions should become first-class records.

- Keeping exception triage separate from optional review feedback is the right product distinction.

## Open questions for the founder

- Should maintainer answers remain visibly `out-of-domain / maintainer-attested`, or may a human answer ever elevate a claim to `proven`?

- Should one feedback item default to the selected entity/page, or immediately become a project-wide rule?

- Should answering a question trigger immediate targeted regeneration, or place affected pages in a visible dirty queue for the next scheduled run?

- Is GitHub intended to be an actionable answer surface with bot-command ingestion, or only a notification surface pointing to CLI/local UI?

- May a human waiver unblock a machine-detected flag, or must machine flags remain blocking until the condition is deterministically re-evaluated as clear?

- Should durable knowledge attach primarily to documentation concepts/entity lineage with current source bindings, or to source-symbol revisions and be re-asked whenever those revisions change?

- Should config feedback ship in 0.1.0 as validated, confirmable YAML patches, or should the category be removed from the v1 promise?

- Should `refine` optimize “worst page first,” or “highest expected verified improvement per token first”?

- For public documentation, should unresolved tribal questions be visible to readers, or only to maintainers through the queue/PR/digest surfaces?
