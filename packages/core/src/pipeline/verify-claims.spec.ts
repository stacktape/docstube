import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { typescriptLanguagePack } from '@docstube/lang-typescript';
import { codemapSchema, fingerprintSnapshotSchema, sha256Hex, writerClaimLedgerSchema } from '@docstube/contracts';
import type { Codemap, FingerprintSnapshot, ObservedRead } from '@docstube/contracts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { anchorWriterLedger } from './anchor-ledger.ts';
import type { AnchorLedgerResult } from './anchor-ledger.ts';
import { verifyClaims } from './verify-claims.ts';

const COMMIT = 'f'.repeat(40);
const KNOWN_SYMBOL = `ts:${'1'.repeat(64)}`;
const UNKNOWN_SYMBOL = `ts:${'2'.repeat(64)}`;
const RETRY_SYMBOL = `ts:${'4'.repeat(64)}`;
const PRINT = '3'.repeat(64);
const READ_HASH = '5'.repeat(64);

// Value prints are sha256 of the normalized cited-value string (extract-fingerprints contract) —
// the snapshot must vouch for the exact bytes verification re-extracts, or the claim stays
// unchecked. GONE is advertised so its subscription anchors, but the source on disk does not
// define it — the exact snapshot/disk drift the verifier must treat as "unresolvable at verify
// time", never as a guess.
const fingerprints: FingerprintSnapshot = fingerprintSnapshotSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [
    {
      symbolHash: KNOWN_SYMBOL,
      signaturePrint: PRINT,
      // 'mode' anchors but never resolves on disk; GONE anchors but is not spelled by any marker.
      valuePrints: { DEFAULT_RETRIES: sha256Hex('3'), MODE: sha256Hex('"linear"'), GONE: PRINT, mode: PRINT },
      bodyPrint: PRINT
    },
    { symbolHash: RETRY_SYMBOL, signaturePrint: PRINT, valuePrints: {}, bodyPrint: PRINT }
  ],
  unparsedFiles: []
});

const codemap: Codemap = codemapSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [
    { hash: KNOWN_SYMBOL, lang: 'ts', kind: 'variable', name: 'DEFAULT_RETRIES', file: 'src/retry.ts', span: [1, 1] },
    // Behavior fixtures subject-bind through this record: the prose says `retry`.
    { hash: RETRY_SYMBOL, lang: 'ts', kind: 'function', name: 'retry', file: 'src/retry.ts', span: [3, 4] }
  ]
});

const observedReads: ObservedRead[] = [{ file: 'src/retry.ts', contentHash: READ_HASH }];

const mdx = `---
title: "Retry"
---

# Retry

<Claim id="v1">\`DEFAULT_RETRIES\` is 3.</Claim>

<Claim id="v5">\`DEFAULT_RETRIES\` is 5.</Claim>

<Claim id="m1">\`MODE\` defaults to linear.</Claim>

## Usage

Prose first. <Claim id="b1">\`retry\` retries the call.</Claim>

<Claim id="s1">\`mode\` defaults to "3" (a string).</Claim>

## Other

Elsewhere. <Claim id="b2">\`retry\` also logs.</Claim>
`;

let repoRoot: string;

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-verify-claims-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(
    join(repoRoot, 'src', 'retry.ts'),
    "export const DEFAULT_RETRIES = 3;\nexport const MODE = 'linear';\n"
  );
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

const FIXTURE_MARKERS = ['v1', 'v5', 'm1', 'b1', 's1', 'b2'];

const anchorFixture = (
  claims: Array<{ markerId: string } & Record<string, unknown>>,
  // Anchoring and verification must see the SAME extracted page — block ids are minted per
  // extraction.
  page: ReturnType<typeof extractPageEntity> = extractPageEntity({ mdx, slug: 'retry' }),
  snapshot: FingerprintSnapshot = fingerprints
): Extract<AnchorLedgerResult, { ok: true }> => {
  // Anchoring enforces exact marker/ledger cardinality: pad the markers a test does not exercise
  // with inert intent-history entries (the test's claim stays first, so [0] addresses it).
  const padded = [
    ...claims,
    ...FIXTURE_MARKERS.filter((markerId) => !claims.some((claim) => claim.markerId === markerId)).map((markerId) => ({
      markerId,
      class: 'intent-history',
      predicate: 'fixture filler'
    }))
  ];
  const result = anchorWriterLedger({
    mdx,
    writerLedger: writerClaimLedgerSchema.parse({ schemaVersion: 1, claims: padded }),
    page,
    fingerprints: snapshot,
    codemap,
    observedReads,
    commit: COMMIT
  });
  if (!result.ok) {
    throw new Error(`fixture anchoring failed: ${result.errors.map((issue) => issue.message).join('; ')}`);
  }
  return result;
};

