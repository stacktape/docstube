The harness has the right control boundary but the wrong work-product protocol. It spends too much model effort navigating the repository, repeatedly rereading drafts, and performing plausibility reviews. It spends too little effort allocating evidence to pages, defining the intended reader, and producing a verifiable claim-aware artifact.

## Design problems

### 1. “Context assembly” is not actually per-page context assembly — fundamental

**Why:** PRODUCT requires “per-page source-grounded context,” but every writer receives the same first 200 public symbols, selected by codemap order rather than relevance. Each entry contains only kind, name, file, and line, even though the codemap already has signatures. A page about a later package in a monorepo may receive none of its important symbols and a large amount of unrelated API noise. The writer must reconstruct the real context through repository browsing. [PRODUCT.md:112](/C:/Projects/docstube/PRODUCT.md:112) [write-page.ts:24](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:24) [symbol-schema.ts:26](/C:/Projects/docstube/packages/contracts/src/symbol-schema.ts:26)

There is also no page-level topic ownership: no assigned symbols, exclusions, prerequisites, neighboring-page summaries, relevant tests/examples, or distinction between authoritative source and reference material. Independent writers can therefore duplicate the same concepts or omit topics while each appears locally compliant.

**Better design:** Introduce a typed, token-budgeted `PageContextPack` before writing:

- Page purpose, primary persona, reader outcome, prerequisites.
- Assigned topics and symbol hashes, plus topics owned by other pages.
- Relevant signatures, docstrings, source spans, tests, examples, schemas, CLI definitions, and specifications.
- Neighbor-page summaries and intended links.
- Source trust labels: code/spec, maintainer-attested, imported reference, generated output.
- Retrieval confidence and declared omissions.

Rank candidates using brief terms, path/module affinity, symbol containers, usages, tests, examples, and eventually codemap relations. Budget by estimated tokens and page depth, not by a count of 200 symbols. Preserve on-demand exploration for gaps.

**Cost:** Medium-high now: a context-pack contract, retrieval/ranking, and provenance changes. Higher after 0.1.0 because generated quality, cache identity, manifests, and existing IA files will already encode the weaker behavior.

### 2. Persona targeting is global, not a page contract — fundamental

**Why:** Personas exist only as a global config array. An IA node has no typed primary or secondary persona. The writer receives every persona with equal weight, and every persona reviews every page. [config-schema.ts:11](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:11) [ia-schema.ts:11](/C:/Projects/docstube/packages/contracts/src/ia-schema.ts:11) [write-page.ts:38](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:38) [review-page.ts:110](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:110)

That is not persona-targeted documentation. It is one artifact optimized for the intersection of all audiences. A beginner and a plugin author can legitimately want incompatible assumptions, depth, examples, and terminology; making both reviews gate the same page encourages averaged prose and defensive over-explanation.

The dogfood IA works around this with free-text such as “Audience: first contact,” but the system cannot enforce or route from that text. [ia.yml:4](/C:/Projects/docstube/ia.yml:4)

**Better design:** Add explicit page audience intent:

```text
primaryPersonas: [...]
secondaryPersonas: [...]
readerJob: ...
assumedKnowledge: [...]
```

Require IA proposals to assign it. The writer optimizes for primary personas. Primary reviews gate; secondary reviews are advisory unless the page is explicitly marked shared. The IA should also provide a persona journey—entry pages, prerequisites, and advanced branches—rather than merely reviewing every page through every persona.

**Cost:** Medium now: IA/config schema, wizard, prompts, and review routing. High after release because `ia.yml` is a user-owned public contract requiring migration, and existing repositories will already have generated “all-personas” pages.

### 3. Claims are discovered after prose instead of authored with it — fundamental

**Why:** Claims are extracted in another full model call only after deterministic verification and persona review have passed. Extraction is capped at 30 claims, may omit assertions, and can fail to zero claims with only a warning. [page-runner.ts:201](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:201) [extract-claims.ts:11](/C:/Projects/docstube/packages/core/src/audit/extract-claims.ts:11) [extract-claims.ts:66](/C:/Projects/docstube/packages/core/src/audit/extract-claims.ts:66)

This is both expensive and epistemically unsound: the system cannot claim complete checking when a second model chooses which claims count. False extraction also triggers a complete page retry. The dogfood run shows both failure modes: a page counted with zero claims, and large batches of false stale-reference findings for filenames and configuration keys. [journal.jsonl:25](/C:/Projects/docstube/.docstube/runs/run_hz8ejtszys3h1knze4n9/journal.jsonl:25) [journal.jsonl:72](/C:/Projects/docstube/.docstube/runs/run_hz8ejtszys3h1knze4n9/journal.jsonl:72)

