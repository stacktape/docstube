import { describe, expect, it } from 'vitest';
import { evaluateSubmitPageCall } from '@docstube/agent-runtime';
import {
  codemapSchema,
  fingerprintSnapshotSchema,
  pageShardSchema,
  provenanceV2Schema,
  writerClaimLedgerSchema
} from '@docstube/contracts';
import type { Codemap, FingerprintSnapshot, ObservedRead, PageShard, WriterClaimLedger } from '@docstube/contracts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { anchorWriterLedger } from './anchor-ledger.ts';
import { verifyClaims } from './verify-claims.ts';

// THE IMPL-12 FULL-SPINE PROBE, as a permanent e2e test. Sol's round-6 bypass: visible
// "`greet` is absent." with predicate "greet exists" and REAL greet evidence sailed through
// submit → anchor → verify and reached the reader as 1/1 CHECKED. Under the fail-closed
// checkability grammar the same spine must end with the persisted shard carrying the claim as
// UNCHECKED (0 of 1 checked) — the reader projection is literal over ClaimEvidence (theme
// proof-projection.spec proves that side), so a shard that never says 'checked' can never render
// 1/1. The canonical positive keeps minting checked end to end.

const COMMIT = 'b'.repeat(40);
const GREET_SYMBOL = `ts:${'7'.repeat(64)}`;
const PRINT = '8'.repeat(64);
const READ_HASH = '9'.repeat(64);

const fingerprints: FingerprintSnapshot = fingerprintSnapshotSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [{ symbolHash: GREET_SYMBOL, signaturePrint: PRINT, valuePrints: {}, bodyPrint: PRINT }],
  unparsedFiles: []
});

const codemap: Codemap = codemapSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [{ hash: GREET_SYMBOL, lang: 'ts', kind: 'function', name: 'greet', file: 'src/greet.ts', span: [1, 3] }]
});

const observedReads: ObservedRead[] = [{ file: 'src/greet.ts', contentHash: READ_HASH }];

const pageMdx = (claimProse: string): string => `---
title: "Greet"
---

# Greet

<Claim id="g1">${claimProse}</Claim>
`;

const writerLedger = (predicate: string): WriterClaimLedger =>
  writerClaimLedgerSchema.parse({
    schemaVersion: 1,
    claims: [
      {
        markerId: 'g1',
        class: 'code-structure',
        predicate,
        proposedEvidence: [{ kind: 'symbol', symbol: GREET_SYMBOL }],
        proposedSubscriptions: [{ kind: 'signature', symbolHash: GREET_SYMBOL }]
      }
    ]
  });

// The spine: submit_page validation → kernel anchoring → claim verification → persisted shard.
const runSpine = async (claimProse: string, predicate: string) => {
  const mdx = pageMdx(claimProse);
  const ledger = writerLedger(predicate);

  // 1. submit_page ACCEPTS — the writer-side gate cannot catch lexical bypasses; the grammar is
  //    the evidence-decision backstop, not an in-session repair.
  const submission = evaluateSubmitPageCall({ mdx, ledger });
  expect(submission.response.accepted).toBe(true);

  // 2. Kernel anchoring accepts (subject bound, polarity agreed — 'absent' is exactly the
  //    vocabulary the cue detectors never listed).
  const page = extractPageEntity({ mdx, slug: 'greet' });
  const anchored = anchorWriterLedger({
    mdx,
    writerLedger: ledger,
    page,
    fingerprints,
    codemap,
    observedReads,
    commit: COMMIT
  });
  if (!anchored.ok) {
    throw new Error(`anchoring failed: ${anchored.errors.map((issue) => issue.message).join('; ')}`);
  }

  // 3. Claim verification — the enforcement point.
  const verified = await verifyClaims({
    ledger: anchored.ledger,
    anchored: anchored.anchored,
    anchorEvidence: anchored.evidence,
    rejectedProposals: anchored.rejectedProposals,
    codemap,
    packs: [],
    repoRoot: 'unused',
    fingerprints,
    commit: COMMIT
  });

  // 4. The persisted shard — the exact record every reader surface projects from.
  const shard: PageShard = pageShardSchema.parse({
    schemaVersion: 2,
    locale: 'en',
    version: 'latest',
    sourceCommit: COMMIT,
    generatedAt: new Date().toISOString(),
    page,
    ledger: verified.ledger,
    provenance: provenanceV2Schema.parse({ schemaVersion: 1, claimEvidence: verified.claimEvidence }),
    flags: []
  });
  return { anchored, verified, shard };
};

describe('impl-12 full-spine probe: submit → anchor → verify → shard', () => {
  it("'`greet` is absent.' over predicate 'greet exists' persists UNCHECKED — the reader can never see 1/1 checked", async () => {
    const { anchored, verified, shard } = await runSpine('`greet` is absent.', 'greet exists');

    // Anchoring journaled the non-blocking destined-unchecked hint (phrasing improvement is
    // opportunistic, never a repair spiral).
    expect(anchored.warnings.some((warning) => warning.includes('destined to ship UNCHECKED'))).toBe(true);

    // Verification: no findings (unchecked is legal), no grounding evidence, unchecked state.
    expect(verified.findings).toEqual([]);
    expect(verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);

    // The persisted shard — what the theme's literal projection consumes: 0 of 1 checked.
    const records = shard.provenance?.claimEvidence ?? [];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    expect(records[0]?.decidingEvidenceId).toBeUndefined();
    expect(records[0]?.evidence.every((record) => record.ref.kind !== 'codemap-grounding')).toBe(true);
    expect(records.filter((record) => record.correctness === 'checked')).toHaveLength(0);
    expect(shard.ledger?.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
  });

  it("the long-window variant ('… that is not defined') persists UNCHECKED too", async () => {
    const { verified, shard } = await runSpine(
      '`greet` is available as the value of the option of the key that is not defined.',
      'greet exists'
    );
    expect(verified.findings).toEqual([]);
    expect(shard.provenance?.claimEvidence[0]).toMatchObject({
      correctness: 'unchecked',
      disposition: 'no-checker-available'
    });
    expect(shard.provenance?.claimEvidence.filter((record) => record.correctness === 'checked')).toHaveLength(0);
  });

  it("the canonical positive '`greet` exists.' still mints CHECKED end to end", async () => {
    const { anchored, verified, shard } = await runSpine('`greet` exists.', 'greet exists');
    expect(anchored.warnings).toEqual([]);
    expect(verified.findings).toEqual([]);
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'checked', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({ kind: 'codemap-grounding', symbol: GREET_SYMBOL, file: 'src/greet.ts' });
    expect(shard.ledger?.claims[0]).toMatchObject({ correctness: 'checked', disposition: null });
  });
});
