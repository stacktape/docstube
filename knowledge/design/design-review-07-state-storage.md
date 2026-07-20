The committed/local boundary is sound, but the current representation is not ready for the promised versioning, monorepo, or 500-page × 5-locale cases. The 2,500-file count alone is acceptable for Git; the replicated proof payload, missing publication boundary, and absence of a real snapshot model are the release risks.

I would either redesign frozen versions and monorepo identity before 0.1.0, or explicitly remove those support claims and the version switcher from 0.1.0.

## Design problems

### 1. A “frozen version” is not a publication snapshot

**Severity: fundamental**

**Why it is wrong**

The cut operation copies whichever current page shards exist, skips absent locale shards, and records only a label and timestamp. It does not freeze MDX, a page/locale availability matrix, navigation, route resolution, verification inputs, or search metadata. Re-cutting deletes the old shard tree and silently replaces it rather than creating an auditable revision. [version-cut.ts](/C:/Projects/docstube/packages/core/src/state/version-cut.ts:30)

State ownership is also split. A cut writes version metadata into the manifest, while normal generation reconstructs the versions list from `docstube.yml`, discarding cut-specific metadata such as `cutAt`. [generate.ts](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:298)

Emission reads only current MDX and shards, reduces frozen versions to labels, and explicitly admits that frozen content routes are deferred. [emit-current-site.ts](/C:/Projects/docstube/apps/cli/src/commands/emit-current-site.ts:62) [emit-site.ts](/C:/Projects/docstube/packages/theme/src/emit-site.ts:45) There is not even a public cut/repair/list command; `docstube version` only prints the tool version. [cli-help.ts](/C:/Projects/docstube/apps/cli/src/cli-help.ts:4)

The result is a switcher over labels, not a versioned documentation system.

**Concrete better design**

Create an immutable `PublicationRevision`:

- A revision ID and exact source revision—or a monorepo release set.
- Its own page index, locale set, and resolved route matrix.
- Per-address content hash, proof-ledger hash, localization state, and availability.
- Snapshot-owned navigation, redirects, search inputs, and canonical metadata.
- Input/toolchain fingerprints sufficient to reproduce or validate the publication.
- An explicit predecessor when repairing a frozen version.

A cut should stage and validate the complete revision, write immutable content-addressed objects, then atomically move the version label pointer to the new revision. A repair creates a successor revision; it never destroys the old one. The emitter should consume the revision catalog and emit current and frozen routes from the same mechanism.

Ship `docstube versions cut|list|repair|remove`. Until that exists, do not render a version switcher.

**Cost now vs after 0.1.0**

Now, this is a substantial private-schema and emitter redesign. After release, version URLs, frozen content semantics, SEO, and committed snapshots become compatibility promises; correcting them would require repository migrations and potentially change already-indexed public routes.

### 2. The manifest is not actually a lockfile for the published documentation

**Severity: fundamental**

**Why it is wrong**

A lockfile must bind published output to the complete inputs and evidence that justify it. The current index records a source-locale MDX path and global config/IA hashes. [manifest-schema.ts](/C:/Projects/docstube/packages/contracts/src/manifest-schema.ts:19) [manifest-schema.ts](/C:/Projects/docstube/packages/contracts/src/manifest-schema.ts:43) A page shard records the entity tree, source commit, timestamp, and flags, but no whole-MDX hash, publication status, or exact input revision. [manifest-schema.ts](/C:/Projects/docstube/packages/contracts/src/manifest-schema.ts:62)

Consequences:

- Edited or stale MDX can remain paired with still-“proven” sidecar state.
- Glossary, criteria, instructions, localization policy, component contracts, and other page inputs are not a complete invalidation closure.
- A crash can leave a mixture of new MDX, new shards, and an old index because output, shard, and index are promoted separately. [generate.ts](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:208)
- Assembly independently looks for a shard and MDX and silently skips missing pairs instead of verifying a publication record. [emit-current-site.ts](/C:/Projects/docstube/apps/cli/src/commands/emit-current-site.ts:62)

