import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ClaimEvidence,
  ClaimLedger,
  Codemap,
  EvidenceRecord,
  Finding,
  FingerprintSnapshot,
  LedgerClaim,
  SymbolRecord,
  VerifierRunResult
} from '@docstube/contracts';
import {
  bindCitedValue,
  claimEvidenceSchema,
  claimLedgerSchema,
  evidenceRecordSchema,
  gitCommitSchema,
  idPrefixes,
  mintId,
  normalizeCitedValue,
  sha256Hex,
  symbolSourceKeySchema
} from '@docstube/contracts';
import type { LanguagePackDefinition } from '@docstube/plugin-sdk';
import type { AnchoredClaim, RejectedProposal } from './anchor-ledger.ts';

// The claim-verification stage (wave 2b-ii, ARCHITECTURE §4.2, trust-model-v2 decision 3): runs
// AFTER anchoring and claim-id matching, and assigns each claim's correctness/disposition from
// the class/evidence AUTHORITY TABLE by minting canonical EvidenceRecords. State is computed,
// never asserted:
//
//   code-structure  codemap grounding suffices — the grounding symbol resolves in the codemap →
//                   'codemap-grounding' evidence, outcome pass → checked. A missing identifier is
//                   a HARD DEFECT for every class (the stale-naming hallucination class).
//   value           the 0.1.0 MINIMAL VALUE-PREDICATE VERIFIER: each cited-value subscription is
//                   compared byte-wise against the language pack's extractCitedValues output for
//                   the claim's symbol — both sides normalized by the SAME value-name grammar the
//                   valuePrints facet hashes. Match → checked; mismatch → CONTRADICTED (a caught
//                   lie, gating); unresolvable at verify time → stays unchecked (never guess).
//   behavior        checked ONLY when a PASSING snippet explicitly declared the claim via its
//                   fence meta (```ts covers=c3,c5 — validated by submit_page, returned by the
//                   snippet-exec verifier as covered marker ids). Containment (same section, same
//                   page) narrows nothing and mints nothing — coverage is always declared.
//   intent-history  stays unchecked / maintainer-input-needed in this slice — owner-attestation
//                   evidence arrives with the KnowledgeFact wiring in a later wave.
//   (unknown class) unchecked / no-checker-available until a promoted project-defined verifier
//                   declares support.
//
// Contradictions and grounding failures return BLOCKING error findings: the page fails
// verification and enters the existing bounded retry path; after retries it ships flagged, never
// as neutral content.

export const CLAIM_VERIFICATION_CHECK = 'claim-verification';

// The snippet-execution verifier id (packages/verifiers snippet-exec.ts) — the one execution
// checker behavior claims may cite in 0.1.0.
const SNIPPET_EXEC_CHECK = 'snippet-exec';

// Additive language-pack capability, duck-typed like codemap's FingerprintCapablePack: packs that
// can extract cited values at verify time expose extractCitedValues (lang-typescript does).
type CitedValueExtractor = (input: { file: string; content: string; symbol?: string }) => Record<string, string>;

export type VerifyClaimsInput = {
  ledger: ClaimLedger;
  anchored: AnchoredClaim[];
  // Canonical evidence minted during anchoring (source-linked grounding) — claims reference them
  // by id; this stage folds them into the per-claim ClaimEvidence records.
  anchorEvidence: EvidenceRecord[];
  rejectedProposals: RejectedProposal[];
  codemap: Codemap;
  packs: LanguagePackDefinition[];
  repoRoot: string;
  // The typed-fingerprint snapshot the run was planned against: value re-extraction is validated
  // against its valuePrints — evidence is never minted from bytes the snapshot never saw.
  fingerprints: FingerprintSnapshot;
  // Deterministic verifier results from the verify stage of THIS attempt (execution coverage).
  verifierResults: VerifierRunResult[];
  commit: string;
};

export type VerifyClaimsResult = {
  ledger: ClaimLedger;
  anchored: AnchoredClaim[];
  // The canonical per-claim trust projection (provenance-v2) — the ONLY reader-facing record.
  claimEvidence: ClaimEvidence[];
  // Blocking error findings: contradictions, grounding failures, value-binding violations.
  // Non-empty ⇒ the page fails.
  findings: Finding[];
  // Non-blocking observations (e.g. the source moved mid-run so a value stayed unchecked) —
  // journaled by the caller, never gating.
  warnings: string[];
};

