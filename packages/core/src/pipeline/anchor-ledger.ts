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
  assessClaimCheckability,
  bindClaimSubject,
  claimLedgerSchema,
  contentHashSchema,
  entityRevisionSchema,
  evidenceRecordSchema,
  gitCommitSchema,
  idPrefixes,
  mintId,
  normalizeCitedValue,
  renderValuePathSubject,
  symbolSourceKeySchema
} from '@docstube/contracts';
import { blockSourceRanges } from '../entities/extract-entities.ts';
import { coverageLintHint, lintUncoveredAssertions } from './coverage-lint.ts';

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
  // AST-derived rendered text of the marker (link URLs/attributes excluded) — the text value
  // binding proves the asserted scalar against, identically to submit_page (impl-07 finding 1).
  visibleText: string;
  // Kernel-scanned pure-marker flag (wave 2b close final): true only when the marker's AST
  // content is exclusively text + inlineCode nodes AND the marker has no JSX ancestor (a claim
  // inside a component is legal but its rendering is component-owned). Non-pure markers can never
  // be canonically checkable — verification skips existence/value evidence for them entirely.
  pureText: boolean;
};

export type AnchorIssueCode =
  // Repair-eligible: the writer can fix these — they feed the bounded retry loop.
  | 'marker-misplaced' // marker in a heading / flow position / JSX expression
  | 'marker-unanchored' // marker maps into no content block
  | 'marker-missing' // ledger claim whose marker is absent from the accepted MDX
  | 'marker-duplicate' // the same marker id appears more than once in the accepted MDX
  | 'marker-unclaimed' // marker with no ledger entry — an unclaimed assertion shrinks nothing silently
  | 'subject-unbound' // the visible prose or the predicate fails to name the referenced symbol's root identifier
  | 'polarity-mismatch' // one side negates the bound subject while the other asserts it — opposite facts
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

// Why a proposal was refused. 'unknown-symbol' is the missing-identifier class — a hallucinated
// or stale symbol reference — which the claim-verification stage escalates to a HARD DEFECT for
// every claim class (trust-model-v2 decision 3: killing hallucinated references stays).
export type RejectedProposalCode =
  | 'unknown-symbol' // symbol hash absent from the fingerprint snapshot
  | 'unknown-value' // known symbol, unknown cited-value name
  | 'missing-facet' // known symbol without the subscribed signature/body print
  | 'unknown-file' // file in neither the snapshot nor the page's observed reads
  | 'location-mismatch'; // writer-supplied file/span disagrees with the codemap record

