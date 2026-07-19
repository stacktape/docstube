The verifier plugin contract is not ready for 0.1.0. It is a checker-running API, not a proof contract: it cannot state what proposition was checked, which evidence satisfied it, which checks are jointly required, or why a claim remains unchecked. That is incompatible with the binding decision that the badge means 100% of ledger claims received claim-class-appropriate evidence.

## Design problems

### 1. The contract verifies entities, not propositions — fundamental

**Why this is wrong**

A verifier declares only `proves: boolean`, receives pages, and returns arbitrary `coveredEntityIds`. There is no claim predicate, expected value, subject, evidence class, or proof obligation in the contract. The kernel consequently upgrades an entity when any passing “proving” verifier names its ID. This is existential `OR` aggregation, not proof composition. [hook-types.ts](C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:70), [findings-schema.ts](C:/Projects/docstube/packages/contracts/src/findings-schema.ts:25), [verify-page.ts](C:/Projects/docstube/packages/core/src/pipeline/verify-page.ts:176)

That creates category errors:

- Typechecking one block marks the block and every claim it contains as proven, regardless of whether those claims concern compilation, runtime behavior, defaults, or configuration. [code-typecheck-ts.ts](C:/Projects/docstube/packages/verifiers/src/code-typecheck-ts.ts:129)
- Parsing JSON/YAML likewise covers every claim in the block even though the verifier explicitly proves only syntactic well-formedness, not schema conformance. [sample-parses.ts](C:/Projects/docstube/packages/verifiers/src/sample-parses.ts:215)
- A code sample can become proven from typechecking alone when runtime execution is unavailable, contradicting “compile ≠ works.” [PRODUCT.md](C:/Projects/docstube/PRODUCT.md:184)
- New claims are currently attached after verification, so verifiers cannot even target the new claim ledger during their run. [page-runner.ts](C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:162), [page-runner.ts](C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:202)

The binding trust model already says shape claims may be grounded, while values and behavior require predicate-specific checks. The current API cannot express that distinction. [trust-model-v2.md](C:/Projects/docstube/knowledge/design/trust-model-v2.md:20)

**Concrete better design**

Split the API into two concepts:

1. `ArtifactCheckDefinition` for hygiene and structural gates: MDX compilation, prose linting, entity integrity, link integrity.
2. `ClaimVerifierDefinition` for evidence-producing checks.

A claim verifier should declare capabilities such as:

```ts
{
  claimClasses: ['behavioral', 'configuration'],
  predicates: ['returns', 'throws', 'default-equals', 'schema-conforms'],
  evidenceKinds: ['execution', 'schema-node'],
  targetKinds: ['claim'],
  localeMode: 'content-addressed'
}
```

The kernel should build a proof plan from the ledger and pass assigned `VerificationObligation[]`, each containing a claim ID, subject reference, predicate, expected value, source artifact, and locale/version/project dimensions. The verifier returns one structured outcome per assigned obligation, with reproducible evidence.

Proof policy must support conjunctions and alternatives. For example:

- Code sample: `typechecks AND executes`.
- Config sample: `parses AND conforms-to-schema`.
- Diagram: `compiles AND all nodes grounded AND all semantic edges grounded`.
- API shape: one authoritative extractor may satisfy the obligation.

Plugins must never upgrade whole blocks by returning arbitrary IDs.

**Cost**

Changing now is high but aligned with the already-mandated claim-ledger migration; the sequencing, provenance, badge, and manifest are being redesigned anyway. After 0.1.0, this becomes a public SDK break plus a manifest and badge-semantics migration, and previously “proven” pages may need revocation.

---

### 2. “Uncovered” is silence, not a first-class outcome — fundamental

**Why this is wrong**

The local instinct is correct: a missing package or binary does not prove a sample wrong. The global policy is not coherent.

Current outcomes vary by verifier:

- `no-exec` produces `pass`, no finding, and no coverage. [snippet-exec.spec.ts](C:/Projects/docstube/packages/verifiers/src/snippet-exec.spec.ts:137)
- A missing invoked CLI or imported package silently leaves a snippet uncovered. [snippet-exec.ts](C:/Projects/docstube/packages/verifiers/src/snippet-exec.ts:165)
- Missing Bash can make the entire run `skipped`. [snippet-exec.ts](C:/Projects/docstube/packages/verifiers/src/snippet-exec.ts:202)
- Missing ShellCheck also produces `skipped` with no findings. [shellcheck.ts](C:/Projects/docstube/packages/verifiers/src/shellcheck.ts:83)
- Loose D2 grounding produces `pass` with warnings and no coverage. [diagram-d2.ts](C:/Projects/docstube/packages/verifiers/src/diagram-d2.ts:217)
- Missing fence correspondence is a warning while the run still passes. [run-support.ts](C:/Projects/docstube/packages/verifiers/src/run-support.ts:57)

The kernel gates on error-severity findings, not on verifier status or missing obligations. A skipped or empty pass therefore does not necessarily create a coverage flag or stop a page from being classified as passed. [verify-page.ts](C:/Projects/docstube/packages/core/src/pipeline/verify-page.ts:173), [page-runner.ts](C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:284)

This violates “flagged, never silently wrong” whenever an expected checker could not run. It also makes the UI unable to distinguish “no checker exists,” “checker unavailable on this machine,” “explicitly waived,” and “not applicable.”

**Concrete better design**

Every planned obligation must end in exactly one kernel-validated disposition:

- `satisfied`
- `contradicted`
- `not-applicable`
- `waived` with recorded reason and policy source
- `no-checker-available`
- `environment-unavailable`
- `indeterminate`
- `checker-error`

Omission of an assigned obligation is itself `checker-error`. Verifier-level `pass/fail/skipped` should be derived summary data, never the policy input.

Routing should also differ:

- `contradicted` → retry the writer.
- `checker-error` → system flag; do not waste writer retries.
- `environment-unavailable` → coverage disposition, not a content defect.
- `waived` → visible exception, never silent.
- Unchecked required claims → no full badge and a policy-controlled auto-merge decision.

This directly implements the trust-model proposal to replace `out-of-domain` with explicit dispositions and to give every claim one outcome. [trust-model-v2.md](C:/Projects/docstube/knowledge/design/trust-model-v2.md:61)

**Cost**

Now: moderate once the obligation model exists. After release: high, because dashboards, CLI output, flags, badge counts, audit metrics, and committed manifests will all have encoded today’s ambiguous states.

---

### 3. The verifier truth surface cannot support the promised verification classes — fundamental

**Why this is wrong**

`VerifierContext` exposes a flat codemap, config, glossary, component registry, filesystem, and generic process execution. Content sources reduce OpenAPI/AsyncAPI into the same flat `SymbolRecord` shape. A symbol has an optional signature but no typed fields, defaults, constraints, relationships, command options, endpoint parameters, or schema paths. [hook-types.ts](C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:52), [hook-types.ts](C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:126), [symbol-schema.ts](C:/Projects/docstube/packages/contracts/src/symbol-schema.ts:28)

That surface is insufficient for the advertised v1 matrix:

- Behavioral assertions need inputs and an oracle, not merely exit code zero.
- Config-field existence/default/type claims need schema nodes and paths.
- JSON/YAML samples need selection of an owning schema.
- CLI flag claims need command/option models.
- Curl examples need OpenAPI method/path/parameter/body/auth facts.
- D2 edges need typed relations.
- Python and Java sample checks need composition with language-pack toolchains.

The language-pack contract does expose `snippetToolchain`, but verifier context cannot discover or invoke registered language packs. The two plugin extension systems do not compose. [hook-types.ts](C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:104)

Claim grounding demonstrates the limitation: only identifier-shaped tokens are checked, so paths and CLI flags are deliberately uncheckable, while configuration keys often lack a first-class codemap subject. [match-claims.ts](C:/Projects/docstube/packages/core/src/audit/match-claims.ts:44)

**Concrete better design**

Keep Codemap as the identity/change index, but stop treating it as the universal truth database. Add a typed `TruthProvider`/`EvidenceProvider` contract whose providers publish addressable facts:

- API symbols, members, signatures, parameter types, return types, defaults.
- Config schema nodes with canonical paths, types, constraints, and defaults.
- CLI commands, subcommands, positional arguments, and flags.
- Environment variables and required/optional semantics.
- OpenAPI operations, parameters, bodies, responses, and auth.
- File/module/import facts.
- Typed relations such as `contains`, `implements`, `calls`, `imports`, `handles-operation`.
- Language toolchain capabilities.

Claims should reference canonical fact IDs, not unqualified strings. Verifiers query a versioned `TruthIndex` or receive already-resolved evidence candidates. A generic sample verifier can then dispatch to the relevant language pack instead of hardcoding TypeScript and a few runtime languages.

For 0.1.0, publish an honest support matrix by predicate, not by verifier name. “Configuration shape checked; configuration defaults source-linked only” is defensible. “Nine verifiers” is not a meaningful trust statement.

**Cost**

Now: high, because language packs and content sources must emit richer facts. After release: very high; this changes the public plugin API, provenance identifiers, refresh invalidation, and the meaning of existing evidence.

---

### 4. Scope, applicability, and locale are descriptive labels rather than enforced dispatch — significant

**Why this is wrong**

The SDK says block verifiers receive matching blocks, but every verifier actually receives `PageArtifact[]`. `appliesTo` only asks whether at least one matching block exists; it does not filter targets or prevent the verifier from covering unrelated IDs. [hook-types.ts](C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:63), [verify-page.ts](C:/Projects/docstube/packages/core/src/pipeline/verify-page.ts:104)

Consequences:

- Every block verifier reparses MDX and reimplements block-to-source matching.
- The kernel cannot guarantee that returned coverage falls within the declared selector.
- `block`, `page`, and `site` do not define invocation shape or lifecycle.
- Enabling site scope runs site checks in addition to all block/page verifiers, so the “topology pass” can repeat work already done per page. [verify-page.ts](C:/Projects/docstube/packages/core/src/pipeline/verify-page.ts:121), [maintain.ts](C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:374)
- `source-only | per-locale` cannot express cross-locale checks, translation-invariant evidence reuse, or “rerun only if localized payload changed.” [hook-types.ts](C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:78)

**Concrete better design**

Make the host own dispatch:

- Block checks receive normalized `BlockArtifact[]` containing content, AST/source span, parsed metadata, claims, and address.
- Claim checks receive assigned obligations only.
- Page checks receive one page snapshot at a time.
- Site checks receive a partitioned documentation snapshot.

Expand selectors to claim classes/predicates, entity kinds, block schemas, languages/toolchains, and content-source kinds. Validate every returned obligation ID against the assigned set.

Replace binary locale scope with:

- `translation-invariant`: evidence can be reused only when payload and dependencies are content-identical.
- `each-locale`
- `source-locale-only`
- `cross-locale`
- `snapshot-partitioned`

The kernel should partition by version, locale, and project, then deduplicate identical content-addressed work.

**Cost**

Now: moderate. After release: high because existing plugins will have coded around the page-array behavior and raw-MDX reparsing.

---

### 5. The site verifier contract cannot deliver the promised topology pass — significant

**Why this is wrong**

The product promises links, orphans, contradictions, duplication, glossary, and nav consistency after partial regeneration. [PRODUCT.md](C:/Projects/docstube/PRODUCT.md:119), [PRODUCT.md](C:/Projects/docstube/PRODUCT.md:133)

The only site built-in is internal-link resolution, and it explicitly does not validate cross-page anchors. [internal-links.ts](C:/Projects/docstube/packages/verifiers/src/internal-links.ts:35) More importantly, a site verifier receives pages but not the IA/nav graph, route manifest, prior snapshot, changed set, structured fact claims, or claim-to-subject index. Contradiction detection over free prose cannot be deterministic.

**Concrete better design**

Define a `DocumentationSnapshot` contract containing:

- Pages, claims, routes, anchors, version/locale/project partitions.
- IA and navigation graph.
- Glossary and canonical-definition locations.
- Claim subjects and normalized predicates.
- Current evidence dispositions.
- Previous snapshot plus changed entity/fact set.

Then implement two lanes:

1. Deterministic graph checks: links, cross-page anchors, nav reachability, orphans, route uniqueness, glossary requirements, duplicate canonical definitions.
2. Claim consistency: claims sharing a subject and predicate can be compared deterministically when they assert structured literal values. Semantic contradictions that cannot be normalized remain AI-assessed and must not mint deterministic proof.

Incremental refresh should recompute cheap indexes globally and rerun expensive checks only on affected connected components.

**Cost**

Now: moderate-to-high, mainly in the claim ledger and manifest indexes. After release: high because the incremental-maintenance model and site-state contract will otherwise be built around page arrays that lack the required graph.

---

### 6. Plugin capability is conflated with authority to mint the public badge — significant

**Why this is wrong**

The architecture correctly dogfoods the same hook for built-ins and third parties, but the current policy also gives them the same proof authority. Any verifier may set `proves: true`; the kernel identifies provers by verifier ID and trusts returned covered IDs. Plugin capabilities declare only registration IDs, not evidence semantics or trust. [plugin-manifest-schema.ts](C:/Projects/docstube/packages/contracts/src/plugin-manifest-schema.ts:31), [verify-page.ts](C:/Projects/docstube/packages/core/src/pipeline/verify-page.ts:179)

That makes “proven” project-dependent without showing what standard was applied. It also conflicts with the provisional founder decision that plugin checks remain “project-defined” until explicitly promoted. [trust-model-v2.md](C:/Projects/docstube/knowledge/design/trust-model-v2.md:56)

**Concrete better design**

Keep one API path but separate capability from authority:

- Plugins emit evidence outcomes; only kernel policy decides whether that evidence satisfies a badge obligation.
- The host creates the result envelope, fixing plugin/verifier identity and assigned obligation IDs.
- Evidence records include package, version, package/config digest, tool version, inputs, and trust tier.
- Built-ins have default trusted capability profiles.
- Third-party evidence is labeled `project-defined` by default.
- Promotion is explicit in config and scoped to specific predicates/capabilities, not blanket trust of an entire package.

This preserves dogfooding without pretending all checks carry the same public meaning.

**Cost**

Now: low-to-moderate. After release: high reputationally and technically, because changing which plugin evidence counts could revoke public badges.

---

### 7. Snippet execution is not a proof-grade sandbox — significant

**Why this is wrong**

The current posture has useful controls—temporary working directory, timeout, and a scrubbed environment—but the code explicitly retains full filesystem and network access. `allow-env` restores full host-environment inheritance based on fence metadata authored by the writer model. [snippet-exec.ts](C:/Projects/docstube/packages/verifiers/src/snippet-exec.ts:24), [snippet-exec.ts](C:/Projects/docstube/packages/verifiers/src/snippet-exec.ts:65)

The harness research records OS sandboxing and network denial as deferred, while PRODUCT says samples “MUST execute in a sandbox.” [harness-research-findings.md](C:/Projects/docstube/knowledge/design/harness-research-findings.md:30), [PRODUCT.md](C:/Projects/docstube/PRODUCT.md:185)

A temporary directory is side-effect containment for well-behaved programs, not isolation. Bash or Node can still read user files, invoke other binaries, access local services, or exfiltrate data. Successful execution is also host-specific because there is no declared dependency or environment recipe.

**Concrete better design**

Move execution behind a dedicated kernel `SandboxRunner`, not generic plugin `exec`. Its evidence profile should record:

- Isolation mode and implementation.
- Runtime/toolchain versions.
- Dependency recipe or fixture image.
- Network policy.
- Read/write roots.
- Explicit environment-variable allowlist.
- Input fixtures and expected outputs/assertions.

Never permit model-authored metadata to inherit the whole environment. A fence may request named variables, but project policy must approve each name.

For 0.1.0, either require an actual container/OS sandbox for execution evidence, or disable unisolated execution by default and label opt-in host execution as non-badge “host-executed” evidence. Do not call it sandboxed proof.

**Cost**

Now: moderate. After release: implementation cost remains moderate, but the cost of a security incident or misleading sandbox claim is much higher.

---

### 8. “Verified diagrams” cannot be honestly shipped without relations — significant

**Why this is wrong**

