import { z } from 'zod';
import {
  blockIdSchema,
  claimIdSchema,
  contentHashSchema,
  entityRevisionSchema,
  evidenceIdSchema,
  gitCommitSchema,
  isoTimestampSchema,
  knowledgeFactIdSchema,
  lineSpanSchema,
  pageIdSchema,
  repoPathSchema,
  sectionIdSchema,
  symbolSourceKeySchema
} from './primitives.ts';

// The claim ledger is the v2 trust spine (trust-model-v2 decisions 1-6). Two distinct artifacts
// share the claim vocabulary and must never be conflated:
//   1. the WRITER ledger — agent output validated by submit_page: proposed claims keyed by inline
//      marker id, with proposed evidence and subscriptions; nothing kernel-minted appears here;
//   2. the KERNEL ledger — the committed record after the kernel anchors, mints/matches claim ids,
//      and verification assigns correctness. Manifest shards store only this one.

// Claim classes are an open token space (PRODUCT §3.2 calls the built-ins "notable" classes; the
// capability schema stays open). Unknown class tokens are valid — the kernel routes them to
// unchecked/no-checker-available until a registered verifier declares support.
export const claimClassTokenSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
export type ClaimClassToken = z.infer<typeof claimClassTokenSchema>;

// 'code-structure' IS the existence/shape class (the class formerly called 'structural'/'shape' —
// page-structure quality is never a claim).
export const builtinClaimClasses = ['code-structure', 'value', 'behavior', 'intent-history'] as const;
export type BuiltinClaimClass = (typeof builtinClaimClasses)[number];

export const isBuiltinClaimClass = (value: string): value is BuiltinClaimClass =>
  (builtinClaimClasses as readonly string[]).includes(value);

// Environment fingerprint recorded with execution evidence (pipeline-v2 decision 5). `sandbox` is an
// open lowercase token ('none' today) so future sandbox kinds extend without a schema break.
export const executionEnvironmentSchema = z.object({
  os: z.string().min(1),
  runtimeVersions: z.record(z.string().min(1), z.string().min(1)).default({}),
  sandbox: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .default('none')
});
export type ExecutionEnvironment = z.infer<typeof executionEnvironmentSchema>;