**Better design:** Implement the binding trust-model decision: the writer submits MDX and a claim ledger in one artifact, with exact anchors, claim classes, and proposed evidence references. [trust-model-v2.md:9](/C:/Projects/docstube/knowledge/design/trust-model-v2.md:9)

A task-specific `submit_page` tool would be better than asking models to JSON-escape a long MDX document. The tool can validate the ledger during the session and return precise repair errors. Add a coverage linter that detects unregistered assertion-shaped prose—identifiers, defaults, numbers, modal behavior, and API statements—so omission from the ledger cannot silently manufacture “100%.” Keep post-hoc extraction only for foreign docs in `audit`.

**Cost:** High now, but already unavoidable for the revised trust model. Very high after public release because claim entities, badge semantics, cache artifacts, manifests, and the public accuracy claim would all need a breaking migration.

### 4. The four read tools are filesystem utilities, not evidence tools — significant

**Why:** `read_file`, `list_dir`, `glob`, and `grep` make the model perform repository archaeology one call at a time. There is no symbol lookup, usage/test/example lookup, batched source-range read, or draft/snippet preflight. [tools.ts:134](/C:/Projects/docstube/packages/agent-runtime/src/tools.ts:134) [tools.ts:167](/C:/Projects/docstube/packages/agent-runtime/src/tools.ts:167)

The provenance semantics are also inconsistent with what the model sees. `read_file` records an entire file hash even for a small line range, while `grep` reads and returns source lines without recording observed reads at all. [tools.ts:248](/C:/Projects/docstube/packages/agent-runtime/src/tools.ts:248) [tools.ts:303](/C:/Projects/docstube/packages/agent-runtime/src/tools.ts:303)

Tasks receive the entire repository as their read root. Generated docs, previous build output, and local state can contaminate source discovery. One dogfood writer actually read the generated `docs-site/content/en/writing-plugins.mdx`; that task reported 413,774 input tokens for 4,143 output tokens. [writer transcript:380](/C:/Projects/docstube/.docstube/cache/transcripts/2bd5bf709e1efb07662b87aee0d8aa4b7854731e8bcf50d701e0d9aaa5979e61.json:380) [writer transcript:962](/C:/Projects/docstube/.docstube/cache/transcripts/2bd5bf709e1efb07662b87aee0d8aa4b7854731e8bcf50d701e0d9aaa5979e61.json:962)

**Better design:** Keep generic tools as escape hatches, but make these primary:

- `search_symbols(query, kind, project, limit)`
- `read_symbol(hash, include: signature | body | tests | usages)`
- `find_examples` / `find_tests`
- `read_ranges([{file,start,end}, ...])`
- `check_snippet(language, code, context)`
- `validate_page_draft(mdx, ledger)`

All content-bearing results should emit evidence handles containing symbol hash or file/span/hash. Results need pagination and explicit token limits. Exclude `outDir`, `.docstube/cache`, `.docstube/runs`, and build output by default; reference docs should enter through an explicitly labeled context source.

**Cost:** Medium now. Medium-high later because tool descriptors affect cache keys, recorded transcripts, replay fixtures, vendor-MCP behavior, and any plugin-authored tasks.

### 5. Review is a costly plausibility judge, and the model controls gate policy — significant

**Why:** Each persona reviewer combines audience fit, brief conformance, and correctness risk. It receives the full page and generic repository tools, so every persona is expected to repeat the same source investigation. [review-page.ts:20](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:20) [review-page.ts:26](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:26)

In practice, source access does not make reviews grounded. A cached dogfood review used no tools, had no observed reads, and marked correctness met because claims were “plausible within the page itself.” It consumed 17,566 input tokens to provide that judgment. [review transcript:7](/C:/Projects/docstube/.docstube/cache/transcripts/0bb38ccfa3db6031d56a683fbd11fc5d87623b9b3998d8bcb454a1541dd92a87.json:7) [review transcript:18](/C:/Projects/docstube/.docstube/cache/transcripts/0bb38ccfa3db6031d56a683fbd11fc5d87623b9b3998d8bcb454a1541dd92a87.json:18) [review transcript:36](/C:/Projects/docstube/.docstube/cache/transcripts/0bb38ccfa3db6031d56a683fbd11fc5d87623b9b3998d8bcb454a1541dd92a87.json:36)

Criteria are free-form strings rather than stable typed IDs. The schema does not require one result for every configured criterion. More importantly, the model chooses whether a finding is an error; the kernel gates on error findings rather than required `not-met` outcomes. An invalid reviewer result becomes a warning and the page may ship. [findings-schema.ts:36](/C:/Projects/docstube/packages/contracts/src/findings-schema.ts:36) [page-runner.ts:184](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:184) [review-page.ts:95](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:95)

**Better design:**

