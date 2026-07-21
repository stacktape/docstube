import { scanClaimMarkers } from '@docstube/agent-runtime';
import type { MarkerScanError } from '@docstube/agent-runtime';
import type {
  BlockEntity,
  ClaimLedger,
  Codemap,
  ContentHash,
  DependencySubscription,
  DraftClaim,
  EvidenceRecord,
  FingerprintSnapshot,
  LedgerClaim,
  ObservedRead,
  PageEntity,
  SymbolRecord,
  WriterClaimLedger
} from '@docstube/contracts';
import {
  claimLedgerSchema,
  contentHashSchema,
  entityRevisionSchema,
  evidenceRecordSchema,
  gitCommitSchema,
  idPrefixes,
  mintId,
  symbolSourceKeySchema
} from '@docstube/contracts';
import { blockSourceRanges } from '../entities/extract-entities.ts';

// The kernel anchoring stage (ARCHITECTURE §4.1): the accepted writer artifact (MDX + writer
// ledger, already validated by submit_page) becomes the committed kernel ledger. The kernel —
// never the writer — maps each marker to its owning block, mints claim/evidence ids, resolves
// proposed subscriptions against the fingerprint snapshot, and assigns the initial trust state:
// every claim starts 'unchecked' with disposition 'no-checker-available' ('maintainer-input-
// needed' for intent-history) — verification flips correctness in wave 2b-ii, never this stage.
//
// Anchoring is FAIL-CLOSED (PRODUCT §3.3/§3.5): a claim that cannot anchor, or a required code
// dependency that cannot resolve even conservatively, fails the whole page attempt with a typed,
// repair-eligible error. A passing ledger with fewer claims than the writer asserted would
// silently shrink the trust denominator, which is exactly what the writer ledger exists to
// prevent. Resolution never invents: an unknown symbol, value name, or file becomes a
// rejected-proposal record, and code claims fall back to a kernel-derived whole-file dependency.

const flattenBlocks = (page: PageEntity): BlockEntity[] => [
  ...page.preamble,
  ...page.sections.flatMap((section) => section.blocks)
];

export type AnchoredClaim = {
  claim: LedgerClaim;
  markerId: string;
  // Raw MDX the marker wrapped — the bridge derives the legacy quote anchor from it.
  quote: string;
};

export type AnchorIssueCode =
  // Repair-eligible: the writer can fix these — they feed the bounded retry loop.
  | 'marker-misplaced' // marker in a heading / flow position / JSX expression
  | 'marker-unanchored' // marker maps into no content block
  | 'marker-missing' // ledger claim whose marker is absent from the accepted MDX
  | 'subscription-unresolvable' // code claim with no resolvable dependency and no derivable fallback
  // Kernel invariant breach: submit_page guaranteed these could not happen, so their appearance
  // post-acceptance means the MDX was altered after acceptance — a kernel bug, never repairable.
  | 'marker-scan-invalid';

export type AnchorIssue = {
  code: AnchorIssueCode;
  // True for kernel invariant breaches; false for writer-repairable errors.
  kernel: boolean;
  markerId?: string;
  message: string;
};

// A proposal the kernel refused to resolve into canonical state — recorded, never silently gone.
export type RejectedProposal = {
  markerId: string;
  proposal: 'evidence' | 'subscription';
  reason: string;
};

export type AnchorLedgerResult =
  | {
      ok: true;
      ledger: ClaimLedger;
      anchored: AnchoredClaim[];
      // Canonical evidence records minted during anchoring (source-linked grounding for resolved
      // symbol proposals) — provenance-v2 storage is wave 2b-iii; tests and the verifier wave
      // consume these directly for now.
      evidence: EvidenceRecord[];
      rejectedProposals: RejectedProposal[];
      warnings: string[];
    }
  | {
      ok: false;
      errors: AnchorIssue[];
      rejectedProposals: RejectedProposal[];
      warnings: string[];
    };

export type AnchorLedgerInput = {
  mdx: string;
  writerLedger: WriterClaimLedger;
  // The extracted (and id-matched) page the MDX parsed into — block ids anchor the claims.
  page: PageEntity;
  fingerprints: FingerprintSnapshot;
  // The verified codemap: the ONLY source of file/span on minted source-linked evidence and of
  // the grounding-symbol file for the conservative dependency fallback.
  codemap: Codemap;
  // The page's authoritative observed reads (kernel-recorded file content hashes) — the
  // conservative fallback derives whole-file subscriptions from these, never from model output.
  observedReads: ObservedRead[];
  commit: string;
};

