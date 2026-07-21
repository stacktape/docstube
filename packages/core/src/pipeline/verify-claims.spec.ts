import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { typescriptLanguagePack } from '@docstube/lang-typescript';
import { codemapSchema, fingerprintSnapshotSchema, sha256Hex, writerClaimLedgerSchema } from '@docstube/contracts';
import type { Codemap, FingerprintSnapshot, ObservedRead, VerifierRunResult } from '@docstube/contracts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { anchorWriterLedger } from './anchor-ledger.ts';
import type { AnchorLedgerResult } from './anchor-ledger.ts';
import { verifyClaims } from './verify-claims.ts';

const COMMIT = 'f'.repeat(40);
const KNOWN_SYMBOL = `ts:${'1'.repeat(64)}`;
const UNKNOWN_SYMBOL = `ts:${'2'.repeat(64)}`;
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
      valuePrints: { DEFAULT_RETRIES: sha256Hex('3'), MODE: sha256Hex('"linear"'), GONE: PRINT },
      bodyPrint: PRINT
    }
  ],
  unparsedFiles: []
});

const codemap: Codemap = codemapSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [
    { hash: KNOWN_SYMBOL, lang: 'ts', kind: 'variable', name: 'DEFAULT_RETRIES', file: 'src/retry.ts', span: [1, 1] }
  ]
});

const observedReads: ObservedRead[] = [{ file: 'src/retry.ts', contentHash: READ_HASH }];