// A proposal the kernel refused to resolve into canonical state — recorded, never silently gone.
export type RejectedProposal = {
  markerId: string;
  proposal: 'evidence' | 'subscription';
  code: RejectedProposalCode;
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
  const reject = (code: RejectedProposalCode, reason: string): void => {
    ctx.rejectedProposals.push({ markerId: claim.markerId, proposal: 'subscription', code, reason });
  };
  const resolved: DependencySubscription[] = [];
  for (const subscription of claim.proposedSubscriptions) {
    if (subscription.kind === 'file-content') {
      // The kernel-derived hash is authoritative — the writer cannot know content hashes.
      const contentHash = authoritativeFileHash(ctx, subscription.file);
      if (contentHash === undefined) {
        reject(
          'unknown-file',
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
        'unknown-symbol',
        `${subscription.kind} subscription — symbol ${subscription.symbolHash} is not in the fingerprint snapshot`
      );
      continue;
    }
    if (subscription.kind === 'signature' && symbol.signaturePrint === undefined) {
      reject('missing-facet', `signature subscription — symbol ${subscription.symbolHash} has no signature print`);
      continue;
    }
    if (subscription.kind === 'body' && symbol.bodyPrint === undefined) {
      reject('missing-facet', `body subscription — symbol ${subscription.symbolHash} has no body print`);
      continue;
    }
    if (subscription.kind === 'cited-value') {
      if (symbol.valuePrints[subscription.valueName] === undefined) {
        reject(
          'unknown-value',
          `cited-value subscription — symbol ${subscription.symbolHash} has no value named "${subscription.valueName}"`
        );
        continue;
      }
      // The committed subscription carries the KERNEL-CANONICAL asserted value (the shared
      // normalization): bare, quoted, and numeric spellings all land on the byte form the
      // cited-value extraction grammar produces, so verification compares like with like.
      resolved.push({ ...subscription, citedValue: normalizeCitedValue(subscription.citedValue).canonical });
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
// unchecked. file/url proposals mint nothing here: they are verifier input (wave 2b-ii).
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
        code: 'unknown-symbol',
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
        code: 'location-mismatch',
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
        code: 'location-mismatch',
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

// SUBJECT BINDING at anchoring (impl-09 finding 1, tightened by impl-10 findings 1+2): every
// symbol the claim references that RESOLVES in the codemap must be named — as an identifier token
// — by the visible marker prose AND the predicate, using the CODEMAP record's display name (the
// subject's ROOT identifier), never the writer's proposal text. Genuine aliasing keeps passing;
// "`inventedFunction` exists" can no longer ride an unrelated real symbol, a predicate-only
// occurrence can no longer launder visibly false prose, and a common cited-value leaf ('config')
// can no longer substitute for the root. Repair-eligible: the writer fixes the prose or drops the
// wrong symbol. Verification re-checks the same rule (defense in depth) and refuses to mint
// evidence on violation.
const subjectBindingIssues = (draft: DraftClaim, visibleText: string, codemap: Codemap): AnchorIssue[] => {
  // Cited-value name paths per symbol: their non-root identifier segments are context for the
  // repair message — they never substitute for the root identifier.
  const valueNamesByHash = new Map<string, string[]>();
  for (const subscription of draft.proposedSubscriptions) {
    if (subscription.kind === 'cited-value') {
      const hash = subscription.symbolHash as string;
      valueNamesByHash.set(hash, [...(valueNamesByHash.get(hash) ?? []), subscription.valueName]);
    }
  }
  const referencedHashes = [
    ...draft.proposedEvidence.flatMap((proposal) => (proposal.kind === 'symbol' ? [proposal.symbol as string] : [])),
    ...draft.proposedSubscriptions.flatMap((subscription) =>
      subscription.kind === 'file-content' ? [] : [subscription.symbolHash as string]
    )
  ];
  const issues: AnchorIssue[] = [];
  const checked = new Set<string>();
  for (const symbolHash of referencedHashes) {
    if (checked.has(symbolHash)) {
      continue;
    }
    checked.add(symbolHash);
    const record = codemap.symbols.find((symbol) => symbol.hash === symbolHash);
    if (record === undefined) {
      // Unresolvable symbols are the unknown-symbol rejection path — nothing to bind against.
      continue;
    }
    const valueNames = valueNamesByHash.get(symbolHash) ?? [];
    const binding = bindClaimSubject({
      subjectName: record.name,
      valueNames,
      markerText: visibleText,
      predicate: draft.predicate
    });
    if (!binding.ok && binding.code === 'polarity-mismatch') {
      // POLARITY AGREEMENT (wave 2b close, polarity finding): the root token occurs on both
      // sides, but one side NEGATES the subject while the other asserts it — visible "`greet`
      // does not exist" over predicate "greet exists" would otherwise ride real greet evidence
      // into 'checked'. Repair-eligible: the writer fixes whichever side states the wrong fact.
      const negatedSide =
        binding.negatedIn === 'marker'
          ? `the visible prose ("${visibleText}")`
          : `the predicate ("${draft.predicate}")`;
      const positiveSide =
        binding.negatedIn === 'marker'
          ? `the predicate ("${draft.predicate}")`
          : `the visible prose ("${visibleText}")`;
      issues.push({
        code: 'polarity-mismatch',
        kernel: false,
        markerId: draft.markerId,
        message:
          `claim "${draft.markerId}" has a POLARITY MISMATCH on its subject "${binding.requiredName}" — ` +
          `${negatedSide} NEGATES the subject while ${positiveSide} asserts it. The wrapped sentence and the ` +
          'predicate must state the SAME fact with the same polarity: fix whichever side is wrong. Note that ' +
          'negative assertions cannot be mechanically checked in 0.1.0 — prefer phrasing the fact positively'
      });
      continue;
    }
    if (!binding.ok) {
      const missingSides = binding.missingIn
        .map((side) =>
          side === 'marker' ? `the visible prose ("${visibleText}")` : `the predicate ("${draft.predicate}")`
        )
        .join(' and ');
      issues.push({
        code: 'subject-unbound',
        kernel: false,
        markerId: draft.markerId,
        message:
          `claim "${draft.markerId}" is SUBJECT-UNBOUND — its evidence points at the symbol "${record.name}"` +
          `${valueNames.length === 0 ? '' : ` (cited value ${valueNames.map((name) => `"${name}"`).join(', ')})`}, ` +
          `but ${missingSides} never name${binding.missingIn.length === 1 ? 's' : ''} "${binding.requiredName}" ` +
          "as an identifier. The subject's root identifier must appear in BOTH the wrapped sentence AND the " +
          'predicate' +
          `${
            binding.contextSegments.length === 0
              ? ''
              : ` — naming only a value-path segment (${binding.contextSegments
                  .map((name) => `"${name}"`)
                  .join(', ')}) never substitutes for the root`
          }. ` +
          'Name the real subject on both sides, or drop/replace the wrong symbol reference'
      });
    }
  }
  return issues;
};

// DESTINED-UNCHECKED HINTS (impl-12, grammar tightened to exact canonical visible match in
// impl-13): the checkability grammar is enforced at VERIFICATION (the evidence decision);
// anchoring only journals a NON-BLOCKING note when a code-structure/value claim that
// subject-binds cleanly is nonetheless phrased outside the canonical grammar — the bounded retry
// loop can improve the phrasing opportunistically, but unchecked is a legal outcome and must
// never spiral into repairs.
const checkabilityHints = (
  draft: DraftClaim,
  marker: { visibleText: string; pureText: boolean },
  codemap: Codemap
): string[] => {
  const { visibleText, pureText } = marker;
  const recordFor = (symbolHash: string): SymbolRecord | undefined =>
    codemap.symbols.find((symbol) => symbol.hash === symbolHash);
  const hint = (subjectName: string, reason: string): string =>
    `claim "${draft.markerId}" is destined to ship UNCHECKED — ${reason}. Non-blocking: unchecked is a legal ` +
    `outcome. To make it checkable, phrase the assertion canonically ("\`${subjectName}\` exists", ` +
    `"\`${subjectName}\` defaults to 3") with the marker wrapped tightly around it — extra context goes outside ` +
    'the marker';
  if (draft.class === 'code-structure') {
    const referenced = [
      ...draft.proposedEvidence.flatMap((proposal) => (proposal.kind === 'symbol' ? [proposal.symbol as string] : [])),
      ...draft.proposedSubscriptions.flatMap((subscription) =>
        subscription.kind === 'file-content' ? [] : [subscription.symbolHash as string]
      )
    ];
    const records = [...new Set(referenced)]
      .map(recordFor)
      .filter((record): record is SymbolRecord => record !== undefined);
    if (records.length === 0) {
      return [];
    }
    const assessments = records.map((record) => ({
      record,
      assessment: assessClaimCheckability({
        style: 'existence',
        subjectName: record.name,
        markerPureText: pureText,
        markerText: visibleText,
        predicate: draft.predicate
      })
    }));
    if (assessments.some(({ assessment }) => assessment.checkable)) {
      return [];
    }
    const first = assessments[0]!;
    return first.assessment.checkable ? [] : [hint(first.record.name, first.assessment.reason)];
  }
  if (draft.class === 'value') {
    const assessments = draft.proposedSubscriptions.flatMap((subscription) => {
      if (subscription.kind !== 'cited-value') {
        return [];
      }
      const record = recordFor(subscription.symbolHash as string);
      if (record === undefined) {
        return [];
      }
      return [
        {
          valueName: subscription.valueName,
          assessment: assessClaimCheckability({
            style: 'value',
            subjectName: record.name,
            valueNames: [subscription.valueName],
            citedValue: subscription.citedValue,
            markerPureText: pureText,
            markerText: visibleText,
            predicate: draft.predicate
          })
        }
      ];
    });
    // Mirror the code-structure branch: any checkable subscription means the claim is not
    // destined-unchecked (a stray unresolvable proposal is rejected separately, not hinted).
    if (assessments.length === 0 || assessments.some(({ assessment }) => assessment.checkable)) {
      return [];
    }
    const first = assessments[0]!;
    if (!first.assessment.checkable) {
      // One hint per claim is enough — the writer fixes the phrasing once. The teachable
      // subject for a value claim is the RENDERED bound value path, never the bare root.
      return [hint(renderValuePathSubject(first.valueName), first.assessment.reason)];
    }
  }
  return [];
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

  // Bijection recheck, kernel-side defense in depth (submit_page proves marker↔ledger cardinality
  // in-session, but replay/scripted writers can bypass it): EXACT cardinality both ways. The
  // per-claim loop below covers ledger→marker; here markers→ledger — duplicate marker ids and
  // markers with no ledger entry REJECT, because accepting them would either fork one anchor
  // across two spans or ship an asserted span outside the trust denominator.
  const seenMarkerIds = new Set<string>();
  for (const marker of scan.markers) {
    if (seenMarkerIds.has(marker.markerId)) {
      errors.push({
        code: 'marker-duplicate',
        kernel: false,
        markerId: marker.markerId,
        message: `marker "${marker.markerId}" appears more than once in the accepted MDX — every marker id is unique; renumber the duplicates and resubmit the matching ledger`
      });
    }
    seenMarkerIds.add(marker.markerId);
  }
  const ledgerMarkerIds = new Set(input.writerLedger.claims.map((claim) => claim.markerId));
  for (const markerId of seenMarkerIds) {
    if (!ledgerMarkerIds.has(markerId)) {
      errors.push({
        code: 'marker-unclaimed',
        kernel: false,
        markerId,
        message: `marker "${markerId}" has no ledger entry — every inline <Claim> marker anchors exactly one claim; add a ledger entry with markerId "${markerId}" or remove the marker`
      });
    }
  }

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
    // Subject binding gates before any evidence mints: an unbound claim contributes no
    // source-linked records and fails the page with a repair-eligible error.
    const subjectIssues = subjectBindingIssues(draft, marker.visibleText, input.codemap);
    if (subjectIssues.length > 0) {
      errors.push(...subjectIssues);
      continue;
    }
    // Non-blocking phrasing hint for claims destined to stay unchecked under the checkability
    // grammar — journaled, never gating (impl-12).
    warnings.push(...checkabilityHints(draft, marker, input.codemap));
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
      // The visible asserted prose the marker wrapped — canonical on the committed claim (value
      // binding, identity threading, and reader rendering all consume it).
      quote: marker.innerMdx,
      // The content-derived block revision — never a git commit (trust-model-v2).
      scope: { entityId: block.id, revision: entityRevisionSchema.parse(block.contentHash) },
      subscriptions,
      evidence: claimEvidence.map((record) => record.evidenceId),
      correctness: 'unchecked',
      disposition: draft.class === 'intent-history' ? 'maintainer-input-needed' : 'no-checker-available'
    };
    anchored.push({
      claim,
      markerId: draft.markerId,
      quote: marker.innerMdx,
      visibleText: marker.visibleText,
      pureText: marker.pureText
    });
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

  // THE COVERAGE LINTER (harness-state-v2 decision 5, PRODUCT §1.2): assertion-shaped prose that
  // no marker covers is recorded on the committed ledger, so the reader surfaces can never present
  // a page as complete on the strength of a ledger the writer simply kept short. Reported as a
  // NON-BLOCKING journal hint — never a repair error (minimal-review tenet).
  const uncovered = lintUncoveredAssertions({ mdx: input.mdx, page: input.page });
  warnings.push(...coverageLintHint(uncovered));

  const ledger = claimLedgerSchema.parse({
    schemaVersion: 1,
    pageId: input.page.id,
    sourceRevision: gitCommitSchema.parse(input.commit),
    claims: anchored.map((entry) => entry.claim),
    coverageLint: { uncovered }
  });
  return { ok: true, ledger, anchored, evidence, rejectedProposals, warnings };
};