Git makes a final committed PR atomic, but the state model cannot determine whether the working tree being previewed or committed represents one complete generation revision.

**Concrete better design**

Every published `version × locale × page` address should point to a record containing:

- `contentHash` for exact MDX bytes.
- `entityLedgerHash` and proof/evidence hashes.
- `inputFingerprint`, built from relevant source dependencies, IA node, glossary terms, criteria/instructions, component contracts, and generator/verifier versions.
- `status: candidate | published | stale | failed`.
- The run and publication revision that promoted it.

Write candidates into a staging revision. Validate all hashes and cross-page invariants there, then promote one small current-revision pointer. Materialize the generated site from that revision and maintain a managed-file inventory so preview, CI, and Git all see the same publication.

Dirty working trees should be represented by content fingerprints, not falsely attributed solely to `HEAD`.

**Cost now vs after 0.1.0**

Now, the pipeline and schema can change without migration obligations. After release, existing badges cannot be proven to match their MDX, and adding this invariant would require revalidating or regenerating every committed page.

### 3. Monorepo support has a field, not a model

**Severity: fundamental**

**Why it is wrong**

The architecture acknowledges that monorepo design is still pending and relies on the fact that symbols carry a `project` string. [ARCHITECTURE.md](/C:/Projects/docstube/ARCHITECTURE.md:290) That is insufficient:

- `project` exists on `SymbolRecord`, but provenance references only a symbol key and file, with no stable project identity. [symbol-schema.ts](/C:/Projects/docstube/packages/contracts/src/symbol-schema.ts:26) [provenance-schema.ts](/C:/Projects/docstube/packages/contracts/src/provenance-schema.ts:36)
- The symbol digest excludes project and file. Identical declarations in identical container paths in two packages can produce the same provenance key. [symbol-hash.ts](/C:/Projects/docstube/packages/codemap/src/symbol-hash.ts:38)
- The configuration has one site, one current version, one frozen-version list, one locale policy, and one output directory; it has no project registry or docset ownership. [config-schema.ts](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:90) [config-schema.ts](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:151)
- Coverage, refresh scope, flags, and cuts therefore cannot be partitioned by package.
- A scalar version label cannot describe independently released packages.

This breaks especially badly in monorepos where shared overview pages depend on several projects or where packages have independent release trains.

**Concrete better design**

Introduce stable `projectId` and `docsetId` concepts:

- A project registry with stable IDs, roots, source globs, package metadata, ownership, and release/version provider.
- Project identity in the source key or as a mandatory part of a composite provenance address.
- IA pages owned by one docset or explicitly declared as multi-project aggregate pages.
- Coverage and dependency graphs partitioned by project.
- Shared glossary/theme/site policy at repository level, with controlled per-docset overrides.
- A version snapshot expressed either as a site-wide release train or a `releaseSet` mapping project IDs to commits/tags/package versions.

Do not mint committed provenance with the current source-key format for a publicly supported monorepo.

**Cost now vs after 0.1.0**

Now, this changes private contracts and invalidates only dogfood state. After release, adding project identity changes committed provenance keys, reverse maps, coverage, version addresses, and potentially all page dependencies—effectively a full regeneration and state migration.

### 4. The shard payload grows multiplicatively; YAML is the wrong bulk format

**Severity: significant**

**Why it is wrong**

Git can handle 2,500 files. The problem is what those files contain.

Each page-locale shard embeds a complete page entity tree, nested claims, provenance, observed reads, verifications, reviews, guarantees, and flags. [entity-schema.ts](/C:/Projects/docstube/packages/contracts/src/entity-schema.ts:103) [provenance-schema.ts](/C:/Projects/docstube/packages/contracts/src/provenance-schema.ts:82) Frozen versions then copy those full shards again. [ARCHITECTURE.md](/C:/Projects/docstube/ARCHITECTURE.md:174)