const mdx = `---
title: "Retry"
---

# Retry

<Claim id="v1">\`DEFAULT_RETRIES\` is 3.</Claim>

## Usage

Prose first. <Claim id="b1">\`retry\` retries the call.</Claim>

\`\`\`ts
console.log('ok');
\`\`\`

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

const FIXTURE_MARKERS = ['v1', 'b1', 'b2'];

const anchorFixture = (
  claims: Array<{ markerId: string } & Record<string, unknown>>,
  // Anchoring and verification must see the SAME extracted page — block ids are minted per
  // extraction, and execution-coverage containment is keyed on them.
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

const codeBlockIdOf = (page: ReturnType<typeof pageOf>): string => {
  const block = page.sections
    .flatMap((section) => section.blocks)
    .find((candidate) => candidate.blockType === 'code-example');
  if (block === undefined) {
    throw new Error('fixture has no code block');
  }
  return block.id;
};

const snippetPass = (coveredEntityIds: string[]): VerifierRunResult => ({
  verifier: 'snippet-exec',
  plugin: '@docstube/verifiers',
  status: 'pass',
  findings: [],
  coveredEntityIds
});

const verify = (
  anchoredResult: Extract<AnchorLedgerResult, { ok: true }>,
  _page: ReturnType<typeof pageOf>,
  verifierResults: VerifierRunResult[] = [],
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
    verifierResults,
    commit: COMMIT
  });

const valueDraft = (citedValue: string, valueName = 'DEFAULT_RETRIES') => ({
  markerId: 'v1',
  class: 'value',
  predicate: `DEFAULT_RETRIES is ${citedValue}`,
  proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
  proposedSubscriptions: [{ kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName, citedValue }]
});

describe('verifyClaims — value (the minimal value-predicate verifier)', () => {
  it('checks a value claim whose asserted value matches the extracted value byte-wise', async () => {
    const page = pageOf();
    const result = await verify(anchorFixture([valueDraft('3')]), page);

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
    const page = pageOf();
    const result = await verify(anchorFixture([valueDraft('5')]), page);

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
    const page = pageOf();
    const result = await verify(anchorFixture([valueDraft('3', 'GONE')]), page);

    expect(result.findings).toEqual([]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    // No value-predicate record is fabricated for an unresolvable name.
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
  });

  it('REJECTS value laundering: correct citedValue over prose asserting something else (impl-06 probe)', async () => {
    // The prose (marker v1 wraps "`DEFAULT_RETRIES` is 3.") is fine, but a laundering writer would
    // pair wrong prose with the right ledger value. Simulate it with a predicate + citedValue pair
    // whose value never appears in EITHER text: citedValue 7 vs "is 3." prose and an off-value
    // predicate — the binding must fail closed with a blocking finding, and 'checked' must not
    // mint even though nothing contradicts either.
    const page = pageOf();
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
      ]),
      page
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('error');
    expect(result.findings[0]?.message).toContain('appears in NEITHER');
    expect(result.findings[0]?.message).toContain('v1');
    expect(result.findings[0]?.message).toContain('7');
    expect(result.ledger.claims[0]?.correctness).toBe('unchecked');
    // No value-predicate comparison ran on an unbound value.
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
  });

  it('does NOT falsely contradict a bare semantic string against its JSON-quoted extraction (asymmetry fix)', async () => {
    // Source: export const MODE = 'linear' — extraction yields '"linear"'. The writer asserts the
    // bare spelling 'linear'; one shared normalization makes them byte-equal → checked.
    const page = pageOf();
    const result = await verify(
      anchorFixture([
        {
          markerId: 'v1',
          class: 'value',
          predicate: 'MODE defaults to linear',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [
            { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'MODE', citedValue: 'linear' }
          ]
        }
      ]),
      page
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
    const result = await verify(anchorFixture([valueDraft('3')], page, stale), page, [], stale);
    expect(result.findings).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('moved mid-run');
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
  });
});

describe('verifyClaims — code-structure and grounding', () => {
  it('checks a code-structure claim whose grounding symbol resolves in the codemap', async () => {
    const page = pageOf();
    const result = await verify(
      anchorFixture([
        {
          markerId: 'v1',
          class: 'code-structure',
          predicate: 'DEFAULT_RETRIES exists',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
        }
      ]),
      page
    );

    expect(result.findings).toEqual([]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'checked', disposition: null });
    const evidence = result.claimEvidence[0];
    const deciding = evidence?.evidence.find((record) => record.evidenceId === evidence.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({ kind: 'codemap-grounding', symbol: KNOWN_SYMBOL, file: 'src/retry.ts' });
    expect(deciding?.outcome).toBe('pass');
  });

  it('leaves a code-structure claim with only a whole-file dependency unchecked', async () => {
    const page = pageOf();
    const result = await verify(
      anchorFixture([
        {
          markerId: 'v1',
          class: 'code-structure',
          predicate: 'something exists',
          proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.ts' }]
        }
      ]),
      page
    );
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
  });

  it('escalates a missing identifier to a hard defect — for every claim class', async () => {
    const page = pageOf();
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
      ]),
      page
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ check: 'claim-verification', severity: 'error' });
    expect(result.findings[0]?.message).toContain('grounding failure');
    expect(result.findings[0]?.message).toContain(UNKNOWN_SYMBOL);
  });
});

describe('verifyClaims — behavior (declared execution coverage only)', () => {
  const behaviorDraft = (markerId: string) => ({
    markerId,
    class: 'behavior',
    predicate: 'retry retries the call',
    proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
    proposedSubscriptions: [{ kind: 'body', symbolHash: KNOWN_SYMBOL }]
  });

  it('checks a behavior claim ONLY when a passing snippet declared it via covers=', async () => {
    // The snippet-exec result carries the fence's covers= marker ids alongside the block id.
    const page = pageOf();
    const result = await verify(anchorFixture([behaviorDraft('b1')], page), page, [
      snippetPass([codeBlockIdOf(page), 'b1'])
    ]);

    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'checked', disposition: null });
    const evidence = result.claimEvidence[0];
    const deciding = evidence?.evidence.find((record) => record.evidenceId === evidence.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({ kind: 'execution', check: 'snippet-exec' });
    expect(deciding?.detail).toContain('covers=b1');
  });

  it("the committed console.log case is NEGATIVE: same-section execution without covers= mints nothing", async () => {
    // The impl-06 probe: a passing `console.log('ok')` block in the claim's own section. Without
    // an explicit covers=b1 declaration it proves nothing about "retry retries the call".
    const page = pageOf();
    const result = await verify(anchorFixture([behaviorDraft('b1')], page), page, [
      snippetPass([codeBlockIdOf(page)])
    ]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    expect(result.claimEvidence[0]?.evidence.every((record) => record.ref.kind !== 'execution')).toBe(true);
  });

  it('a declared claim in ANOTHER section is still covered — coverage is the declaration, not proximity', async () => {
    // b2 sits in "Other"; the executed snippet lives in "Usage" but explicitly declares covers=b2.
    const page = pageOf();
    const result = await verify(anchorFixture([behaviorDraft('b2')], page), page, [
      snippetPass([codeBlockIdOf(page), 'b2'])
    ]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'checked', disposition: null });
  });

  it('stays unchecked when no snippet executed at all', async () => {
    const page = pageOf();
    const result = await verify(anchorFixture([behaviorDraft('b1')]), page, []);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
  });

  it('a FAILING snippet run covers nothing even when it declared the claim', async () => {
    const page = pageOf();
    const failed: VerifierRunResult = {
      verifier: 'snippet-exec',
      plugin: '@docstube/verifiers',
      status: 'fail',
      findings: [],
      coveredEntityIds: [codeBlockIdOf(page), 'b1']
    };
    const result = await verify(anchorFixture([behaviorDraft('b1')], page), page, [failed]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
  });
});

describe('verifyClaims — intent-history and unknown classes', () => {
  it('keeps intent-history unchecked/maintainer-input-needed (KnowledgeFact wiring is a later wave)', async () => {
    const page = pageOf();
    const result = await verify(
      anchorFixture([
        { markerId: 'v1', class: 'intent-history', predicate: 'retries were added for flaky registries' }
      ]),
      page
    );
    expect(result.ledger.claims[0]).toMatchObject({
      correctness: 'unchecked',
      disposition: 'maintainer-input-needed'
    });
    expect(result.claimEvidence[0]?.disposition).toBe('maintainer-input-needed');
  });

  it('routes unknown claim classes to unchecked/no-checker-available', async () => {
    const page = pageOf();
    const result = await verify(
      anchorFixture([
        {
          markerId: 'v1',
          class: 'performance',
          predicate: 'retry is O(1)',
          proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.ts' }]
        }
      ]),
      page
    );
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
  });
});