const pageOf = () => extractPageEntity({ mdx, slug: 'retry' });

const verify = (
  anchoredResult: Extract<AnchorLedgerResult, { ok: true }>,
  snapshot: FingerprintSnapshot = fingerprints
) =>
  verifyClaims({
    ledger: anchoredResult.ledger,
    anchored: anchoredResult.anchored,
    anchorEvidence: anchoredResult.evidence,
    rejectedProposals: anchoredResult.rejectedProposals,
    codemap,
    packs: [typescriptLanguagePack],
    repoRoot,
    fingerprints: snapshot,
    commit: COMMIT
  });

const valueDraft = (citedValue: string, valueName = 'DEFAULT_RETRIES', markerId = 'v1') => ({
  markerId,
  class: 'value',
  predicate: `DEFAULT_RETRIES is ${citedValue}`,
  proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
  proposedSubscriptions: [{ kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName, citedValue }]
});

describe('verifyClaims — value (the minimal value-predicate verifier)', () => {
  it('checks a value claim whose asserted value matches the extracted value byte-wise', async () => {
    const result = await verify(anchorFixture([valueDraft('3')]));

    expect(result.findings).toEqual([]);
    const claim = result.ledger.claims[0];
    expect(claim).toMatchObject({ correctness: 'checked', disposition: null });
    const evidence = result.claimEvidence[0];
    expect(evidence?.correctness).toBe('checked');
    const deciding = evidence?.evidence.find((record) => record.evidenceId === evidence.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({
      kind: 'value-predicate',
      valueName: 'DEFAULT_RETRIES',
      assertedValue: '3',
      extractedValue: '3'
    });
    expect(deciding?.outcome).toBe('pass');
    // The anchoring-minted source-linked record rides along as non-deciding evidence.
    expect(evidence?.evidence.some((record) => record.ref.kind === 'source-linked')).toBe(true);
  });

  it('CONTRADICTS a value claim whose asserted value mismatches — with a blocking finding carrying the detail', async () => {
    // The v5 marker's VISIBLE prose asserts 5 (so binding holds); the source says 3 — a caught lie.
    const result = await verify(anchorFixture([valueDraft('5', 'DEFAULT_RETRIES', 'v5')]));

    const claim = result.ledger.claims[0];
    expect(claim).toMatchObject({ correctness: 'contradicted', disposition: null });
    const evidence = result.claimEvidence[0];
    const deciding = evidence?.evidence.find((record) => record.evidenceId === evidence.decidingEvidenceId);
    expect(deciding?.outcome).toBe('fail');
    expect(deciding?.ref).toMatchObject({ kind: 'value-predicate', assertedValue: '5', extractedValue: '3' });
    // The blocking finding names the predicate and both values — the retry prompt needs them.
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ check: 'claim-verification', severity: 'error' });
    expect(result.findings[0]?.message).toContain('CONTRADICTED');
    expect(result.findings[0]?.message).toContain('DEFAULT_RETRIES is 5');
    expect(result.findings[0]?.message).toContain('asserted as 5');
    expect(result.findings[0]?.message).toContain('extracts 3');
  });

  it('leaves a value claim unchecked when the value name is unresolvable at verify time — never guesses', async () => {
    const result = await verify(anchorFixture([valueDraft('3', 'GONE')]));

    expect(result.findings).toEqual([]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    // No value-predicate record is fabricated for an unresolvable name.
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
  });

  it('REJECTS value laundering: correct citedValue over prose asserting something else (impl-06 probe)', async () => {
    // A laundering writer pairs wrong prose with the right ledger value. Simulate it with a
    // predicate + citedValue pair whose value never appears in EITHER text: citedValue 7 vs
    // "is 3." prose and an off-value predicate — the binding must fail closed with blocking
    // findings, and 'checked' must not mint even though nothing contradicts either.
    const result = await verify(
      anchorFixture([
        {
          markerId: 'v1',
          class: 'value',
          predicate: 'DEFAULT_RETRIES is totally-wrong',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [
            { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'DEFAULT_RETRIES', citedValue: '7' }
          ]
        }
      ])
    );
    // Bidirectional binding: the marker side AND the predicate side each fail, precisely.
    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((finding) => finding.severity === 'error')).toBe(true);
    expect(result.findings.every((finding) => finding.message.includes('v1'))).toBe(true);
    expect(result.findings.some((finding) => finding.message.includes('visible marked prose'))).toBe(true);
    expect(result.findings.some((finding) => finding.message.includes('predicate'))).toBe(true);
    expect(result.ledger.claims[0]?.correctness).toBe('unchecked');
    // No value-predicate comparison ran on an unbound value.
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
  });

  it('REJECTS wrong prose riding a correct predicate — Sol impl-07 probe, verification side', async () => {
    // The marker's VISIBLE prose says 5 while the ledger asserts (the correct) 3 and the predicate
    // restates 3: under the old either-side rule this laundered into a value comparison; the
    // bidirectional rule fails it closed with a repair finding naming the marker side.
    const result = await verify(anchorFixture([valueDraft('3', 'DEFAULT_RETRIES', 'v5')]));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('error');
    expect(result.findings[0]?.message).toContain('visible marked prose');
    expect(result.findings[0]?.data).toMatchObject({ bindingIssue: 'missing-in-marker' });
    expect(result.ledger.claims[0]?.correctness).toBe('unchecked');
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
  });

  it("TYPED binding, Sol's impl-08 probe: numeric 3 must NOT bind prose saying '\"3\" (a string)'", async () => {
    // The s1 marker's visible prose states the STRING "3"; the ledger asserts the NUMBER 3.
    // Type-false prose must not launder into a value comparison — blocking binding finding.
    const result = await verify(anchorFixture([valueDraft('3', 'DEFAULT_RETRIES', 's1')]));
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.findings.every((finding) => finding.severity === 'error')).toBe(true);
    expect(
      result.findings.some(
        (finding) =>
          finding.data !== undefined && (finding.data as { bindingIssue?: string }).bindingIssue === 'missing-in-marker'
      )
    ).toBe(true);
    expect(result.ledger.claims[0]?.correctness).toBe('unchecked');
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
  });

  it('TYPED binding accepts the matching-typed pair: string "3" against the quoted-string prose', async () => {
    const result = await verify(
      anchorFixture([
        {
          markerId: 's1',
          class: 'value',
          predicate: 'the mode option defaults to the string "3"',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [
            // 'mode' subject-binds through the s1 prose ("`mode` defaults to …") and anchors
            // against the snapshot, but never resolves on disk.
            { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'mode', citedValue: '"3"' }
          ]
        }
      ])
    );
    // Binding holds (matching types); the value name is unresolvable on disk, so the claim stays
    // unchecked WITHOUT binding findings — proving the binding itself accepted.
    expect(result.findings).toEqual([]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
  });

  it('does NOT falsely contradict a bare semantic string against its JSON-quoted extraction (asymmetry fix)', async () => {
    // Source: export const MODE = 'linear' — extraction yields '"linear"'. The writer asserts the
    // bare spelling 'linear'; one shared normalization makes them byte-equal → checked.
    const result = await verify(
      anchorFixture([
        {
          markerId: 'm1',
          class: 'value',
          predicate: 'MODE defaults to linear',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [
            { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'MODE', citedValue: 'linear' }
          ]
        }
      ])
    );
    expect(result.findings).toEqual([]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'checked', disposition: null });
    const evidence = result.claimEvidence[0];
    const deciding = evidence?.evidence.find((record) => record.evidenceId === evidence.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({
      kind: 'value-predicate',
      assertedValue: '"linear"',
      extractedValue: '"linear"'
    });
  });

  it('stays unchecked with a warning when the re-extracted value drifted from the snapshot valuePrint (finding 7)', async () => {
    // The snapshot vouches for different bytes than the working tree now holds: never mint
    // evidence the snapshot never saw — unchecked + warning, not checked, not contradicted.
    const stale = fingerprintSnapshotSchema.parse({
      schemaVersion: 1,
      commit: COMMIT,
      symbols: [
        {
          symbolHash: KNOWN_SYMBOL,
          signaturePrint: PRINT,
          valuePrints: { DEFAULT_RETRIES: 'a'.repeat(64) },
          bodyPrint: PRINT
        }
      ],
      unparsedFiles: []
    });
    const page = pageOf();
    const result = await verify(anchorFixture([valueDraft('3')], page, stale), stale);
    expect(result.findings).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('moved mid-run');
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
  });
});