- Remove factual correctness from each persona review. The claim ledger and deterministic evidence pipeline own correctness; optionally run one evidence-fed risk critic per page.
- Review only personas assigned to that page.
- Give reviewers the `PagePlan`, target persona, relevant excerpts, and claim/evidence summary—not the entire repository as the primary context.
- Define versioned criteria with stable IDs, applicability, `required | advisory`, and evidence requirements.
- Let the kernel map missing or `not-met` required criteria to gate failures. The reviewer supplies assessment, not policy.
- Anchor findings to exact page quotes or block IDs and include expected outcome and suggested repair scope.
- Route reviewer roles by both transport and model. The current `reviewModel` changes only the model on the already-selected transport, despite role configuration having a transport field. [config-schema.ts:55](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:55) [task-runner.ts:111](/C:/Projects/docstube/packages/core/src/pipeline/task-runner.ts:111)

**Cost:** Medium now. High later because the meaning of stored review records, UI status, auto-merge behavior, and “AI-reviewed for persona” labels will otherwise become public compatibility constraints.

### 6. Retry is an amnesic full-page rewrite with lossy findings — significant

**Why:** Every retry creates a new writer task, sends the complete previous MDX, repeats the global symbol list and durable context, and loses the prior session’s source-research state. [write-page.ts:79](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:79) [page-runner.ts:102](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:102)

Although `Finding` supports entity, span, suggestion, and structured data, the retry prompt retains only check, message, and optional filename. Verifier diagnostics and evidence are reduced to prose. [findings-schema.ts:10](/C:/Projects/docstube/packages/contracts/src/findings-schema.ts:10) [write-page.ts:80](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:80)

“Change nothing that was not flagged” is too rigid for coupled editorial problems, yet the actual output is another complete page—not a constrained edit. All reviewers and verifiers then rerun, even when a one-line example changed.

**Better design:** Create a structured repair packet:

```text
findingId
criterion/verifier
target block/claim
exact failing excerpt
expected invariant
actual result
source evidence
allowed repair scope
dependent blocks
```

Use a `repair-page` task that returns block/section replacements or a validated artifact diff. Reuse the PagePlan and relevant evidence pack rather than full repo discovery. Deterministically repair formatting/frontmatter where possible. Re-run only checks and persona criteria invalidated by the changed entities; escalate explicitly to `redraft-page` when the repair scope is structural.

Separate tasks remain the most portable cross-transport design, but the handoff must be compact and structured rather than “new agent plus old page.”

**Cost:** Medium now. Medium later technically, but every shipped month will accumulate cost expectations, retry journals, and eval baselines around the inefficient protocol.

### 7. One writer should own a page, but one monolithic generation call should not be universal — significant

**Why:** The current writer must research, outline, allocate coverage, compose, and register a complete page in one task. `overview | standard | deep` is merely inserted as a label; it does not define section count, reader outcomes, examples, source coverage, or output budget. [write-page.ts:104](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:104) [write-page.ts:115](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:115)

Defaulting to independent section writers would be worse: it would increase duplication, contradictions, and voice drift. The missing layer is planning, not necessarily more writers.

**Better design:** Keep one accountable page owner, but separate planning from drafting:

1. Build a source-backed `PagePlan` containing section goals, assigned evidence, examples, links, exclusions, and claim obligations.
2. For overview/standard pages, one writer produces the complete artifact from that plan.
3. For deep pages whose predicted source or output context exceeds a threshold, draft sections from disjoint context packs, then run one page editor/assembler for coherence and deduplication.
4. Review the assembled page, never independent section outputs.

For 0.1.0, the defensible scope is PagePlan plus one writer. Design the plan contract for later section fan-out rather than paying the multi-call cost immediately.

**Cost:** Medium now. Medium later because this is mostly internal, but delaying it makes current page quality and token usage the de facto product baseline.

### 8. Budgets cap calls, not work — significant

**Why:** Agent task budgets contain only maximum turns and tool calls. There are no input-token, tool-result-token, output-token, wall-time, per-task cost, or reserved-completion budgets. Writers use configurable 24/64 limits, while review and claims hardcode unrelated limits. [agent-task-schema.ts:46](/C:/Projects/docstube/packages/contracts/src/agent-task-schema.ts:46) [write-page.ts:125](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:125) [review-page.ts:67](/C:/Projects/docstube/packages/core/src/pipeline/review-page.ts:67) [extract-claims.ts:59](/C:/Projects/docstube/packages/core/src/audit/extract-claims.ts:59)

The run cap is checked only between pages. Once a page starts, it may consume three writers, every persona review on every attempt, and multiple claims calls. “Do not persist a half-verified page” is correct, but it does not require admitting work whose worst-case cost exceeds the remaining budget. [page-runner.ts:30](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:30) [generate.ts:215](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:215)

**Better design:**

