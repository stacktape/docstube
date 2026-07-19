The model is not ready to be treated as a durable identity contract. Kernel-minted sidecar IDs are the right foundation, but today they represent neither an immutable revision nor a safely maintained logical lineage. Under ordinary edits, the system can silently move an ID to different content, lose page identity on rename, churn every claim, and discard the only record that an old identity was removed.

## Design problems

### 1. A stable ID does not identify a stable revision

**Severity: fundamental**

**Why this is wrong**

Entity records mix three different lifecycles:

- Logical identity: “this is still the installation section.”
- Content revision: the exact text/structure currently attached to that identity.
- Evidence state: provenance, verification, and guarantee for that revision.

`EntityAddress` contains only version, locale, page ID, and entity ID—no revision or expected content digest ([entity-schema.ts:118](/C:/Projects/docstube/packages/contracts/src/entity-schema.ts:118)). Meanwhile, mutable text, anchors, guarantees, and provenance live directly on the current entity record ([entity-schema.ts:56](/C:/Projects/docstube/packages/contracts/src/entity-schema.ts:56), [entity-schema.ts:73](/C:/Projects/docstube/packages/contracts/src/entity-schema.ts:73)). Once matching reuses an ID, downstream consumers cannot distinguish “same logical entity, new revision” from “matcher attached this ID to the wrong content.”

Feedback makes this dangerous rather than merely untidy. It stores only the address and generalized text; it does not retain the reviewed revision, selected quote, content hash, or a resolvable thread ([feedback.ts:29](/C:/Projects/docstube/packages/core/src/server/feedback.ts:29), [feedback.ts:55](/C:/Projects/docstube/packages/core/src/server/feedback.ts:55)). A comment written about revision A can therefore appear attributable to revision B without any indication that the target changed.

Deletion is not modeled either. Matching returns a transient array of tombstoned IDs ([match-entities.ts:144](/C:/Projects/docstube/packages/core/src/entities/match-entities.ts:144)), but the generation pipeline takes only `.page` and discards that lifecycle result ([page-runner.ts:131](/C:/Projects/docstube/packages/core/src/pipeline/page-runner.ts:131)). The architecture’s promise that orphaned feedback is surfaced is consequently not backed by a persistent contract.

**Concrete better design**

Separate logical entities from immutable revisions:

```ts
type Entity = {
  id: EntityId;
  kind: EntityKind;
  parentId?: EntityId;
  state: 'active' | 'tombstoned';
  activeRevisionId: EntityRevisionId;
};

type EntityRevision = {
  id: EntityRevisionId;
  entityId: EntityId;
  contentHash: string;
  semanticHash: string;
  createdByRunId: RunId;
  guarantee: GuaranteeLevel;
  evidenceRef: EvidenceId;
};

type EntityLineageEvent = {
  relation: 'continued' | 'deleted' | 'split' | 'merged';
  from: EntityRevisionId[];
  to: EntityRevisionId[];
  confidence: number;
  matcherVersion: string;
};
```

Feedback targets should be a union of `site`, `page`, `logical-entity`, `entity-revision`, and `text-selection`. A revision-scoped target should include a content snapshot or quote selector so stale feedback remains understandable after deletion. Proof and guarantee must always attach to a revision, never merely to the logical ID.

**Cost now vs after 0.1.0**

Now: medium-to-high contract and manifest work, but no public migration burden.

After 0.1.0: very high. Every committed shard and feedback file will require migration, and prior wrong matches or discarded tombstones cannot be reconstructed reliably.

---

### 2. The content hierarchy is not a regeneration model

**Severity: fundamental**

**Why this is wrong**

The product assumes that because a page can be parsed into sections and blocks, those nodes are automatically safe regeneration units. They are not.