export const evidenceKindSchema = z.enum([
  'codemap-grounding',
  'source-linked',
  // The 0.1.0 minimal value-predicate verifier (PRODUCT.md §3.2): the claim's asserted value
  // compared against the fingerprint ladder's extracted value — match → checked, mismatch →
  // contradicted.
  'value-predicate',
  'execution',
  'schema-check',
  'owner-attestation',
  // For origin:ai knowledge facts — rendered as a cited external fact, never "maintainer-attested".
  'external-citation',
  // Third-party verifier evidence: does not mint the built-in badge unless promoted in config.
  'project-defined'
]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const evidenceRefSchema = z.discriminatedUnion('kind', [
  // Grounding suffices as "checked" for code-structure claims only; for value/behavior it confers
  // merely source-linked (subject real, assertion unchecked) — trust-model-v2 decision 3.
  z.object({
    kind: z.literal('codemap-grounding'),
    symbol: symbolSourceKeySchema,
    file: repoPathSchema.optional(),
    span: lineSpanSchema.optional(),
    commit: gitCommitSchema.optional()
  }),
  z.object({
    kind: z.literal('source-linked'),
    symbol: symbolSourceKeySchema,
    file: repoPathSchema.optional(),
    span: lineSpanSchema.optional(),
    commit: gitCommitSchema.optional()
  }),
  z.object({
    kind: z.literal('value-predicate'),
    symbol: symbolSourceKeySchema,
    valueName: z.string().min(1),
    assertedValue: z.string(),
    extractedValue: z.string()
  }),
  // Execution evidence is RESERVED for the v1.x predicate verifiers (trust-model-v2 decision 3):
  // nothing mints it in 0.1.0 — behavior claims stay unchecked/no-checker-available at launch.
  // The kind (and the behavior→execution authority row) is kept so v1.x extends without a schema
  // break; snippet execution itself is block-level evidence that code EXAMPLES run, never
  // per-claim behavior evidence.
  z.object({
    kind: z.literal('execution'),
    check: z.string().min(1),
    environment: executionEnvironmentSchema
  }),
  z.object({ kind: z.literal('schema-check'), check: z.string().min(1) }),
  z.object({ kind: z.literal('owner-attestation'), author: z.string().min(1), at: isoTimestampSchema }),
  // A cited external fact (platform limit, upstream default…). factId links back to the knowledge
  // fact the citation came from, so the kernel can revalidate its origin (dx-knowledge-v2).
  z.object({ kind: z.literal('external-citation'), url: z.url(), factId: knowledgeFactIdSchema }),
  z.object({
    kind: z.literal('project-defined'),
    verifier: z.string().min(1),
    plugin: z.string().min(1),
    // Explicit config promotion is what lets this evidence mint the built-in badge.
    promoted: z.boolean().default(false)
  })
]);
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

// Correctness and unresolved disposition are separate axes (trust-model-v2 provisional):
// correctness states describe factual checking only; the disposition explains an unresolved or
// attested state. 'owner-attested' is the one disposition that coexists with 'checked'.
export const claimCorrectnessSchema = z.enum(['checked', 'unchecked', 'contradicted']);
export type ClaimCorrectness = z.infer<typeof claimCorrectnessSchema>;

export const claimDispositionSchema = z
  .enum(['not-applicable', 'no-checker-available', 'maintainer-input-needed', 'owner-attested'])
  .nullable();
export type ClaimDisposition = z.infer<typeof claimDispositionSchema>;

// The class → deciding-evidence authority table (trust-model-v2 decision 3). 'source-linked' never
// mints checked for any class; unpromoted 'project-defined' never mints checked; unknown classes
// are checkable only by a promoted project-defined verifier that declared support. Owner
// attestation decides ONLY intent-history claims — a maintainer attestation cannot mint checked
// for code-structure/value/behavior, those need mechanical evidence (trust-model-v2 reserves
// attestation for intent/history). External citations decide value/behavior claims (a cited
// external fact such as a platform limit), never project intent — intent is human-attested only.
const checkedAuthority: Record<BuiltinClaimClass, readonly EvidenceKind[]> = {
  'code-structure': ['codemap-grounding', 'execution', 'schema-check', 'project-defined'],
  value: ['value-predicate', 'execution', 'schema-check', 'external-citation', 'project-defined'],
  behavior: ['execution', 'schema-check', 'external-citation', 'project-defined'],
  'intent-history': ['owner-attestation']
};

export type ClaimTrustState = {
  class: string;
  correctness: ClaimCorrectness;
  disposition: ClaimDisposition;
  decidingKind: EvidenceKind | undefined;
  decidingPromoted: boolean | undefined;
  decidingOutcome: 'pass' | 'fail' | undefined;
};

// The full authority + outcome consistency check. It needs evidence kinds and outcomes, which
// live ONLY on the canonical ClaimEvidence records (provenance-v2) — so full enforcement happens
// there; the kernel ledger claim enforces just its local invariants (ledgerClaimLocalIssues).
export const claimTrustIssues = (state: ClaimTrustState): string[] => {
  const issues: string[] = [];
  if (state.correctness === 'unchecked') {
    if (state.decidingKind !== undefined) {
      issues.push('an unchecked claim must not carry deciding evidence');
    }
    if (state.disposition === null || state.disposition === 'owner-attested') {
      issues.push('an unchecked claim requires an unresolved disposition');
    }
    return issues;
  }
  // checked | contradicted both require authoritative deciding evidence.
  if (state.decidingKind === undefined) {
    issues.push(`a ${state.correctness} claim requires deciding evidence`);
    return issues;
  }
  if (state.correctness === 'contradicted') {
    if (state.disposition !== null) {
      issues.push('a contradicted claim carries no disposition');
    }
    // A contradiction is a recorded negative check — deciding evidence must have failed.
    if (state.decidingOutcome !== 'fail') {
      issues.push("a contradicted claim requires deciding evidence with outcome 'fail'");
    }
  }
  if (state.correctness === 'checked') {
    const ownerAttested = state.decidingKind === 'owner-attestation';
    if (ownerAttested && state.disposition !== 'owner-attested') {
      issues.push("attestation-decided claims must carry the 'owner-attested' disposition");
    }
    if (!ownerAttested && state.disposition !== null) {
      issues.push('a mechanically checked claim carries no disposition');
    }
    if (state.decidingOutcome !== undefined && state.decidingOutcome !== 'pass') {
      issues.push("a checked claim requires deciding evidence with outcome 'pass'");
    }
  }
  const allowed = isBuiltinClaimClass(state.class) ? checkedAuthority[state.class] : (['project-defined'] as const);
  if (!allowed.includes(state.decidingKind)) {
    issues.push(`evidence kind '${state.decidingKind}' has no authority to decide a '${state.class}' claim`);
  } else if (state.decidingKind === 'project-defined' && state.decidingPromoted !== true) {
    issues.push('unpromoted project-defined evidence does not mint built-in correctness states');
  }
  return issues;
};

// Typed dependency subscriptions (pipeline-v2 decision 4): a claim subscribes to the exact facet
// it depends on. The public value token is 'cited-value' (matches the fingerprint ladder name);
// files no language pack can parse subscribe to whole-file content.
export const dependencySubscriptionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('signature'), symbolHash: symbolSourceKeySchema }),
  z.object({
    kind: z.literal('cited-value'),
    symbolHash: symbolSourceKeySchema,
    valueName: z.string().min(1),
    citedValue: z.string()
  }),
  z.object({ kind: z.literal('body'), symbolHash: symbolSourceKeySchema }),
  z.object({ kind: z.literal('file-content'), file: repoPathSchema, contentHash: contentHashSchema })
]);
export type DependencySubscription = z.infer<typeof dependencySubscriptionSchema>;