// Classes whose claims depend on code and therefore MUST end anchoring with at least one resolved
// subscription or an explicit conservative fallback (PRODUCT §3.2/§3.5): without one, a future
// ledger-driven reconciliation would silently miss source changes.
const CODE_DEPENDENT_CLASSES = new Set(['code-structure', 'value', 'behavior']);

// Placement errors are writer-repairable; grammar-level scan errors post-acceptance are kernel
// invariant breaches (submit_page rejected them in-session, so the MDX must have been altered).
const REPAIRABLE_SCAN_CODES = new Set(['marker-flow', 'marker-in-heading', 'marker-in-expression']);

const scanErrorToIssue = (error: MarkerScanError): AnchorIssue =>
  REPAIRABLE_SCAN_CODES.has(error.code)
    ? {
        code: 'marker-misplaced',
        kernel: false,
        ...(error.markerId === undefined ? {} : { markerId: error.markerId }),
        message: error.message
      }
    : {
        code: 'marker-scan-invalid',
        kernel: true,
        ...(error.markerId === undefined ? {} : { markerId: error.markerId }),
        message: `accepted MDX failed the marker scan (${error.code}): ${error.message}`
      };

type ResolutionContext = {
  fingerprints: FingerprintSnapshot;
  codemap: Codemap;
  observedReads: ObservedRead[];
  rejectedProposals: RejectedProposal[];
};

// Kernel-derived content hash for a repo file: the fingerprint snapshot's whole-file fallback or
// the page's observed reads. Never the writer's value.
const authoritativeFileHash = (ctx: ResolutionContext, file: string): ContentHash | undefined => {
  const snapshot = ctx.fingerprints.unparsedFiles.find((entry) => entry.file === file)?.contentHash;
  if (snapshot !== undefined) {
    return snapshot;
  }
  const observed = ctx.observedReads.find((read) => read.file === file)?.contentHash;
  return observed === undefined ? undefined : contentHashSchema.parse(observed);
};

const resolveSubscriptions = (claim: DraftClaim, ctx: ResolutionContext): DependencySubscription[] => {
  const symbolByHash = new Map(ctx.fingerprints.symbols.map((symbol) => [symbol.symbolHash as string, symbol]));
  const reject = (reason: string): void => {
    ctx.rejectedProposals.push({ markerId: claim.markerId, proposal: 'subscription', reason });
  };
  const resolved: DependencySubscription[] = [];
  for (const subscription of claim.proposedSubscriptions) {
    if (subscription.kind === 'file-content') {
      // The kernel-derived hash is authoritative — the writer cannot know content hashes.
      const contentHash = authoritativeFileHash(ctx, subscription.file);
      if (contentHash === undefined) {
        reject(
          `file-content subscription to "${subscription.file}" — the file is in neither the fingerprint snapshot nor the page's observed reads`
        );
        continue;
      }
      resolved.push({ kind: 'file-content', file: subscription.file, contentHash });
      continue;
    }
    const symbol = symbolByHash.get(subscription.symbolHash as string);
    if (symbol === undefined) {
      reject(
        `${subscription.kind} subscription — symbol ${subscription.symbolHash} is not in the fingerprint snapshot`
      );
      continue;
    }
    if (subscription.kind === 'signature' && symbol.signaturePrint === undefined) {
      reject(`signature subscription — symbol ${subscription.symbolHash} has no signature print`);
      continue;
    }
    if (subscription.kind === 'body' && symbol.bodyPrint === undefined) {
      reject(`body subscription — symbol ${subscription.symbolHash} has no body print`);
      continue;
    }
    if (subscription.kind === 'cited-value' && symbol.valuePrints[subscription.valueName] === undefined) {
      reject(
        `cited-value subscription — symbol ${subscription.symbolHash} has no value named "${subscription.valueName}"`
      );
      continue;
    }
    resolved.push(subscription);
  }
  return resolved;
};