PRODUCT requires every node and edge to map to a codemap symbol/relation. The current verifier compiles D2 and fuzzy-matches node names; it has no edge model, and Codemap has no relation schema. [PRODUCT.md](C:/Projects/docstube/PRODUCT.md:186), [diagram-d2.ts](C:/Projects/docstube/packages/verifiers/src/diagram-d2.ts:128), [symbol-schema.ts](C:/Projects/docstube/packages/contracts/src/symbol-schema.ts:28)

Loose mode deliberately lets ungrounded nodes produce a passing run with warnings. That is acceptable for an ordinary diagram feature, but not for a feature marketed as “verified diagrams.” [diagram-d2.ts](C:/Projects/docstube/packages/verifiers/src/diagram-d2.ts:8)

Name matching also proves identity weakly: two same-named symbols or a label that happens to equal a symbol do not establish that the diagram node denotes that symbol.

**Concrete better design**

Until relations exist, split the status into:

- D2 syntax-valid.
- Nodes partially grounded.
- Semantic verification unavailable.

Do not award a verified-diagram status.

For actual verification, parse every semantic node and edge into obligations. Require canonical subject mappings in the claim ledger or D2 metadata. Relations must refer to typed truth facts such as `imports`, `calls`, `contains`, or `handles-operation`. Conceptual actors such as “User” may be explicitly marked non-code/attested, but they still need a visible disposition. Make full grounding the default for any “verified” label; loose mode remains an ordinary non-proving diagram mode.

**Cost**

Now: moderate if the claim is narrowed; high if a relation graph is built. After release: the technical cost is similar, but retracting a flagship “verified diagrams” promise is reputationally worse.

## Effectiveness and UX

- The system repeatedly reparses raw MDX in several block verifiers because normalized block content and source spans are absent from the hook. This wastes CPU and makes independently written plugins disagree about what the target block is.
- The site pass can rerun block and page checks over all artifacts instead of running only topology checks. That will become conspicuous on large sites.
- Missing tools, missing dependencies, `no-exec`, and partial D2 grounding have different visible behavior despite representing the same user question: “Why was this not checked?”
- Verifier crashes and content contradictions both become error findings sent back to the writer. Rewriting the page cannot repair an unavailable tool or broken checker, so those retries waste tokens.
- Passing evidence is barely represented: `coveredEntityIds` cannot explain the predicate, tool version, inputs, sandbox profile, or output. The badge popover and CI-style timeline therefore cannot deliver the promised explainability.
- The current post-hoc claim extractor adds an agent call after every passing page. The binding claim-aware-writer decision should remove that cost while giving verifiers claims before they run.
- Runtime execution without dependency recipes will predictably spend time discovering that packages, CLIs, services, or fixtures are missing. Availability should be planned once per environment, not rediscovered per snippet.
- Binary locale scope either repeats checks unnecessarily or relies on implicit copying. Content-addressed evidence reuse would be faster and more defensible.

## What is genuinely good

- Built-ins and third parties sharing one registration path is worth preserving; authority policy should differ, not the implementation API.
- Separating hygiene checks with `proves: false` from evidence-producing checks is the correct instinct.
- Default environment scrubbing, temporary working directories, and timeouts are useful defense-in-depth controls even after a real sandbox is introduced.

## Open questions for the founder

1. For 0.1.0, should the 100% badge cover only shape/existence claims while behavior and values remain visibly source-linked, or must behavioral/config predicate verifiers ship before any page can earn the badge?
2. Should any `no-checker-available` or `environment-unavailable` claim block auto-merge, or may explicitly partial pages auto-merge with a visible coverage disposition?
3. Should third-party verifier evidence remain “project-defined” unless a project explicitly promotes individual capabilities, or count identically to built-ins by default?
4. Should runtime proof require a real sandbox and otherwise be unavailable, or should opt-in host execution ship as non-badge evidence?
5. Should “verified diagrams” be removed/narrowed for 0.1.0 until relations exist, or should the relation graph become release-blocking work?
6. Should deterministic cross-page claim consistency be part of 0.1.0, or should 0.1.0 guarantee only graph integrity while semantic contradiction checking remains a separately labeled AI assessment?