Sections are stored as a flat sequence with only a heading level, no parent ID, source span, provenance, context boundary, or regeneration policy ([entity-schema.ts:90](/C:/Projects/docstube/packages/contracts/src/entity-schema.ts:90)). Extraction assigns each block to the most recently seen heading ([extract-entities.ts:185](/C:/Projects/docstube/packages/core/src/entities/extract-entities.ts:185), [extract-entities.ts:209](/C:/Projects/docstube/packages/core/src/entities/extract-entities.ts:209)). Consumers then generally treat those flat section records independently rather than enforcing a nested subtree.

More importantly, “smallest granularity whose context is self-contained” is an architectural assertion with no data model behind it. Nothing records whether a block depends on its introduction, sibling examples, ancestor definitions, or a cross-page concept. Section entities cannot carry provenance at all; claim provenance is optional; block provenance is required but is not an explicit inheritance or dependency relationship. The maintain implementation acknowledges the consequence: v1 regenerates whole pages ([maintain.ts:32](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:32)).

A content entity and an atomic generation unit are different concepts. Treating them as identical will either produce incoherent patches or force permanent whole-page rewriting.

**Concrete better design**

Keep the content tree, but introduce explicit regeneration units and dependency edges:

```ts
type GenerationUnit = {
  id: GenerationUnitId;
  rootEntityId: EntityId;
  granularity: 'block' | 'section-subtree' | 'page';
  memberEntityIds: EntityId[];
  contextEntityIds: EntityId[];
  sourceDependencies: SourceDependency[];
  promptInputHash: string;
  patchStrategy: 'replace-node' | 'replace-subtree' | 'replace-page';
};
```

Sections should have explicit `parentId`, `order`, and revision-local source/render spans. Provenance should become a normalized dependency graph with explicit inheritance rather than differently optional fields on each entity kind.

The system should initially mint only page units unless a writer/component declares a smaller unit self-contained. “Block-level provenance exists” is not sufficient evidence that block-level generation is safe.

**Cost now vs after 0.1.0**

Now: high pipeline work, but it can be introduced incrementally while keeping page units as the default.

After 0.1.0: higher technically and commercially. Users will already have been promised cheap sub-page maintenance, while manifests will encode a hierarchy that cannot honor that promise.

---

### 3. Claims are locators, not durable propositions

**Severity: fundamental**

**Why this is wrong**

The claim contract omits the very data used to prove a claim. Claim extraction produces `identifiers`, but `ClaimEntity` stores only restated text, class, anchor, guarantee, and optional provenance ([extract-claims.ts:13](/C:/Projects/docstube/packages/core/src/audit/extract-claims.ts:13), [entity-schema.ts:56](/C:/Projects/docstube/packages/contracts/src/entity-schema.ts:56)). There is no canonical proposition fingerprint, persisted subject set, extractor version, or verification input.

Claim continuity is tied to the entire parent block being byte-identical. Matching carries all previous claims when the block hash is unchanged; otherwise it drops them all ([match-entities.ts:120](/C:/Projects/docstube/packages/core/src/entities/match-entities.ts:120)). Thus:

- A punctuation, Markdown emphasis, or wrapping edit remints every claim in the paragraph.
- A semantically unchanged claim cannot retain its feedback or metric lineage across a small prose edit.
- A carried claim cannot be independently re-grounded from its manifest record because its subjects were discarded.

The quote-plus-prefix/suffix structure is useful as a selector, but it is not claim identity. Resolution searches exact raw MDX page-wide and chooses the first occurrence on a context tie ([claims-stage.ts:25](/C:/Projects/docstube/packages/core/src/pipeline/claims-stage.ts:25), [claims-stage.ts:46](/C:/Projects/docstube/packages/core/src/pipeline/claims-stage.ts:46)). Formatting changes, JSX syntax, repeated sentences, or translation can make the same proposition move or become ambiguous.

Finally, claim discovery is model-driven and capped at 30 “load-bearing” claims per page ([extract-claims.ts:11](/C:/Projects/docstube/packages/core/src/audit/extract-claims.ts:11), [extract-claims.ts:26](/C:/Projects/docstube/packages/core/src/audit/extract-claims.ts:26)). Model or prompt changes can alter both IDs and the denominator of the public accuracy metric without the documentation changing materially.

