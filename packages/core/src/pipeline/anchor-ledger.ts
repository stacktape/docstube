import { scanClaimMarkers } from '@docstube/agent-runtime';
import type {
  BlockEntity,
  ClaimLedger,
  DependencySubscription,
  DraftClaim,
  EvidenceRecord,
  FingerprintSnapshot,
  LedgerClaim,
  PageEntity,
  WriterClaimLedger
} from '@docstube/contracts';
import {
  claimLedgerSchema,
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
// Resolution never invents: an unknown symbol, value name, or file drops the proposal with a
// recorded warning.

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

export type AnchorLedgerResult = {
  ledger: ClaimLedger;
  anchored: AnchoredClaim[];
  // Canonical evidence records minted during anchoring (source-linked grounding for resolved
  // symbol proposals) — provenance-v2 storage is wave 2b-iii; tests and the verifier wave consume
  // these directly for now.
  evidence: EvidenceRecord[];
  warnings: string[];
};

export type AnchorLedgerInput = {
  mdx: string;
  writerLedger: WriterClaimLedger;
  // The extracted (and id-matched) page the MDX parsed into — block ids anchor the claims.
  page: PageEntity;
  fingerprints: FingerprintSnapshot;
  commit: string;
};

const resolveSubscriptions = (
  claim: DraftClaim,
  fingerprints: FingerprintSnapshot,
  warnings: string[]
): DependencySubscription[] => {
  const symbolByHash = new Map(fingerprints.symbols.map((symbol) => [symbol.symbolHash as string, symbol]));
  const fileByPath = new Map(fingerprints.unparsedFiles.map((file) => [file.file, file]));
  const resolved: DependencySubscription[] = [];
  for (const subscription of claim.proposedSubscriptions) {
    if (subscription.kind === 'file-content') {
      const file = fileByPath.get(subscription.file);
      if (file === undefined) {
        warnings.push(
          `claim "${claim.markerId}": file-content subscription to "${subscription.file}" dropped — the file is not in the fingerprint snapshot`
        );
        continue;
      }
      // The snapshot hash is authoritative — the writer cannot know content hashes.
      resolved.push({ kind: 'file-content', file: file.file, contentHash: file.contentHash });
      continue;
    }
    const symbol = symbolByHash.get(subscription.symbolHash as string);
    if (symbol === undefined) {
      warnings.push(
        `claim "${claim.markerId}": ${subscription.kind} subscription dropped — symbol ${subscription.symbolHash} is not in the fingerprint snapshot`
      );
      continue;
    }
    if (subscription.kind === 'signature' && symbol.signaturePrint === undefined) {
      warnings.push(
        `claim "${claim.markerId}": signature subscription dropped — symbol ${subscription.symbolHash} has no signature print`
      );
      continue;
    }
    if (subscription.kind === 'body' && symbol.bodyPrint === undefined) {
      warnings.push(
        `claim "${claim.markerId}": body subscription dropped — symbol ${subscription.symbolHash} has no body print`
      );
      continue;
    }
    if (subscription.kind === 'cited-value' && symbol.valuePrints[subscription.valueName] === undefined) {
      warnings.push(
        `claim "${claim.markerId}": cited-value subscription dropped — symbol ${subscription.symbolHash} has no value named "${subscription.valueName}"`
      );
      continue;
    }
    resolved.push(subscription);
  }
  return resolved;
};

// Minted grounding for resolved symbol proposals: 'source-linked' asserts only that the subject
// is real (trust-model-v2 decision 3) — it never decides correctness, so the claims stay
// unchecked. file/url/check proposals mint nothing here: they are verifier input (wave 2b-ii).
const mintSymbolEvidence = (
  claim: DraftClaim,
  fingerprints: FingerprintSnapshot,
  commit: string,
  warnings: string[]
): EvidenceRecord[] => {
  const known = new Set(fingerprints.symbols.map((symbol) => symbol.symbolHash as string));
  const records: EvidenceRecord[] = [];
  for (const proposal of claim.proposedEvidence) {
    if (proposal.kind !== 'symbol') {
      continue;
    }
    if (!known.has(proposal.symbol as string)) {
      warnings.push(
        `claim "${claim.markerId}": symbol evidence dropped — symbol ${proposal.symbol} is not in the fingerprint snapshot`
      );
      continue;
    }
    records.push(
      evidenceRecordSchema.parse({
        evidenceId: mintId(idPrefixes.evidence),
        ref: {
          kind: 'source-linked',
          symbol: symbolSourceKeySchema.parse(proposal.symbol),
          ...(proposal.file === undefined ? {} : { file: proposal.file }),
          ...(proposal.span === undefined ? {} : { span: proposal.span }),
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
  const blocks = flattenBlocks(input.page);
  const ranges = blockSourceRanges(input.mdx);
  // submit_page already guaranteed marker/ledger agreement; scan errors here would mean the MDX
  // was altered after acceptance, which is a kernel bug — surface as warnings, never invent.
  const scan = scanClaimMarkers(input.mdx);
  warnings.push(...scan.errors);
  const markerByid = new Map(scan.markers.map((marker) => [marker.markerId, marker]));

  const anchored: AnchoredClaim[] = [];
  const evidence: EvidenceRecord[] = [];
  for (const draft of input.writerLedger.claims) {
    const marker = markerByid.get(draft.markerId);
    if (marker === undefined) {
      warnings.push(`claim "${draft.markerId}" dropped — its marker is missing from the accepted MDX`);
      continue;
    }
    const blockIndex = ranges.findIndex(([start, end]) => marker.offset >= start && marker.offset < end);
    const block = blockIndex === -1 ? undefined : blocks[blockIndex];
    if (block === undefined) {
      warnings.push(
        `claim "${draft.markerId}" dropped — its marker does not sit inside any content block (headings and frontmatter cannot carry claims)`
      );
      continue;
    }
    const claimEvidence = mintSymbolEvidence(draft, input.fingerprints, input.commit, warnings);
    evidence.push(...claimEvidence);
    const claim: LedgerClaim = {
      claimId: mintId(idPrefixes.claim),
      class: draft.class,
      predicate: draft.predicate,
      anchor: { blockId: block.id, markerId: draft.markerId },
      // The content-derived block revision — never a git commit (trust-model-v2).
      scope: { entityId: block.id, revision: entityRevisionSchema.parse(block.contentHash) },
      subscriptions: resolveSubscriptions(draft, input.fingerprints, warnings),
      evidence: claimEvidence.map((record) => record.evidenceId),
      correctness: 'unchecked',
      disposition: draft.class === 'intent-history' ? 'maintainer-input-needed' : 'no-checker-available'
    };
    anchored.push({ claim, markerId: draft.markerId, quote: marker.innerMdx });
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
  return { ledger, anchored, evidence, warnings };
};