- Add input, output, tool-result, wall-time, and per-task cost budgets.
- Estimate and reserve a page budget before starting: writer + required reviews + repair margin.
- Freeze before an attempt if the remaining run allowance cannot finish it. Keep partial work in the journal, not in the shipped shard.
- Allocate budgets by role and depth.
- Expose `economy | balanced | thorough` presets with a predicted range per page and persona.
- Either make `maxRunUsd` a hard admission-control cap or rename it to `targetRunUsd`; the current name implies stronger behavior than it provides.

**Cost:** Medium-high now because task/config schemas and orchestration change. High after release because users will rely on cap semantics in local runs and CI.

### 9. Durable feedback will become unbounded prompt sludge — significant over time

**Why:** Every Markdown file under criteria and instructions is loaded whole, and every writer receives every instruction and every maintainer knowledge answer. There is no scope, precedence, conflict detection, relevance filtering, or expiration. [context-files.ts:8](/C:/Projects/docstube/packages/core/src/pipeline/context-files.ts:8) [write-page.ts:66](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:66) [write-page.ts:69](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:69)

This will work for the first few feedback items and then degrade: prompts grow, rules contradict, irrelevant tribal knowledge appears on every page, and cache invalidation becomes unnecessarily broad.

**Better design:** Store durable context as structured policy cards with an ID, scope, priority, rationale, examples, author/source, and applicability such as persona, page glob, component, locale, or symbol. Retrieve only relevant cards for each PageContextPack. Attach maintainer answers only when the page’s assigned symbols or entities intersect their keys. Detect conflicts before generation.

**Cost:** Medium now. High later because public repositories will accumulate free-form files that require migration and users will depend on their accidental behavior.

## Effectiveness and UX

- The latest dogfood run recorded 56 completed agent tasks and nine scheduled retries; summing its reported task usage gives approximately 6.64 million input tokens. It still finished flagged. This is not an edge-case cost profile—it is docstube documenting six primary pages with two personas. [journal.jsonl:1](/C:/Projects/docstube/.docstube/runs/run_hz8ejtszys3h1knze4n9/journal.jsonl:1) [journal.jsonl:186](/C:/Projects/docstube/.docstube/runs/run_hz8ejtszys3h1knze4n9/journal.jsonl:186)

- With three attempts and two personas, one page can invoke up to three writers, six reviewers, and three claim extractors: 12 model calls before translation. Persona count therefore acts as a hidden cost multiplier.

- Reviewers are run sequentially, and deterministic verification finishes before review starts. The architecture diagram says review and verify are parallel, but blindly parallelizing them would still waste review calls on mechanically broken drafts. The better schedule is cheap structural/ledger checks first, then bounded parallel reviews for target personas only. [page-runner.ts:162](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:162)

- The writer cannot preflight examples through the same deterministic machinery that later rejects them. A malformed code sample therefore pays for a whole reviewer fan-out before becoming another full-page writing attempt.

- `reviewModel` is confusing as a quality control. The design rationale recommends a different model family, but the active knob is only a model string on the same transport. Users cannot tell whether they purchased genuine reviewer independence or merely a cheaper correlated judge. [harness-research-findings.md:25](/C:/Projects/docstube/knowledge/design/harness-research-findings.md:25)

- `depth: deep` looks like a meaningful user control but has no predictable effect on page length, sources, examples, token use, or review rigor.

- Retry findings such as claim-grounding false positives are presented as page failures even when the underlying issue is the extractor’s ontology. Users will perceive the writer as repeatedly failing when the pipeline is actually arguing with its own post-hoc classifier.

## What is genuinely good

- Keep the harness-owned tool boundary, transcripts, caching, and observed-read collection; do not return orchestration to vendor CLIs.
- Keep deterministic verification and persona/editorial assessment as separate artifacts rather than collapsing them into one opaque judge score.
- Keep one accountable page editor and bounded retries; redesign the context and repair protocol without losing page-level coherence.

## Open questions for the founder

1. Must every page declare a primary persona, with secondary personas advisory, or should shared pages continue trying to satisfy every configured persona?

2. Is a completed persona review required for auto-merge, or may a page ship unreviewed as long as the UI withholds the “AI-reviewed” label?

3. Should `correctness-risk` disappear from persona reviews in favor of one evidence-fed risk critic, or should every persona continue judging factual risk independently?

4. For claim completeness, should factual spans be explicitly annotated in the authored artifact, or is a sidecar ledger plus an independent coverage linter sufficient?

5. For 0.1.0 deep pages, should docstube ship adaptive section drafting plus a final page editor, or ship PagePlan + one writer and defer section fan-out until evals demonstrate the need?

6. Should `maxRunUsd` become a hard pre-admission cap that may freeze before a page, or remain an approximate target that is allowed to finish an expensive in-flight page?

7. May prior generated docs ever be treated as source context, or should they be excluded unless explicitly configured as untrusted reference material?

No files were modified.