const citedValueExtractorFor = (packs: LanguagePackDefinition[], file: string): CitedValueExtractor | undefined => {
  for (const pack of packs) {
    if (pack.fileExtensions.some((extension) => file.endsWith(extension))) {
      const capability = (pack as { extractCitedValues?: unknown }).extractCitedValues;
      if (typeof capability === 'function') {
        return capability as CitedValueExtractor;
      }
    }
  }
  return undefined;
};

export const verifyClaims = async (input: VerifyClaimsInput): Promise<VerifyClaimsResult> => {
  const now = new Date().toISOString();
  const commit = gitCommitSchema.parse(input.commit);
  const findings: Finding[] = [];
  const warnings: string[] = [];
  const claimEvidence: ClaimEvidence[] = [];
  const symbolByHash = new Map<string, SymbolRecord>(input.codemap.symbols.map((symbol) => [symbol.hash, symbol]));
  const anchorEvidenceById = new Map(input.anchorEvidence.map((record) => [record.evidenceId, record]));
  const snapshotValuePrints = new Map(
    input.fingerprints.symbols.map((symbol) => [symbol.symbolHash as string, symbol.valuePrints])
  );

  // Grounding failures are hard defects for EVERY class (trust-model-v2 decision 3): a claim that
  // referenced a symbol absent from the snapshot cited an identifier the code does not have.
  const seenGroundingFailures = new Set<string>();
  for (const rejected of input.rejectedProposals) {
    if (rejected.code !== 'unknown-symbol' || seenGroundingFailures.has(`${rejected.markerId}:${rejected.reason}`)) {
      continue;
    }
    seenGroundingFailures.add(`${rejected.markerId}:${rejected.reason}`);
    findings.push({
      source: 'verifier',
      check: CLAIM_VERIFICATION_CHECK,
      severity: 'error',
      message: `claim "${rejected.markerId}" grounding failure — ${rejected.reason}. The identifier does not exist in the source: fix the claim to reference a real symbol (hash from the API surface list) or remove the assertion`,
      data: { markerId: rejected.markerId, kind: 'grounding-failure' }
    });
  }

  // Explicit execution coverage (impl-06 finding 2): a PASSING snippet-exec run returns the
  // marker ids its fences declared via covers= (alongside the executed block ids). A behavior
  // claim is checked ONLY when its own marker id appears here — declared coverage, never
  // proximity. (A failing snippet already failed the page before this stage.)
  const executionCoveredMarkerIds = new Set(
    input.verifierResults
      .filter((result) => result.verifier === SNIPPET_EXEC_CHECK && result.status === 'pass')
      .flatMap((result) => result.coveredEntityIds)
  );

  const fileContentCache = new Map<string, string | undefined>();
  const readRepoFile = async (file: string): Promise<string | undefined> => {
    if (!fileContentCache.has(file)) {
      try {
        fileContentCache.set(file, await readFile(join(input.repoRoot, file), 'utf8'));
      } catch {
        fileContentCache.set(file, undefined);
      }
    }
    return fileContentCache.get(file);
  };

  const verifiedAnchored: AnchoredClaim[] = [];
  for (const entry of input.anchored) {
    const claim = entry.claim;
    const ownEvidence = claim.evidence
      .map((id) => anchorEvidenceById.get(id))
      .filter((record): record is EvidenceRecord => record !== undefined);
    const minted: EvidenceRecord[] = [];
    let correctness: LedgerClaim['correctness'] = 'unchecked';
    let disposition: LedgerClaim['disposition'] =
      claim.class === 'intent-history' ? 'maintainer-input-needed' : 'no-checker-available';
    let decidingEvidenceId: string | undefined;

    if (claim.class === 'code-structure') {
      // Grounding symbols: resolved source-linked evidence plus symbol-bearing subscriptions.
      const candidateSymbols = [
        ...ownEvidence.flatMap((record) => (record.ref.kind === 'source-linked' ? [record.ref.symbol as string] : [])),
        ...claim.subscriptions.flatMap((subscription) =>
          subscription.kind === 'file-content' ? [] : [subscription.symbolHash as string]
        )
      ];
      const grounded = candidateSymbols.map((hash) => symbolByHash.get(hash)).find((record) => record !== undefined);
      if (grounded !== undefined) {
        const record = evidenceRecordSchema.parse({
          evidenceId: mintId(idPrefixes.evidence),
          ref: {
            kind: 'codemap-grounding',
            symbol: symbolSourceKeySchema.parse(grounded.hash),
            file: grounded.file,
            span: grounded.span,
            commit
          },
          checkedAt: now,
          sourceRevision: commit,
          outcome: 'pass',
          detail: `symbol ${grounded.name} resolves in the verified codemap (${grounded.file}:${grounded.span[0]})`
        });
        minted.push(record);
        // Grounding suffices as checked for the existence/shape class ONLY (decision 3).
        correctness = 'checked';
        disposition = null;
        decidingEvidenceId = record.evidenceId;
      }
      // No grounding symbol at all: nothing checkable — the claim stays unchecked (the coverage
      // linter, a later wave, is what argues with claims that dodge grounding entirely).
    } else if (claim.class === 'value') {
      // The minimal value-predicate verifier. A value claim is checked only when EVERY cited-value
      // subscription resolved and passed; ANY mismatch contradicts; anything unresolvable at
      // verify time leaves the claim unchecked — the kernel never guesses. Two deterministic
      // preconditions guard every comparison:
      //   1. VALUE BINDING (defense in depth behind submit_page, impl-07 finding 1): the asserted
      //      value must appear in BOTH the AST-derived visible marker text AND the predicate,
      //      unambiguously and un-negated — the SAME shared contracts rule submit_page enforces.
      //      Otherwise the ledger asserts a value the reader never sees and 'checked' would
      //      launder wrong prose. Blocking finding.
      //   2. SNAPSHOT AGREEMENT (impl-06 finding 7): the re-extracted value's hash must equal the
      //      fingerprint snapshot's valuePrint. A mismatch means the working tree moved mid-run —
      //      the claim stays unchecked with a warning; evidence is NEVER minted from bytes the
      //      snapshot never saw.
      const citedSubscriptions = claim.subscriptions.filter((sub) => sub.kind === 'cited-value');
      let unresolvable = citedSubscriptions.length === 0;
      let bindingViolated = false;
      let firstPass: EvidenceRecord | undefined;
      let firstFail: EvidenceRecord | undefined;
      for (const subscription of citedSubscriptions) {
        // Both sides of the comparison go through the ONE shared normalization (bare, quoted, and
        // numeric spellings agree) — the committed subscription is already canonical from
        // anchoring; re-normalizing keeps replayed/legacy ledgers honest too.
        const asserted = normalizeCitedValue(subscription.citedValue).canonical;
        const binding = bindCitedValue(subscription.citedValue, {
          markerText: entry.visibleText,
          predicate: claim.predicate
        });
        if (!binding.ok) {
          bindingViolated = true;
          for (const issue of binding.issues) {
            findings.push({
              source: 'verifier',
              check: CLAIM_VERIFICATION_CHECK,
              severity: 'error',
              message:
                `claim "${entry.markerId}" (cited-value "${subscription.valueName}", visible prose ` +
                `"${entry.visibleText}"): ${issue.message}. Fix the prose or the citedValue/predicate so they agree`,
              data: {
                markerId: entry.markerId,
                kind: 'value-binding',
                bindingIssue: issue.code,
                valueName: subscription.valueName,
                assertedValue: asserted
              }
            });
          }
          continue;
        }
        const symbol = symbolByHash.get(subscription.symbolHash as string);
        const content = symbol === undefined ? undefined : await readRepoFile(symbol.file);
        const extractor = symbol === undefined ? undefined : citedValueExtractorFor(input.packs, symbol.file);
        if (symbol === undefined || content === undefined || extractor === undefined) {
          unresolvable = true;
          continue;
        }
        // Full-file extraction: value names are prefixed with their owning symbol path, so the
        // grammar makes them unique per file — the subscription's valueName indexes directly.
        const extractedValue = extractor({ file: symbol.file, content })[subscription.valueName];
        if (extractedValue === undefined) {
          // The value name no longer resolves (or never did) — no checker outcome, never a guess.
          unresolvable = true;
          continue;
        }
        const snapshotPrint = snapshotValuePrints.get(subscription.symbolHash as string)?.[subscription.valueName];
        if (snapshotPrint === undefined || sha256Hex(extractedValue) !== snapshotPrint) {
          // The bytes on disk are not the bytes the run snapshot fingerprinted (dirty worktree or
          // a mid-run edit). Unchecked + warning — never evidence the snapshot cannot vouch for.
          unresolvable = true;
          warnings.push(
            `claim "${entry.markerId}": the source value "${subscription.valueName}" in ${symbol.file} no longer ` +
              'matches the fingerprint snapshot this run was planned against (the working tree moved mid-run) — ' +
              'the claim stays unchecked; rerun generate against a settled tree'
          );
          continue;
        }
        // Byte-wise comparison of two strings normalized by the same cited-value grammar.
        const matches = extractedValue === asserted;
        const record = evidenceRecordSchema.parse({
          evidenceId: mintId(idPrefixes.evidence),
          ref: {
            kind: 'value-predicate',
            symbol: subscription.symbolHash,
            valueName: subscription.valueName,
            assertedValue: asserted,
            extractedValue
          },
          checkedAt: now,
          sourceRevision: commit,
          outcome: matches ? 'pass' : 'fail',
          detail: matches
            ? `docs assert ${asserted} for ${subscription.valueName}; source agrees`
            : `docs assert ${asserted} for ${subscription.valueName}, source says ${extractedValue}`
        });
        minted.push(record);
        if (matches) {
          firstPass ??= record;
        } else {
          firstFail ??= record;
          findings.push({
            source: 'verifier',
            check: CLAIM_VERIFICATION_CHECK,
            severity: 'error',
            message:
              `claim "${entry.markerId}" is CONTRADICTED by the source — predicate: "${claim.predicate}"; ` +
              `${subscription.valueName} is asserted as ${asserted} but the code extracts ${extractedValue} ` +
              `(${symbol.file}). Correct the documented value to match the source, or fix the subscription if it names the wrong value`,
            file: symbol.file,
            data: {
              markerId: entry.markerId,
              kind: 'contradiction',
              valueName: subscription.valueName,
              assertedValue: asserted,
              extractedValue
            }
          });
        }
      }
      if (firstFail !== undefined) {
        // A contradiction is a recorded negative check: it gates regardless of other passes.
        correctness = 'contradicted';
        disposition = null;
        decidingEvidenceId = firstFail.evidenceId;
      } else if (firstPass !== undefined && !unresolvable && !bindingViolated) {
        correctness = 'checked';
        disposition = null;
        decidingEvidenceId = firstPass.evidenceId;
      }
    } else if (claim.class === 'behavior') {
      // Explicit execution coverage only: a passing snippet DECLARED this claim via covers=.
      // Same-section containment mints nothing; an undeclared console.log next door proves
      // nothing about "retry retries the call".
      if (executionCoveredMarkerIds.has(entry.markerId)) {
        const record = evidenceRecordSchema.parse({
          evidenceId: mintId(idPrefixes.evidence),
          ref: {
            kind: 'execution',
            check: SNIPPET_EXEC_CHECK,
            environment: {
              os: process.platform,
              runtimeVersions: { node: process.versions.node },
              sandbox: 'none'
            }
          },
          checkedAt: now,
          sourceRevision: commit,
          outcome: 'pass',
          detail: `a code sample declaring covers=${entry.markerId} executed successfully via ${SNIPPET_EXEC_CHECK}`
        });
        minted.push(record);
        correctness = 'checked';
        disposition = null;
        decidingEvidenceId = record.evidenceId;
      }
    }
    // intent-history and unknown classes: initial disposition stands (set above) — attestation
    // and promoted project-defined verifiers are later waves.

    const updatedClaim: LedgerClaim = {
      ...claim,
      evidence: [...claim.evidence, ...minted.map((record) => record.evidenceId)],
      correctness,
      disposition,
      ...(decidingEvidenceId === undefined ? {} : { decidingEvidenceId })
    };
    verifiedAnchored.push({ ...entry, claim: updatedClaim });
    // The canonical ClaimEvidence record — .parse enforces the full class/evidence authority
    // table and the uniqueness invariants; a violation here is a kernel bug, never user data.
    claimEvidence.push(
      claimEvidenceSchema.parse({
        schemaVersion: 1,
        claimId: updatedClaim.claimId,
        class: updatedClaim.class,
        correctness,
        disposition,
        evidence: [...ownEvidence, ...minted],
        ...(decidingEvidenceId === undefined ? {} : { decidingEvidenceId })
      })
    );
  }

  const ledger = claimLedgerSchema.parse({
    ...input.ledger,
    claims: verifiedAnchored.map((entry) => entry.claim)
  });
  return { ledger, anchored: verifiedAnchored, claimEvidence, findings, warnings };
};
