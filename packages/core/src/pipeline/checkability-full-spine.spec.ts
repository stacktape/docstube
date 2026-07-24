import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateSubmitPageCall } from '@docstube/agent-runtime';
import { typescriptLanguagePack } from '@docstube/lang-typescript';
import {
  codemapSchema,
  fingerprintSnapshotSchema,
  pageShardSchema,
  provenanceV2Schema,
  sha256Hex,
  writerClaimLedgerSchema
} from '@docstube/contracts';
import type { Codemap, FingerprintSnapshot, ObservedRead, PageShard, WriterClaimLedger } from '@docstube/contracts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { anchorWriterLedger } from './anchor-ledger.ts';
import { verifyClaims } from './verify-claims.ts';

// THE FULL-SPINE PROBES, as permanent e2e tests (impl-12, hardened to exact canonical visible
// match in impl-13). Sol's bypass class: visible prose the cue detectors never listed ("`greet`
// is absent.", "`greet` returns the value.", "`greet` 不存在.", "`greet` is exported from
// `fiction`.") riding REAL evidence through submit → anchor → verify to reach the reader as 1/1
// CHECKED. Under exact canonical visible match every one of these spines must end with the
// persisted shard carrying the claim as UNCHECKED (0 of 1 checked) — the reader projection is
// literal over ClaimEvidence (theme proof-projection.spec proves that side), so a shard that
// never says 'checked' can never render 1/1. Canonical positives keep minting checked end to
// end, and canonical lies keep minting contradicted.

const COMMIT = 'b'.repeat(40);
const GREET_SYMBOL = `ts:${'7'.repeat(64)}`;
const MODE_SYMBOL = `ts:${'6'.repeat(64)}`;
const PRINT = '8'.repeat(64);
const READ_HASH = '9'.repeat(64);

const fingerprints: FingerprintSnapshot = fingerprintSnapshotSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [
    { symbolHash: GREET_SYMBOL, signaturePrint: PRINT, valuePrints: {}, bodyPrint: PRINT },
    { symbolHash: MODE_SYMBOL, signaturePrint: PRINT, valuePrints: { MODE: sha256Hex('"linear"') }, bodyPrint: PRINT }
  ],
  unparsedFiles: []
});

const codemap: Codemap = codemapSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [
    { hash: GREET_SYMBOL, lang: 'ts', kind: 'function', name: 'greet', file: 'src/greet.ts', span: [1, 3] },
    { hash: MODE_SYMBOL, lang: 'ts', kind: 'variable', name: 'MODE', file: 'src/mode.ts', span: [1, 1] }
  ]
});

const observedReads: ObservedRead[] = [
  { file: 'src/greet.ts', contentHash: READ_HASH },
  { file: 'src/mode.ts', contentHash: READ_HASH }
];

let repoRoot: string;

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-full-spine-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'mode.ts'), "export const MODE = 'linear';\n");
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

const pageMdx = (claimProse: string): string => `---
title: "Greet"
---

# Greet

<Claim id="g1">${claimProse}</Claim>
`;

const existenceLedger = (predicate: string): WriterClaimLedger =>
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

const valueLedger = (predicate: string, citedValue: string): WriterClaimLedger =>
  writerClaimLedgerSchema.parse({
    schemaVersion: 1,
    claims: [
      {
        markerId: 'g1',
        class: 'value',
        predicate,
        proposedEvidence: [{ kind: 'symbol', symbol: MODE_SYMBOL }],
        proposedSubscriptions: [{ kind: 'cited-value', symbolHash: MODE_SYMBOL, valueName: 'MODE', citedValue }]
      }
    ]
  });

