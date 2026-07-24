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
  SymbolRecord
} from '@docstube/contracts';
import {
  assessClaimCheckability,
  bindCitedValue,
  bindClaimSubject,
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
//   code-structure  codemap grounding decides ONLY canonically phrased existence claims (the
//                   fail-closed checkability grammar, impl-12): the grounding symbol resolves in
//                   the codemap AND the claim sits inside the canonical grammar →
//                   'codemap-grounding' evidence, outcome pass → checked. Arbitrary prose outside
//                   the grammar stays unchecked with a journaled note — never argued with. A
//                   missing identifier is still a HARD DEFECT for every class (the stale-naming
//                   hallucination class).
//   value           the 0.1.0 MINIMAL VALUE-PREDICATE VERIFIER: each cited-value subscription is
//                   compared byte-wise against the language pack's extractCitedValues output for
//                   the claim's symbol — both sides normalized by the SAME value-name grammar the
//                   valuePrints facet hashes. Match → checked; mismatch → CONTRADICTED (a caught
//                   lie, gating); unresolvable at verify time → stays unchecked (never guess).
//   behavior        UNCHECKED in 0.1.0, always — disposition 'no-checker-available' (trust-model-v2
//                   decision 3: behavior claims stay honestly unchecked until the v1.x predicate
//                   verifiers; the covers= execution-coverage path was removed as a deliberate
//                   scope correction — snippet execution proves code EXAMPLES run, block-level,
//                   never per-claim behavior).
//   intent-history  stays unchecked / maintainer-input-needed in this slice — owner-attestation
//                   evidence arrives with the KnowledgeFact wiring in a later wave.
//   (unknown class) unchecked / no-checker-available until a promoted project-defined verifier
//                   declares support.
//
// Contradictions and grounding failures return BLOCKING error findings: the page fails
// verification and enters the existing bounded retry path; after retries it ships flagged, never
// as neutral content.

export const CLAIM_VERIFICATION_CHECK = 'claim-verification';

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
      const resolved = candidateSymbols
        .map((hash) => symbolByHash.get(hash))
        .filter((record): record is SymbolRecord => record !== undefined);
      // SUBJECT BINDING re-check (impl-09 finding 1 + impl-10 finding 1 + the polarity finding,
      // defense in depth behind anchoring): grounding may only mint from a symbol BOTH the visible
      // prose AND the predicate actually NAME, with AGREEING POLARITY — otherwise
      // "`inventedFunction` exists" would launder through any real symbol's hash, and
      // "`greet` does not exist" would ride real greet evidence into checked. Resolved but
      // unbound/mismatched symbols mint nothing; the claim stays unchecked with a journaled
      // warning. An AGREED negative assertion binds but is NOT existence-checkable: codemap
      // grounding proves the symbol's PRESENCE, never an absence or non-behavior — the claim
      // stays unchecked / no-checker-available with a journaled note.
      const bindings = resolved.map((record) => ({
        record,
        binding: bindClaimSubject({
          subjectName: record.name,
          markerText: entry.visibleText,
          predicate: claim.predicate
        })
      }));
      // CHECKABILITY GRAMMAR (wave 2b close FINAL, impl-12 — the fail-closed backstop behind the
      // negation-cue fast paths): a bound positive subject alone is NOT enough. Grounding evidence
      // may only DECIDE a claim whose predicate is a canonical existence assertion AND whose
      // visible window contains only allowlisted vocabulary — "`greet` is absent" over predicate
      // "greet exists" passes every cue detector but is unknown vocabulary here, so it stays
      // honestly unchecked instead of minting 'checked'.
      const assessed = bindings.map((bound) => ({
        ...bound,
        checkability:
          bound.binding.ok && !bound.binding.negated
            ? assessClaimCheckability({
                style: 'existence',
                subjectName: bound.record.name,
                markerText: entry.visibleText,
                predicate: claim.predicate
              })
            : undefined
      }));
      const grounded = assessed.find(({ checkability }) => checkability?.checkable === true)?.record;
      if (grounded === undefined && resolved.length > 0) {
        const negated = bindings.find(({ binding }) => binding.ok && binding.negated);
        const mismatch = bindings.find(({ binding }) => !binding.ok && binding.code === 'polarity-mismatch');
        const outsideGrammar = assessed.find(
          ({ checkability }) => checkability !== undefined && !checkability.checkable
        );
        if (outsideGrammar?.checkability !== undefined && !outsideGrammar.checkability.checkable) {
          warnings.push(
            `claim "${entry.markerId}": OUTSIDE THE CANONICAL CHECKABLE GRAMMAR — ` +
              `${outsideGrammar.checkability.reason}. Existence evidence only decides canonically phrased claims ` +
              `("${outsideGrammar.record.name} exists"-style, tight marker span); no grounding evidence minted — ` +
              'the claim stays unchecked (no-checker-available)'
          );
        } else if (negated !== undefined) {
          warnings.push(
            `claim "${entry.markerId}": the prose and predicate assert a NEGATIVE fact about ` +
              `"${negated.record.name}" ("${claim.predicate}") — codemap grounding proves presence, never absence, ` +
              'so no grounding evidence is minted; the claim stays unchecked (no-checker-available). Negative ' +
              'assertions cannot be mechanically checked in 0.1.0'
          );
        } else if (mismatch !== undefined && !mismatch.binding.ok && mismatch.binding.code === 'polarity-mismatch') {
          warnings.push(
            `claim "${entry.markerId}": POLARITY MISMATCH on subject "${mismatch.record.name}" — the ` +
              `${mismatch.binding.negatedIn === 'marker' ? 'visible prose' : 'predicate'} negates the subject while ` +
              `the other side asserts it ("${entry.visibleText}" vs "${claim.predicate}") — no grounding evidence ` +
              'minted; the claim stays unchecked'
          );
        } else {
          warnings.push(
            `claim "${entry.markerId}": grounding symbol ${resolved
              .map((record) => `"${record.name}"`)
              .join(', ')} resolved but is not named by BOTH the visible prose ("${entry.visibleText}") AND the ` +
              'predicate (subject-unbound) — no grounding evidence minted; the claim stays unchecked'
          );
        }
      }
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
        // Grounding decides ONLY canonically phrased existence claims (decision 3 narrowed by
        // the impl-12 checkability grammar).
        correctness = 'checked';
        disposition = null;
        decidingEvidenceId = record.evidenceId;
      }
      // No grounding symbol at all: nothing checkable — the claim stays unchecked (the coverage
      // linter, a later wave, is what argues with claims that dodge grounding entirely).
    } else if (claim.class === 'value') {
      // The minimal value-predicate verifier. A value claim is checked only when EVERY cited-value
      // subscription resolved and passed; ANY mismatch contradicts; anything unresolvable at
      // verify time leaves the claim unchecked — the kernel never guesses. Three deterministic
      // preconditions guard every comparison (value binding, subject binding, snapshot agreement):
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
        if (symbol !== undefined) {
          // SUBJECT BINDING re-check (impl-09 finding 1, tightened by impl-10 findings 1+2): the
          // value comparison may only run when BOTH the visible prose AND the predicate name the
          // subject's ROOT identifier (the codemap record's name — a valueName path segment never
          // substitutes) — otherwise "`INVENTED_DEFAULT` is 3" would launder through any real
          // value that happens to equal 3, and a common leaf like 'config' would bind unrelated
          // values. No evidence minted; warning journaled.
          const subjectBinding = bindClaimSubject({
            subjectName: symbol.name,
            valueNames: [subscription.valueName],
            markerText: entry.visibleText,
            predicate: claim.predicate
          });
          if (!subjectBinding.ok) {
            unresolvable = true;
            warnings.push(
              subjectBinding.code === 'polarity-mismatch'
                ? `claim "${entry.markerId}": POLARITY MISMATCH on subject "${symbol.name}" — the ` +
                    `${subjectBinding.negatedIn === 'marker' ? 'visible prose' : 'predicate'} negates the subject ` +
                    `while the other side asserts it ("${entry.visibleText}" vs "${claim.predicate}") — no value ` +
                    'evidence minted; the claim stays unchecked'
                : `claim "${entry.markerId}": the cited value "${subscription.valueName}" points at symbol ` +
                    `"${symbol.name}", but the visible prose ("${entry.visibleText}") and the predicate do not BOTH ` +
                    'name it (subject-unbound) — no value evidence minted; the claim stays unchecked'
            );
            continue;
          }
          if (subjectBinding.negated) {
            // NEGATED PREDICATES ARE NOT VALUE-CHECKABLE: an agreed negative assertion about the
            // subject cannot be decided by comparing the extracted value — the comparison proves
            // what the value IS, never what the sentence denies. Unchecked, journaled note.
            unresolvable = true;
            warnings.push(
              `claim "${entry.markerId}": the prose and predicate assert a NEGATIVE fact about "${symbol.name}" ` +
                `("${claim.predicate}") — the value-predicate verifier proves what a value IS, never an absence or ` +
                'non-behavior, so no value evidence is minted; the claim stays unchecked (no-checker-available). ' +
                'Negative assertions cannot be mechanically checked in 0.1.0'
            );
            continue;
          }
          // CHECKABILITY GRAMMAR (impl-12, the fail-closed backstop): the value comparison may
          // only DECIDE a canonically phrased claim. Non-canonical prose/predicates skip the
          // comparison entirely and stay unchecked — the kernel never argues with prose the
          // grammar cannot vouch for.
          const checkability = assessClaimCheckability({
            style: 'value',
            subjectName: symbol.name,
            valueNames: [subscription.valueName],
            citedValue: subscription.citedValue,
            markerText: entry.visibleText,
            predicate: claim.predicate
          });
          if (!checkability.checkable) {
            unresolvable = true;
            warnings.push(
              `claim "${entry.markerId}": OUTSIDE THE CANONICAL CHECKABLE GRAMMAR — ${checkability.reason}. ` +
                `Value evidence only decides canonically phrased claims ("${symbol.name} defaults to <value>"-style, ` +
                'tight marker span); no value evidence minted — the claim stays unchecked (no-checker-available)'
            );
            continue;
          }
        }
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
    }
    // behavior: deliberately NO checker in 0.1.0 — the claim stays unchecked with disposition
    // 'no-checker-available', always (trust-model-v2 decision 3; the covers= execution-coverage
    // path was removed as a scope correction). intent-history and unknown classes: initial
    // disposition stands (set above) — attestation and promoted project-defined verifiers are
    // later waves.

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