// The id attribute of the inline <Claim id> marker in the MDX (harness-state-v2 decision 5).
export const claimMarkerIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

// The writer-side subscription PROPOSAL shape: identical to the committed subscription except that
// a file-content proposal needs no contentHash — the writer cannot know content hashes, so the
// kernel resolves the authoritative hash (fingerprint snapshot or observed reads) during
// anchoring. A writer-supplied hash is accepted syntactically and ignored.
export const proposedSubscriptionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('signature'), symbolHash: symbolSourceKeySchema }),
  z.object({
    kind: z.literal('cited-value'),
    symbolHash: symbolSourceKeySchema,
    valueName: z.string().min(1),
    citedValue: z.string()
  }),
  z.object({ kind: z.literal('body'), symbolHash: symbolSourceKeySchema }),
  z.object({ kind: z.literal('file-content'), file: repoPathSchema, contentHash: contentHashSchema.optional() })
]);
export type ProposedSubscription = z.infer<typeof proposedSubscriptionSchema>;

// What the writer may point at as proposed grounding — lightweight handles the kernel resolves
// into real evidence during anchoring/verification. Never verified evidence itself.
export const proposedEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('symbol'),
    symbol: symbolSourceKeySchema,
    file: repoPathSchema.optional(),
    span: lineSpanSchema.optional()
  }),
  z.object({ kind: z.literal('file'), file: repoPathSchema, span: lineSpanSchema.optional() }),
  z.object({ kind: z.literal('url'), url: z.url() })
]);
export type ProposedEvidence = z.infer<typeof proposedEvidenceSchema>;

// One proposed claim in the writer's submit_page output (trust-model-v2 decision 1): keyed by the
// inline marker id only — the kernel mints/matches claim ids, anchors to blocks, and verifies.
// Strict: writer output smuggling kernel-owned fields (claimId, disposition, evidence…) is
// invalid ledger output, which is a coverage failure.
export const draftClaimSchema = z.strictObject({
  markerId: claimMarkerIdSchema,
  class: claimClassTokenSchema,
  // The asserted predicate text, stripped of surrounding prose.
  predicate: z.string().min(1),
  proposedEvidence: z.array(proposedEvidenceSchema).default([]),
  proposedSubscriptions: z.array(proposedSubscriptionSchema).default([])
});
export type DraftClaim = z.infer<typeof draftClaimSchema>;

// The writer-emitted ledger — what submit_page validates. Invalid, truncated, or duplicate-marker
// output is a coverage failure that blocks the full-page badge.
export const writerClaimLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    claims: z.array(draftClaimSchema).default([])
  })
  .superRefine((ledger, ctx) => {
    const seen = new Set<string>();
    for (const claim of ledger.claims) {
      if (seen.has(claim.markerId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['claims'],
          message: `duplicate markerId "${claim.markerId}" — every inline <Claim> marker anchors exactly one claim`
        });
      }
      seen.add(claim.markerId);
    }
  });
export type WriterClaimLedger = z.infer<typeof writerClaimLedgerSchema>;

const ledgerClaimObjectSchema = z.object({
  claimId: claimIdSchema,
  class: claimClassTokenSchema,
  predicate: z.string().min(1),
  // Claims are authored inline: the anchor is the owning block plus the marker id, never offsets.
  anchor: z.object({ blockId: blockIdSchema, markerId: claimMarkerIdSchema }),
  // The raw MDX the inline marker wrapped — the VISIBLE asserted prose. Canonical: value binding
  // proves the asserted scalar appears here, claim-identity matching threads on it, and reader
  // surfaces render it. Never empty (submit_page rejects empty markers).
  quote: z.string().min(1),
  // Which content-derived entity revision the claim was minted against (never a git commit).
  scope: z.object({
    entityId: z.union([pageIdSchema, sectionIdSchema, blockIdSchema]),
    revision: entityRevisionSchema
  }),
  subscriptions: z.array(dependencySubscriptionSchema).default([]),
  // Bare references into the canonical ClaimEvidence records (provenance-v2) — the ONE place
  // evidence kind/payload/promotion live. The ledger never duplicates evidence metadata.
  evidence: z.array(evidenceIdSchema).default([]),
  correctness: claimCorrectnessSchema,
  disposition: claimDispositionSchema,
  // The evidence record that decided checked/contradicted; absent while unchecked.
  decidingEvidenceId: evidenceIdSchema.optional()
});