// The spine: submit_page validation → kernel anchoring → claim verification → persisted shard.
const runSpine = async (claimProse: string, ledger: WriterClaimLedger) => {
  const mdx = pageMdx(claimProse);

  // 1. submit_page ACCEPTS — the writer-side gate cannot catch lexical bypasses; the exact
  //    canonical visible match is the evidence-decision backstop, not an in-session repair.
  const submission = evaluateSubmitPageCall({ mdx, ledger });
  expect(submission.response.accepted).toBe(true);

  // 2. Kernel anchoring accepts (subject bound, polarity agreed — the probes use exactly the
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
    packs: [typescriptLanguagePack],
    repoRoot,
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

const expectUnchecked = (spine: Awaited<ReturnType<typeof runSpine>>): void => {
  expect(spine.verified.findings).toEqual([]);
  const records = spine.shard.provenance?.claimEvidence ?? [];
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
  expect(records[0]?.decidingEvidenceId).toBeUndefined();
  expect(records.filter((record) => record.correctness === 'checked')).toHaveLength(0);
  expect(spine.shard.ledger?.claims[0]).toMatchObject({
    correctness: 'unchecked',
    disposition: 'no-checker-available'
  });
};

describe('full-spine probes: submit → anchor → verify → shard', () => {
  it("'`greet` is absent.' over predicate 'greet exists' persists UNCHECKED — the reader can never see 1/1 checked", async () => {
    const spine = await runSpine('`greet` is absent.', existenceLedger('greet exists'));

    // Anchoring journaled the non-blocking destined-unchecked hint (phrasing improvement is
    // opportunistic, never a repair spiral).
    expect(spine.anchored.warnings.some((warning) => warning.includes('destined to ship UNCHECKED'))).toBe(true);
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
    const records = spine.shard.provenance?.claimEvidence ?? [];
    expect(records[0]?.evidence.every((record) => record.ref.kind !== 'codemap-grounding')).toBe(true);
  });

  it("Sol's verdict-3 probe: '`greet` returns the value.' over predicate 'greet exists' persists UNCHECKED", async () => {
    // The hidden predicate is canonical, but the reader sees a behavior sentence — the visible
    // text must BE the canonical assertion, not merely ride alongside one.
    const spine = await runSpine('`greet` returns the value.', existenceLedger('greet exists'));
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
  });

  it("Sol's verdict-3 probe: '`greet` is exported from `fiction`.' persists UNCHECKED — the from-variant is removed", async () => {
    const spine = await runSpine(
      '`greet` is exported from `fiction`.',
      existenceLedger('greet is exported from fiction')
    );
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
  });

  it("Sol's non-Latin probe: '`greet` 不存在.' persists UNCHECKED", async () => {
    const spine = await runSpine('`greet` 不存在.', existenceLedger('greet exists'));
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
  });

  it("Sol's distant-clause probe: '`greet`, which recently ceased to exist, exists.' persists UNCHECKED", async () => {
    const spine = await runSpine('`greet`, which recently ceased to exist, exists.', existenceLedger('greet exists'));
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
  });

  it("the long-filler variant ('… that is not defined') persists UNCHECKED too", async () => {
    const spine = await runSpine(
      '`greet` is available as the value of the option of the key that is not defined.',
      existenceLedger('greet exists')
    );
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
  });

  it("Sol's verdict-3 probe: '`MODE` returns linear.' with constant evidence persists UNCHECKED — never checked or contradicted", async () => {
    // Behavior prose can never reach value evidence: the comparison is skipped entirely, so even
    // an extraction equal to the asserted spelling mints nothing in either direction.
    const spine = await runSpine('`MODE` returns linear.', valueLedger('MODE returns linear', 'linear'));
    expectUnchecked(spine);
    const records = spine.shard.provenance?.claimEvidence ?? [];
    expect(records[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
    expect(records.filter((record) => record.correctness === 'contradicted')).toHaveLength(0);
  });

  it("the canonical positive '`greet` exists.' still mints CHECKED end to end", async () => {
    const { anchored, verified, shard } = await runSpine('`greet` exists.', existenceLedger('greet exists'));
    expect(anchored.warnings).toEqual([]);
    expect(verified.findings).toEqual([]);
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'checked', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({ kind: 'codemap-grounding', symbol: GREET_SYMBOL, file: 'src/greet.ts' });
    expect(shard.ledger?.claims[0]).toMatchObject({ correctness: 'checked', disposition: null });
  });

  it("the canonical value positive '`MODE` defaults to linear.' still mints CHECKED end to end", async () => {
    const { verified, shard } = await runSpine(
      '`MODE` defaults to linear.',
      valueLedger('MODE defaults to linear', 'linear')
    );
    expect(verified.findings).toEqual([]);
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'checked', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({
      kind: 'value-predicate',
      assertedValue: '"linear"',
      extractedValue: '"linear"'
    });
  });

  it("the canonical LIE '`MODE` defaults to cubic.' still mints CONTRADICTED end to end — a caught lie, gating", async () => {
    const { verified, shard } = await runSpine(
      '`MODE` defaults to cubic.',
      valueLedger('MODE defaults to cubic', 'cubic')
    );
    expect(verified.findings).toHaveLength(1);
    expect(verified.findings[0]?.message).toContain('CONTRADICTED');
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'contradicted', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({
      kind: 'value-predicate',
      assertedValue: '"cubic"',
      extractedValue: '"linear"'
    });
  });
});