The dogfood state provides a useful scale signal: its six source-locale shards total 242,103 bytes, averaging 40,350 bytes in [.docstube/manifest/pages/en](/C:/Projects/docstube/.docstube/manifest/pages/en). A linear projection to 2,500 addresses is about 101 MB for the live manifest alone. Each complete frozen version adds roughly another 101 MB before generated MDX. Git delta compression will reduce repository-object cost, but not checkout size, filesystem traversal, YAML parsing, antivirus overhead, or PR diff volume.

Much of that data is locale-neutral or unchanged across versions. Replicating source proofs and entity identity into every rendition is denormalization at the most expensive dimension.

YAML is appropriate for hand-edited intent. It is a poor bulk format for generated proof ledgers: slower parsing, more syntax surface, larger output, and no comment-preservation benefit because these files are machine-owned.

The claimed merge tolerance is also narrower than advertised. A source-page update eventually touches every locale shard for that page, and a human flag answer rewrites the same large generated file.

**Concrete better design**

Use a thin, content-addressed committed state:

- Small canonical JSON address records for current page-locales.
- Immutable canonical JSON objects keyed by hash for entity trees, proof ledgers, and localization evidence.
- A source-locale canonical page/proof object stored once.
- Locale rendition objects referencing that canonical revision and containing only localized fields and localization assurance.
- Frozen snapshot catalogs referencing existing objects instead of copying them.
- Human answers and decisions in a separate small committed overlay, rather than inside machine-generated proof blobs.
- A semantic PR summary for human review of pointer/proof changes.

Keep YAML for `docstube.yml`, `ia.yml`, glossary, criteria, and other human-owned intent. Use strict canonical JSON for machine-owned state.

**Cost now vs after 0.1.0**

Now, this is a substantial but bounded manifest-store rewrite. After release, it requires migrating committed directory layouts and leaves historical repository bloat that ordinary migrations cannot remove from Git history.

### 5. JSONL is a good journal format, but the event contract cannot resume work

**Severity: significant**

**Why it is wrong**

The architecture promises typed stage artifacts persisted in the journal, input-hash skipping, and a dashboard that can show actual agent output. [ARCHITECTURE.md](/C:/Projects/docstube/ARCHITECTURE.md:341)

The implemented events do not contain enough information:

- `stage-completed` records only an input hash and duration.
- `task-completed` records only task ID and usage.
- Neither records an output artifact, output hash, cache key, transcript reference, attempt identity, locale, or version. [run-events-schema.ts](/C:/Projects/docstube/packages/contracts/src/run-events-schema.ts:42)
- The reducer produces only page status, completed input hashes, and run outcome. [run-journal.ts](/C:/Projects/docstube/packages/core/src/state/run-journal.ts:103)

There is therefore nothing durable to reuse when resuming a completed stage. Full agent outputs live only in the cache, which is ignored, unbounded, and not linked from journal events. A cache miss or cleanup would erase the “actual output” behind an old timeline.

**Concrete better design**

Retain JSONL as the append-only audit stream, but make it reference durable run artifacts:

- Stable job identity: project/docset, version, locale, page, stage, attempt.
- Input fingerprint and output artifact hash.
- Transcript/result/findings references.
- Parent attempt and retry reason.
- Candidate/published disposition.
- Terminal state and checkpoint eligibility.

Store artifacts under `.docstube/runs/<runId>/objects/`, preferably compressed and content-addressed. Resume should replay the journal, verify referenced artifacts, and skip only a completed job with a matching input fingerprint and intact output.

Project the events into SQLite for dashboard queries; do not put full transcripts inline in JSONL.

**Cost now vs after 0.1.0**

Now, this is a moderate event-contract and scheduler change. After release, old journals cannot be made resumable retroactively, and UI/API consumers may already depend on the underspecified event shapes.

### 6. Deferring SQLite makes the main UX scale linearly with every shard

**Severity: significant**

**Why it is wrong**