describe('verifyClaims — code-structure and grounding', () => {
  it('checks a code-structure claim whose grounding symbol resolves in the codemap', async () => {
    const result = await verify(
      anchorFixture([
        {
          markerId: 'v1',
          class: 'code-structure',
          predicate: 'DEFAULT_RETRIES exists',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
        }
      ])
    );

    expect(result.findings).toEqual([]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'checked', disposition: null });
    const evidence = result.claimEvidence[0];
    const deciding = evidence?.evidence.find((record) => record.evidenceId === evidence.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({ kind: 'codemap-grounding', symbol: KNOWN_SYMBOL, file: 'src/retry.ts' });
    expect(deciding?.outcome).toBe('pass');
  });

  it('leaves a code-structure claim with only a whole-file dependency unchecked', async () => {
    const result = await verify(
      anchorFixture([
        {
          markerId: 'v1',
          class: 'code-structure',
          predicate: 'something exists',
          proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.ts' }]
        }
      ])
    );
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
  });

  it('escalates a missing identifier to a hard defect — for every claim class', async () => {
    const result = await verify(
      anchorFixture([
        {
          markerId: 'v1',
          class: 'value',
          predicate: 'phantom is 3',
          // The unknown symbol is a hallucinated/stale reference; the resolvable file-content
          // subscription keeps anchoring green so THIS stage owns the defect.
          proposedEvidence: [{ kind: 'symbol', symbol: UNKNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.ts' }]
        }
      ])
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ check: 'claim-verification', severity: 'error' });
    expect(result.findings[0]?.message).toContain('grounding failure');
    expect(result.findings[0]?.message).toContain(UNKNOWN_SYMBOL);
  });
});

describe('verifyClaims — behavior (deliberately unchecked in 0.1.0)', () => {
  const behaviorDraft = (markerId: string) => ({
    markerId,
    class: 'behavior',
    predicate: 'retry retries the call',
    proposedEvidence: [{ kind: 'symbol', symbol: RETRY_SYMBOL }],
    proposedSubscriptions: [{ kind: 'body', symbolHash: RETRY_SYMBOL }]
  });

  it('a behavior claim is ALWAYS unchecked/no-checker-available — no execution evidence exists to mint (scope correction)', async () => {
    // trust-model-v2 decision 3: behavior claims stay honestly unchecked until the v1.x
    // predicate verifiers. The covers= execution-coverage path was removed outright — snippet
    // execution proves code EXAMPLES run, never behavior prose.
    const result = await verify(anchorFixture([behaviorDraft('b1')]));
    expect(result.findings).toEqual([]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'execution')).toBe(true);
  });

  it('grounded behavior claims keep their source-linked evidence but never become checked from it', async () => {
    const result = await verify(anchorFixture([behaviorDraft('b2')]));
    const evidence = result.claimEvidence[0];
    expect(evidence?.correctness).toBe('unchecked');
    expect(evidence?.evidence.some((record) => record.ref.kind === 'source-linked')).toBe(true);
    expect(evidence?.decidingEvidenceId).toBeUndefined();
  });
});