// Conservative dependency fallback (kernel-derived, never invented from model output): when a
// code-dependent claim resolved nothing, subscribe it to the whole-file content of the claim's
// GROUNDED SUBJECT — the grounding symbol's codemap file (named by a proposed evidence symbol or
// a symbol-bearing proposed subscription) or a proposed evidence file. The hash for THAT specific
// file must come from the kernel's own records (fingerprint snapshot or the page's observed
// reads); when it is underivable the claim fails closed (subscription-unresolvable). Unrelated
// observed reads are NEVER substituted: subscribing a claim about src/subject.ts to README.md
// would let the subject change without ever invalidating the claim.
const conservativeFallback = (claim: DraftClaim, ctx: ResolutionContext): DependencySubscription[] => {
  const fileCandidates: string[] = [];
  const subjectFileOf = (symbolHash: string): void => {
    const record = ctx.codemap.symbols.find((symbol) => symbol.hash === symbolHash);
    if (record !== undefined) {
      fileCandidates.push(record.file);
    }
  };
  for (const proposal of claim.proposedEvidence) {
    if (proposal.kind === 'symbol') {
      subjectFileOf(proposal.symbol as string);
    } else if (proposal.kind === 'file') {
      fileCandidates.push(proposal.file);
    }
  }
  // A rejected facet subscription (e.g. an unknown value name) on a KNOWN symbol still names the
  // grounded subject — its file is a legitimate conservative target.
  for (const subscription of claim.proposedSubscriptions) {
    if (subscription.kind !== 'file-content') {
      subjectFileOf(subscription.symbolHash as string);
    }
  }
  for (const file of fileCandidates) {
    const contentHash = authoritativeFileHash(ctx, file);
    if (contentHash !== undefined) {
      return [{ kind: 'file-content', file, contentHash }];
    }
  }
  // No grounded subject with a derivable authoritative hash: fail closed (the caller raises
  // subscription-unresolvable). Over-invalidation would be acceptable; a fabricated or unrelated
  // dependency is not.
  return [];
};

// Minted grounding for resolved symbol proposals: 'source-linked' asserts only that the subject
// is real (trust-model-v2 decision 3) — it never decides correctness, so the claims stay
// unchecked. file/url/check proposals mint nothing here: they are verifier input (wave 2b-ii).
// file/span on the minted record come from the CODEMAP record for the symbol, never from the
// writer: a writer-supplied location that mismatches the codemap is a rejected proposal.
const mintSymbolEvidence = (claim: DraftClaim, ctx: ResolutionContext, commit: string): EvidenceRecord[] => {
  const known = new Set(ctx.fingerprints.symbols.map((symbol) => symbol.symbolHash as string));
  const records: EvidenceRecord[] = [];
  for (const proposal of claim.proposedEvidence) {
    if (proposal.kind !== 'symbol') {
      continue;
    }
    if (!known.has(proposal.symbol as string)) {
      ctx.rejectedProposals.push({
        markerId: claim.markerId,
        proposal: 'evidence',
        reason: `symbol evidence — symbol ${proposal.symbol} is not in the fingerprint snapshot`
      });
      continue;
    }
    const codemapRecord: SymbolRecord | undefined = ctx.codemap.symbols.find(
      (symbol) => symbol.hash === (proposal.symbol as string)
    );
    if (proposal.file !== undefined && codemapRecord !== undefined && proposal.file !== codemapRecord.file) {
      ctx.rejectedProposals.push({
        markerId: claim.markerId,
        proposal: 'evidence',
        reason: `writer-supplied location "${proposal.file}" for symbol ${proposal.symbol} mismatches the codemap record ("${codemapRecord.file}") — using the codemap location`
      });
    }
    if (
      proposal.span !== undefined &&
      codemapRecord !== undefined &&
      (proposal.span[0] !== codemapRecord.span[0] || proposal.span[1] !== codemapRecord.span[1])
    ) {
      ctx.rejectedProposals.push({
        markerId: claim.markerId,
        proposal: 'evidence',
        reason: `writer-supplied span [${proposal.span.join(', ')}] for symbol ${proposal.symbol} mismatches the codemap record — using the codemap span`
      });
    }
    records.push(
      evidenceRecordSchema.parse({
        evidenceId: mintId(idPrefixes.evidence),
        ref: {
          kind: 'source-linked',
          symbol: symbolSourceKeySchema.parse(proposal.symbol),
          // Codemap-resolved location only; omitted entirely when the codemap cannot resolve it.
          ...(codemapRecord === undefined ? {} : { file: codemapRecord.file, span: codemapRecord.span }),
          commit: gitCommitSchema.parse(commit)
        },
        checkedAt: new Date().toISOString(),
        sourceRevision: gitCommitSchema.parse(commit),
        outcome: 'pass',
        detail: 'symbol resolved in the fingerprint snapshot; assertion unchecked'
      })
    );
  }
  return records;
};