The architecture correctly assigns flag queues, entity lookup, reverse provenance, jobs, and timelines to a rebuildable SQLite projection. [ARCHITECTURE.md](/C:/Projects/docstube/ARCHITECTURE.md:196) The implementation instead repeatedly folds raw files:

- Listing flags reads and parses every current page-locale shard. [trpc-router.ts](/C:/Projects/docstube/packages/core/src/server/trpc-router.ts:168)
- Finding one flag repeats the same full scan. [trpc-router.ts](/C:/Projects/docstube/packages/core/src/server/trpc-router.ts:232)
- Listing runs reads every entire journal merely to inspect its head and tail. [trpc-router.ts](/C:/Projects/docstube/packages/core/src/server/trpc-router.ts:121)
- Timeline queries reparse complete journals.

At 2,500 approximately 40 KB shards, opening the flag queue can require parsing roughly 100 MB. The flag queue is the only intended human exception surface, so this is not an obscure administrative path.

**Concrete better design**

Implement the local SQLite projection before 0.1.0:

- Tables for manifest revisions, addresses, entities, source dependencies, flags, runs, jobs, event offsets, and cache metadata.
- Incremental projection keyed by file hash and journal byte offset.
- Transactions and WAL for live dashboard updates.
- A recorded projection schema version and originating manifest revision.
- Automatic rebuild on absence, mismatch, or corruption.
- No authoritative state that exists only in SQLite.

All control-plane queries should use indexed SQLite reads; filesystem state remains portable truth.

**Cost now vs after 0.1.0**

Now, this is a moderate implementation using an architecture already chosen. After release, the database is still locally replaceable, but filesystem-scanning assumptions may have spread through the UI/API and users will already have experienced the worst performance.

### 7. The transcript cache conflates reuse, provenance, and debugging

**Severity: significant**

**Why it is wrong**

The cache stores one pretty-printed full transcript per cache key, including all turns and tool output. It has no size cap, age policy, index, compression, garbage collection, or user-facing management. [cache.ts](/C:/Projects/docstube/packages/agent-runtime/src/cache.ts:6)

This checkout already has 204 entries totaling about 11 MB, averaging 53.9 KB in [.docstube/cache/transcripts](/C:/Projects/docstube/.docstube/cache/transcripts). A 500-page multilingual run can produce thousands of writer, claim, persona-review, and translation tasks; repeated runs can readily grow into gigabytes.

The generic key also operates at whole-task granularity. One changed block invalidates a whole-page translation or review transcript. On every potential hit, the harness rereads all observed files to validate freshness, causing repeated I/O across related tasks. [harness.ts](/C:/Projects/docstube/packages/agent-runtime/src/harness.ts:304) Full transcripts are simultaneously being treated as reusable results, provenance inputs, replay material, and historical diagnostics, even though those roles have different retention requirements.

**Concrete better design**

Split it into:

- `TaskResultCache`: compact result, input fingerprint, dependency set, usage, and evidence summary.
- `TranscriptArchive`: optional compressed diagnostic trace with explicit retention.
- Domain-specific durable caches, such as localization units, where the reuse unit is smaller than a whole agent task.

Use SQLite for cache metadata and LRU accounting. Enforce configurable total-size and age limits, pin active-run artifacts, and provide `docstube cache status|prune|clear`. Replay fixtures remain separately committed and never participate in eviction.

Use a shared source-fingerprint index so multiple cache hits do not independently reread and hash the same files.

**Cost now vs after 0.1.0**

Now, the cache is private and can be invalidated once. After release, changing cache semantics is still feasible, but users may experience unexplained disk growth and lose confidence in whether cleanup is safe.

### 8. Committed-state evolution has version numbers but no migration protocol

**Severity: significant**

**Why it is wrong**