**Concrete better design**

A claim needs three separate parts:

- Proposition identity: normalized proposition, class, subject/source selectors, semantic fingerprint.
- Text placement: parent block revision plus rendered-text quote selector, normalized position fallback, and ambiguity state.
- Evidence: verifier/extractor version, inputs, result, and run.

Reconcile claims independently of block identity using subject overlap, normalized proposition similarity, and parent lineage. Re-run evidence checks for every active claim whose source dependencies changed, even if its prose did not.

Use selectors over canonical rendered text, scoped to the parent block revision, with normalized Unicode/whitespace. Preserve quote+prefix/suffix as one fallback, not the sole locator. Report claim-extraction coverage and extractor version alongside the public metric.

**Cost now vs after 0.1.0**

Now: medium; both generated-doc claims and audit claims need a contract update.

After 0.1.0: very high. Claim IDs and metric histories already emitted under the current model will not be comparable or recoverable.

---

### 4. The matcher silently prefers false continuity over honest uncertainty

**Severity: significant**

**Why this is wrong**

The architecture says matching uses block type, structural path, and content similarity ([ARCHITECTURE.md:124](/C:/Projects/docstube/ARCHITECTURE.md:124)). The implementation instead uses exact section title/anchor, then position; and exact block hash, then unmatched ordinal ([match-entities.ts:14](/C:/Projects/docstube/packages/core/src/entities/match-entities.ts:14), [match-entities.ts:68](/C:/Projects/docstube/packages/core/src/entities/match-entities.ts:68)).

Realistic corruptions include:

- Insert a new paragraph before an edited old paragraph. The new paragraph can inherit the old paragraph’s ID, while the actual edited continuation receives a fresh ID.
- Delete the first section and rename the next same-level section. The renamed survivor can inherit the deleted section’s ID.
- Reorder duplicate callouts or examples. Exact-hash uniqueness disappears, leaving ordinal assignment to swap identities.

The “same anchor after title edit” pass is weaker than its comment implies because section anchors are regenerated from the new title ([extract-entities.ts:194](/C:/Projects/docstube/packages/core/src/entities/extract-entities.ts:194)). There is also no confidence score, ambiguity result, split/merge result, or persisted matcher version. The current tests cover happy continuity and deletion, not adversarial sibling insert/delete/edit combinations ([match-entities.spec.ts:22](/C:/Projects/docstube/packages/core/src/entities/match-entities.spec.ts:22)).

**Concrete better design**

Use conservative, constrained bipartite matching:

1. Hard constraints: kind, compatible stable block type, plausible parent lineage.
2. Strong signals: explicit component semantic key, claim subject fingerprint, unique semantic hash.
3. Soft signals: normalized content similarity, heading similarity, neighboring matched entities, structural path.
4. Require a minimum score and a winning margin over the second candidate.
5. On ambiguity, mint a new ID and tombstone the old one. Never use raw unmatched ordinal as sufficient evidence.
6. Persist match decisions and model split/merge lineage.

Plugin components should optionally provide a stable semantic `identityKey(metadata, content)` hook. They should not accept raw kernel entity IDs as an escape hatch.

**Cost now vs after 0.1.0**

Now: low-to-medium; mostly matcher, contracts for decisions, and adversarial/property tests.

After 0.1.0: high. A false match contaminates feedback and proof history silently, and later matcher improvements cannot determine which historical continuities were wrong.

---

### 5. Page identity is still slug identity in the operational path

**Severity: significant**

**Why this is wrong**

The design explicitly says page slug/path is mutable and never identity ([ARCHITECTURE.md:80](/C:/Projects/docstube/ARCHITECTURE.md:80)). The IA schema even has a kernel-assigned `pageId` for an existing page ([ia-schema.ts:11](/C:/Projects/docstube/packages/contracts/src/ia-schema.ts:11)).