export const anchorWriterLedger = (input: AnchorLedgerInput): AnchorLedgerResult => {
  const warnings: string[] = [];
  const errors: AnchorIssue[] = [];
  const rejectedProposals: RejectedProposal[] = [];
  const ctx: ResolutionContext = {
    fingerprints: input.fingerprints,
    codemap: input.codemap,
    observedReads: input.observedReads,
    rejectedProposals
  };
  const blocks = flattenBlocks(input.page);
  // submit_page already validated the markers; the re-scan here classifies anything that slipped
  // through: placement problems are writer-repairable, grammar problems post-acceptance mean the
  // MDX was altered after acceptance — a kernel invariant breach, never a warning.
  const scan = scanClaimMarkers(input.mdx);
  errors.push(...scan.errors.map(scanErrorToIssue));
  // Unparsable MDX already produced a kernel-level scan error above; ranges degrade to empty so
  // the remaining claims report precise marker-missing errors instead of crashing the stage.
  let ranges: Array<[number, number]>;
  try {
    ranges = blockSourceRanges(input.mdx);
  } catch {
    ranges = [];
  }
  const markerByid = new Map(scan.markers.map((marker) => [marker.markerId, marker]));

  const anchored: AnchoredClaim[] = [];
  const evidence: EvidenceRecord[] = [];
  for (const draft of input.writerLedger.claims) {
    const marker = markerByid.get(draft.markerId);
    if (marker === undefined) {
      // The scan may already carry the precise placement error for this marker; the claim-level
      // error still fires so the ledger/marker mismatch is explicit.
      errors.push({
        code: 'marker-missing',
        kernel: false,
        markerId: draft.markerId,
        message: `claim "${draft.markerId}" cannot anchor — its <Claim id="${draft.markerId}"> marker is missing from the accepted MDX; wrap the asserted prose inline or remove the ledger entry`
      });
      continue;
    }
    const blockIndex = ranges.findIndex(([start, end]) => marker.offset >= start && marker.offset < end);
    const block = blockIndex === -1 ? undefined : blocks[blockIndex];
    if (block === undefined) {
      errors.push({
        code: 'marker-unanchored',
        kernel: false,
        markerId: draft.markerId,
        message: `claim "${draft.markerId}" cannot anchor — its marker does not sit inside any content block (headings and frontmatter cannot carry claims); move the marker into the body prose`
      });
      continue;
    }
    const claimEvidence = mintSymbolEvidence(draft, ctx, input.commit);
    evidence.push(...claimEvidence);
    let subscriptions = resolveSubscriptions(draft, ctx);
    if (subscriptions.length === 0 && CODE_DEPENDENT_CLASSES.has(draft.class)) {
      subscriptions = conservativeFallback(draft, ctx);
      if (subscriptions.length === 0) {
        errors.push({
          code: 'subscription-unresolvable',
          kernel: false,
          markerId: draft.markerId,
          message: `claim "${draft.markerId}" (${draft.class}) has no resolvable code dependency, and no conservative fallback could be derived from its grounded subject (no proposed symbol/file resolved to a file with a kernel-derived content hash) — propose { kind: "file-content", file: "<repo-relative source file>" } for the file the fact came from, or a symbol subscription with a real hash from the API surface list`
        });
        continue;
      }
    }
    const claim: LedgerClaim = {
      claimId: mintId(idPrefixes.claim),
      class: draft.class,
      predicate: draft.predicate,
      anchor: { blockId: block.id, markerId: draft.markerId },
      // The content-derived block revision — never a git commit (trust-model-v2).
      scope: { entityId: block.id, revision: entityRevisionSchema.parse(block.contentHash) },
      subscriptions,
      evidence: claimEvidence.map((record) => record.evidenceId),
      correctness: 'unchecked',
      disposition: draft.class === 'intent-history' ? 'maintainer-input-needed' : 'no-checker-available'
    };
    anchored.push({ claim, markerId: draft.markerId, quote: marker.innerMdx });
  }

  warnings.push(
    ...rejectedProposals.map(
      (rejected) => `claim "${rejected.markerId}": rejected ${rejected.proposal} proposal — ${rejected.reason}`
    )
  );

  if (errors.length > 0) {
    // FAIL-CLOSED: no ledger leaves this stage with fewer claims than the writer asserted.
    return { ok: false, errors, rejectedProposals, warnings };
  }

  const ledger = claimLedgerSchema.parse({
    schemaVersion: 1,
    pageId: input.page.id,
    sourceRevision: gitCommitSchema.parse(input.commit),
    claims: anchored.map((entry) => entry.claim),
    // The deterministic coverage linter is a later wave; the field exists so shards never need a
    // schema migration when it lands.
    coverageLint: { uncovered: [] }
  });
  return { ok: true, ledger, anchored, evidence, rejectedProposals, warnings };
};