The architecture calls these contracts “load-bearing walls” and says explicit schema versions permit evolution. [ARCHITECTURE.md](/C:/Projects/docstube/ARCHITECTURE.md:15) In practice, index and shard readers parse directly against schemas containing `schemaVersion: literal(1)`. [manifest-schema.ts](/C:/Projects/docstube/packages/contracts/src/manifest-schema.ts:43) There is no version dispatch, migration registry, minimum-reader declaration, or transactional migration path; an incompatible file is simply reported as corrupt. [manifest-store.ts](/C:/Projects/docstube/packages/core/src/state/manifest-store.ts:16)

The journal has no file-format header or event-schema version either. After an upgrade, old incomplete runs can become unreadable precisely when resume or debugging matters most.

Because state is committed, “0.x may break” is not enough. Users still need stable IDs, flags, feedback anchors, and frozen versions carried forward.

**Concrete better design**

Add a versioned envelope and migration layer:

- `format`, `formatVersion`, `writerVersion`, and `minReaderVersion`.
- Read old versions with their original schema, then apply deterministic pure migrations.
- Refuse future formats rather than silently stripping unfamiliar data.
- `docstube state migrate` stages a reviewable Git diff and preserves stable IDs.
- Golden migration tests for every released format.
- A journal header with its own version; resumable jobs should record the docstube version and job-contract version.

Immutable snapshot objects may remain in their original format if readers support them; otherwise migration should materialize successor objects without destroying historical revisions.

**Cost now vs after 0.1.0**

Now, the framework is inexpensive because there is only one unreleased format. After 0.1.0, the first state-schema change becomes an emergency migration with real user repositories and potentially irreplaceable feedback history.

## Effectiveness and UX

- The current version switcher advertises a capability whose content routes do not exist. That is more damaging than omitting versioning from 0.1.0.

- A complete five-locale source-page update eventually changes five proof shards plus generated content; PRs will be dominated by derived-state noise rather than the verified delta users care about.

- Committed timestamps and repeated evidence records create diffs even when the semantic proof is unchanged. Timestamps belong in run/snapshot metadata, while proof objects should be content-addressed.

- Flag listing and answering become slower in direct proportion to page × locale count. Users will feel this on the one surface where the product explicitly asks for human attention.

- Historical dashboard output is not actually historical: it depends on an unrelated cache entry continuing to exist.

- Version cuts parse and rewrite every current shard serially, then duplicate them. A content-addressed cut should mostly write a small catalog referencing existing objects.

- Cache validation can reread the same large source files for multiple task hits in one run; a shared dependency-fingerprint projection would amortize that work.

- A monorepo user sees one global coverage number and one global version label without any indication that package boundaries and release trains are not represented.

- “Diffable YAML” is not itself useful when the meaningful change is buried in tens of thousands of generated proof lines. A semantic CLI/PR summary is more valuable than exposing the raw storage format.

## What is genuinely good

- Keep the branch-correct committed catalog versus rebuildable local database boundary; do not commit SQLite.

- Keep stable page/entity IDs with version and locale as address dimensions.

- Keep page-local merge units and append-only JSONL journals, but make both thin references to normalized artifacts.

## Open questions for the founder

1. For 0.1.0, should versioned docs be implemented end-to-end, or removed entirely—including the switcher—until a complete snapshot lifecycle exists?

2. Should a frozen version preserve content, proofs, routes, and locales while using the current compatible theme, or freeze the entire emitted site runtime and theme too?

3. Must a version cut block until every declared page-locale is ready, or may it freeze explicit source-language fallbacks and partial-locale states?

4. Should repairing a frozen label create an immutable successor revision with audit history, or is destructive in-place re-cutting an acceptable product promise?

5. Are monorepos one site-wide release train, or must independently versioned package docsets be first-class in 0.1.0?

6. Should cross-project overview pages belong to a distinct aggregate docset, or inherit a release-set dependency on every project they cite?

7. Is raw human-readable proof YAML a product requirement, or can committed state use canonical JSON objects with a human-oriented semantic diff in PRs?

8. Should the cache have an automatic default disk cap and LRU eviction, or remain unlimited until the user explicitly prunes it?