// The kernel-owned committed claim: minted id, anchored, with computed correctness. Only LOCAL
// invariants are enforceable here (the handles are bare ids — kinds and outcomes live on the
// canonical ClaimEvidence records, where the full class/evidence authority table is enforced).
// Cross-artifact consistency — every handle id resolving to a ClaimEvidence record, and the
// deciding record actually holding class authority — is a KERNEL invariant checked at commit
// time, not a shape this schema can see.
export const ledgerClaimSchema = ledgerClaimObjectSchema.superRefine((claim, ctx) => {
  // Evidence handles are canonical ids — a repeated handle is a corrupt ledger, not emphasis.
  const seenEvidence = new Set<string>();
  for (const id of claim.evidence) {
    if (seenEvidence.has(id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: `duplicate evidence id "${id}" — a claim references each canonical evidence record at most once`
      });
    }
    seenEvidence.add(id);
  }
  if (claim.decidingEvidenceId !== undefined && !claim.evidence.includes(claim.decidingEvidenceId)) {
    ctx.addIssue({
      code: 'custom',
      path: ['decidingEvidenceId'],
      message: 'decidingEvidenceId must reference one of the claim evidence ids'
    });
    return;
  }
  if (claim.correctness === 'unchecked') {
    if (claim.decidingEvidenceId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['decidingEvidenceId'],
        message: 'an unchecked claim must not carry deciding evidence'
      });
    }
    if (claim.disposition === null || claim.disposition === 'owner-attested') {
      ctx.addIssue({
        code: 'custom',
        path: ['disposition'],
        message: 'an unchecked claim requires an unresolved disposition'
      });
    }
    return;
  }
  if (claim.decidingEvidenceId === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['decidingEvidenceId'],
      message: `a ${claim.correctness} claim requires deciding evidence`
    });
  }
  if (claim.correctness === 'contradicted' && claim.disposition !== null) {
    ctx.addIssue({ code: 'custom', path: ['disposition'], message: 'a contradicted claim carries no disposition' });
  }
  if (claim.correctness === 'checked') {
    if (claim.disposition !== null && claim.disposition !== 'owner-attested') {
      ctx.addIssue({
        code: 'custom',
        path: ['disposition'],
        message: "a checked claim carries no disposition unless it is 'owner-attested'"
      });
    }
    // Attestation only decides intent-history — an owner-attested checked claim of any other
    // class is impossible under the authority table, and that much IS locally visible.
    if (claim.disposition === 'owner-attested' && claim.class !== 'intent-history') {
      ctx.addIssue({
        code: 'custom',
        path: ['disposition'],
        message: "owner attestation decides only 'intent-history' claims"
      });
    }
  }
});
export type LedgerClaim = z.infer<typeof ledgerClaimSchema>;

export const isOwnerAttested = (claim: Pick<LedgerClaim, 'correctness' | 'disposition'>): boolean =>
  claim.correctness === 'checked' && claim.disposition === 'owner-attested';

// Coverage-linter output (harness-state-v2 decision 5): assertion-shaped spans (identifiers,
// defaults, numbers, modal statements) not covered by any claim — ledger omission cannot
// manufacture "100% checked".
export const coverageLintSpanSchema = z.object({
  blockId: blockIdSchema,
  excerpt: z.string().min(1),
  detector: z.string().optional()
});
export type CoverageLintSpan = z.infer<typeof coverageLintSpanSchema>;

// The kernel-owned committed ledger — what manifest shards store.
export const claimLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageId: pageIdSchema,
    // The repository commit the ledger was computed against.
    sourceRevision: gitCommitSchema,
    claims: z.array(ledgerClaimSchema).default([]),
    coverageLint: z.object({ uncovered: z.array(coverageLintSpanSchema).default([]) }).prefault({})
  })
  .superRefine((ledger, ctx) => {
    // Minted claim ids are canonical: two committed claims sharing an id could carry divergent
    // correctness for the same identity, so the collection rejects the duplicate outright.
    const seen = new Set<string>();
    for (const claim of ledger.claims) {
      if (seen.has(claim.claimId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['claims'],
          message: `duplicate claimId "${claim.claimId}" — a committed claim id appears exactly once in the ledger`
        });
      }
      seen.add(claim.claimId);
    }
  });
export type ClaimLedger = z.infer<typeof claimLedgerSchema>;