Generation nevertheless locates previous pages by slug ([generate.ts:153](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:153), [generate.ts:219](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:219)). Renaming a slug therefore creates a new page ID; the old shard is later pruned as an orphan ([generate.ts:293](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:293)). Page-level feedback, frozen-version lineage, translation correspondence, and every descendant identity are lost at once.

This is a divided-authority design: IA declares a page ID field, the manifest stores page IDs, but slug matching currently decides continuity.

**Concrete better design**

Make `IaNode.pageId` authoritative once minted:

- First generation mints the page ID and writes it back through the comment-preserving IA editor.
- Subsequent generation resolves by page ID first.
- Slug changes update route/path attributes only.
- Unknown or duplicated page IDs are hard structural errors.
- Page deletion and replacement become explicit lifecycle operations rather than inferred from slug absence.

If derived IDs are considered inappropriate in `ia.yml`, introduce a separate stable IA-node key and persist its page binding in the manifest; a durable rename-independent key is still required somewhere.

**Cost now vs after 0.1.0**

Now: low. The contract field already exists.

After 0.1.0: high for affected repositories because identities lost during earlier renames cannot be reconstructed unambiguously.

---

### 6. The open block enum is extensible but not durable

**Severity: significant**

**Why this is wrong**

The open-enum principle is correct, but the persistent identifier is currently just a display-shaped string. `blockTypeSchema` accepts arbitrary lowercase names or `component:<Name>` ([entity-schema.ts:13](/C:/Projects/docstube/packages/contracts/src/entity-schema.ts:13)). The registry key for a plugin block is the globally unique component name ([block-registry.ts:7](/C:/Projects/docstube/packages/core/src/entities/block-registry.ts:7)), while the plugin contract records no stable type ID, schema version, metadata migration, or semantic identity function ([hook-types.ts:158](/C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:158)).

Consequences:

- Two ecosystems cannot independently evolve similarly named components.
- Renaming a renderer changes the persistent type and breaks matching.
- A plugin metadata-schema change reinterprets old committed shards using only the currently installed schema.
- Primitive-like unknown strings and registered component types follow different validation paths.
- The matcher has no component-specific identity signal for repeated structured blocks.

**Concrete better design**

Persist a namespaced type reference separate from the MDX renderer name:

```ts
type BlockTypeRef = {
  namespace: 'core' | 'npm:@scope/package';
  name: string;
  schemaVersion: number;
};
```

Registry entries should provide:

- metadata schema for each supported version;
- migrations between versions;
- renderer/component name;
- optional semantic identity key;
- optional content-normalization strategy.

Keep the enum open, but make every persistent extension owned, versioned, and migratable.

**Cost now vs after 0.1.0**

Now: medium; contract, registry, built-ins, and plugin SDK change.

After 0.1.0: high. The SDK is explicitly experimental, but committed manifests create a stronger compatibility burden than TypeScript semver alone.

---

### 7. Canonical identity and locale/version renditions are conflated

**Severity: significant**

**Why this is wrong**

The architecture defines the same entity ID across versions and locales as the same logical entity ([ARCHITECTURE.md:111](/C:/Projects/docstube/ARCHITECTURE.md:111)). Translation therefore requires exact structural isomorphism and copies IDs by position ([translate-page.ts:10](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:10), [translate-page.ts:49](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:49)).

That is too rigid for long-term localization. Legitimate translations can split paragraphs, restructure lists, add locale-specific clarification, or omit irrelevant content. The current model must reject all of those or falsely claim one-to-one identity. It is already inconsistent for claims: translated prose loses source claims whenever its content hash differs ([translate-page.ts:72](/C:/Projects/docstube/packages/core/src/pipeline/translate-page.ts:72)), so the supposed shared claim identity disappears in the normal translation case.

Feedback also needs to distinguish “change this German wording” from “change this concept in every locale.”

**Concrete better design**

Use two identities:

- `conceptId`: canonical logical content across versions/locales.
- `renditionEntityId`: the actual page/section/block/claim in one version and locale.

Persist explicit correspondence edges such as `translation-of`, `derived-from`, `split-from`, and `merged-from`. Feedback can then declare whether it targets one rendition or the canonical concept.

If exact isomorphic translation is a deliberate product constraint, document it as such and stop describing arbitrary translated nodes as independently addressable equivalents.

**Cost now vs after 0.1.0**

Now: medium-to-high because translation and addressing contracts change.

After 0.1.0: high; locale-specific feedback and non-isomorphic translations will already be encoded under an incorrect one-to-one assumption.

## Effectiveness and UX

- The fine-grained manifest currently saves no generation cost. Refresh explicitly regenerates whole pages ([maintain.ts:37](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:37)), while the review UI also admits that regeneration lacks a page-scoped run contract ([review.tsx:275](/C:/Projects/docstube/apps/local-ui/src/review.tsx:275)). Users pay whole-page writer, reviewer, verifier, and translation costs despite block/section IDs.

- Claim extraction is paid for before existing claims are ignored. The stage invokes the extractor for the entire page, then skips any block already carrying claims ([claims-stage.ts:99](/C:/Projects/docstube/packages/core/src/pipeline/claims-stage.ts:99), [claims-stage.ts:127](/C:/Projects/docstube/packages/core/src/pipeline/claims-stage.ts:127)). An unchanged regenerated page can consume a complete model call that attaches zero claims.

- Small prose edits generate noisy claim churn. Blocks may retain IDs positionally, but any content-hash change drops all nested claims. That destabilizes feedback links, claim counts, manifest diffs, and the public defect denominator.

- “Entity-anchored feedback” currently suggests more locality than exists. The anchor is stored as a comment, while learned instructions are loaded globally and every writer is told to follow all of them ([feedback.ts:55](/C:/Projects/docstube/packages/core/src/server/feedback.ts:55), [write-page.ts:63](/C:/Projects/docstube/packages/core/src/pipeline/write-page.ts:63)). A note on one block may become a project-wide rule with no explicit scope choice.

- The finest-grain entity is not the finest-grain feedback target in the current UX. Claims are displayed inside a block button but cannot themselves be selected; the selectable targets are page, section, and block ([review.tsx:34](/C:/Projects/docstube/apps/local-ui/src/review.tsx:34), [review.tsx:337](/C:/Projects/docstube/apps/local-ui/src/review.tsx:337)). That should either be corrected or the claim-level feedback promise narrowed.

- Wrong matching will be especially confusing because nothing visibly announces uncertainty. A user will see their old feedback associated with new content and reasonably assume docstube preserved the relationship intentionally.

## What is genuinely good

- Kernel-minted opaque IDs outside MDX are the right foundation; writers must not be identity authorities.
- Separating page identity from mutable slug/path and including locale/version in addresses are principles worth preserving.
- One shared entity graph for proof, feedback, and maintenance is right; redesign it as normalized linked records rather than one overloaded mutable record.

## Open questions for the founder

- Is feedback primarily a globally generalized learning rule, or a content-specific thread that must remain readable and resolvable against the exact reviewed revision?

- Is sub-page regeneration a 0.1.0 product promise, in which case generation units and dependency closure must be designed now, or should 0.1.0 explicitly promise page-level refresh only?

- On an ambiguous match, should docstube conservatively mint a new ID and surface orphaned feedback, or preserve continuity at the risk of attaching proof and feedback to the wrong content?

- Should `pageId` be durable generated state written into `ia.yml`, or should `ia.yml` remain intent-only with a separate stable IA-node binding in the manifest?

- Must translations remain structurally isomorphic to the source, or may locales diverge while retaining canonical concept relationships?

- Are plugin block-type identifiers expected to survive plugin renames and schema upgrades? If yes, should namespace, schema version, and migrations become part of the 0.1.0 SDK contract?