// Anchoring already rejects these as 'subject-unbound'; verification re-proves the same rule on
// its own inputs, because replayed/scripted writers can reach it with anchored state anchoring
// never blessed. Tampering the anchored entries post-anchoring simulates exactly that bypass.
const tamper = (
  anchoredResult: Extract<AnchorLedgerResult, { ok: true }>,
  visibleText: string,
  predicate: string
): Extract<AnchorLedgerResult, { ok: true }> => ({
  ...anchoredResult,
  anchored: anchoredResult.anchored.map((entry, index) =>
    index === 0 ? { ...entry, visibleText, claim: { ...entry.claim, predicate } } : entry
  )
});

describe('verifyClaims — subject binding (impl-09 finding 1, defense in depth)', () => {
  it("Sol probe 1: '`inventedFunction` exists' riding a real symbol mints NO grounding evidence", async () => {
    const anchoredResult = anchorFixture([
      {
        markerId: 'v1',
        class: 'code-structure',
        predicate: 'DEFAULT_RETRIES exists',
        proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
        proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
      }
    ]);
    const result = await verify(tamper(anchoredResult, '`inventedFunction` exists.', 'inventedFunction exists'));
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    expect(result.warnings.some((warning) => warning.includes('subject-unbound'))).toBe(true);
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'codemap-grounding')).toBe(true);
  });

  it("Sol probe 2: '`INVENTED_DEFAULT` is 3' against an equal-valued real name mints NO value evidence", async () => {
    // Scalar binding alone passes (3 appears in both texts) — the subject rule is what refuses.
    const result = await verify(
      tamper(anchorFixture([valueDraft('3')]), '`INVENTED_DEFAULT` is 3.', 'INVENTED_DEFAULT is 3')
    );
    expect(result.findings).toEqual([]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    expect(result.warnings.some((warning) => warning.includes('subject-unbound'))).toBe(true);
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
  });
});

describe('verifyClaims — intent-history and unknown classes', () => {
  it('keeps intent-history unchecked/maintainer-input-needed (KnowledgeFact wiring is a later wave)', async () => {
    const result = await verify(
      anchorFixture([{ markerId: 'v1', class: 'intent-history', predicate: 'retries were added for flaky registries' }])
    );
    expect(result.ledger.claims[0]).toMatchObject({
      correctness: 'unchecked',
      disposition: 'maintainer-input-needed'
    });
    expect(result.claimEvidence[0]?.disposition).toBe('maintainer-input-needed');
  });

  it('routes unknown claim classes to unchecked/no-checker-available', async () => {
    const result = await verify(
      anchorFixture([
        {
          markerId: 'v1',
          class: 'performance',
          predicate: 'retry is O(1)',
          proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.ts' }]
        }
      ])
    );
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
  });
});
