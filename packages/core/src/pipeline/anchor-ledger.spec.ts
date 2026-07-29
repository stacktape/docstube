import { describe, expect, it } from 'vitest';
import {
  codemapSchema,
  fingerprintSnapshotSchema,
  symbolSourceKeySchema,
  writerClaimLedgerSchema
} from '@docstube/contracts';
import type { Codemap, DraftClaim, FingerprintSnapshot, ObservedRead } from '@docstube/contracts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { anchorWriterLedger } from './anchor-ledger.ts';
import type { AnchorLedgerResult } from './anchor-ledger.ts';

const COMMIT = 'a'.repeat(40);
const KNOWN_SYMBOL = symbolSourceKeySchema.parse(`ts:${'1'.repeat(64)}`);
const UNKNOWN_SYMBOL = symbolSourceKeySchema.parse(`ts:${'2'.repeat(64)}`);
const PRINT = '3'.repeat(64);
const FILE_HASH = '4'.repeat(64);
const READ_HASH = '5'.repeat(64);
const PARSED_FILE_HASH = '6'.repeat(64);

const fingerprints: FingerprintSnapshot = fingerprintSnapshotSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [
    {
      symbolHash: KNOWN_SYMBOL,
      signaturePrint: PRINT,
      // 'retries' is the canonical const-name path the default fixture claim cites (the visible
      // subject must be the FULL bound value path — wave 2b close final); DEFAULT_RETRIES stays
      // as a DIFFERENT value path for the subject-binding and leaf-substitution probes.
      valuePrints: { retries: PRINT, DEFAULT_RETRIES: PRINT },
      bodyPrint: PRINT
    }
  ],
  unparsedFiles: [{ file: 'package.json', contentHash: FILE_HASH }],
  // A cleanly-parsed source file the page did NOT observe: hashed by the snapshot all the same, so
  // a conservative whole-file dependency on it is always derivable.
  parsedFiles: [{ file: 'src/retry.py', contentHash: PARSED_FILE_HASH }]
});

const codemap: Codemap = codemapSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [
    {
      hash: KNOWN_SYMBOL,
      lang: 'ts',
      kind: 'function',
      // Named 'retries' so the fixture prose ("`retries` defaults to 3") subject-binds.
      name: 'retries',
      file: 'src/retry.ts',
      span: [3, 9]
    }
  ]
});

const observedReads: ObservedRead[] = [{ file: 'src/retry.ts', contentHash: READ_HASH }];

const mdx = `---
title: "Retry"
---

# Retry

<Claim id="c1">\`retries\` defaults to 3.</Claim>

## History

Some narrative. <Claim id="c2">Retries were added for flaky registries.</Claim>
`;

const ledger = (claims: unknown[]): ReturnType<typeof writerClaimLedgerSchema.parse> =>
  writerClaimLedgerSchema.parse({ schemaVersion: 1, claims });

const draft = (markerId: string, overrides: Partial<DraftClaim> = {}): unknown => ({
  markerId,
  class: 'value',
  predicate: 'retries defaults to 3',
  // A resolvable default so value claims pass the fail-closed dependency requirement; tests that
  // exercise resolution/fallback override this. The value path 'retries' equals the visible
  // subject, keeping the default claim canonically checkable.
  proposedSubscriptions: [{ kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'retries', citedValue: '3' }],
  ...overrides
});

const anchorInput = (claims: unknown[], overrides: Partial<Parameters<typeof anchorWriterLedger>[0]> = {}) => {
  const page = extractPageEntity({ mdx, slug: 'retry' });
  return {
    mdx,
    writerLedger: ledger(claims),
    page,
    fingerprints,
    codemap,
    observedReads,
    commit: COMMIT,
    ...overrides
  };
};

const expectOk = (result: AnchorLedgerResult): Extract<AnchorLedgerResult, { ok: true }> => {
  if (!result.ok) {
    throw new Error(`expected ok anchoring, got errors: ${result.errors.map((issue) => issue.message).join('; ')}`);
  }
  return result;
};

describe('anchorWriterLedger', () => {
  it('maps each marker to its owning block, mints cl_ ids, and assigns the initial trust state', () => {
    const input = anchorInput([draft('c1'), draft('c2', { class: 'intent-history', proposedSubscriptions: [] })]);
    const result = expectOk(anchorWriterLedger(input));

    expect(result.warnings).toEqual([]);
    expect(result.ledger.claims).toHaveLength(2);
    const [first, second] = result.ledger.claims;
    expect(first?.claimId).toMatch(/^cl_/);
    // c1 sits in the preamble block; c2 in the History section's paragraph.
    const preambleBlock = input.page.preamble[0]!;
    const historyBlock = input.page.sections[0]?.blocks[0]!;
    expect(first?.anchor).toEqual({ blockId: preambleBlock.id, markerId: 'c1' });
    expect(second?.anchor).toEqual({ blockId: historyBlock.id, markerId: 'c2' });
    // Scope is the content-derived block revision, never a git commit.
    expect(first?.scope).toEqual({ entityId: preambleBlock.id, revision: preambleBlock.contentHash });
    // Wave 2b-i: everything unchecked; disposition by class.
    expect(first).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    expect(second).toMatchObject({ correctness: 'unchecked', disposition: 'maintainer-input-needed' });
    expect(result.ledger.sourceRevision).toBe(COMMIT);
    expect(result.anchored[0]?.quote).toBe('`retries` defaults to 3.');
  });

  it('resolves subscriptions against the fingerprint snapshot and records rejected proposals', () => {
    const input = anchorInput([
      draft('c1', {
        proposedSubscriptions: [
          { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'retries', citedValue: '3' },
          { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'NOT_A_VALUE', citedValue: '3' },
          { kind: 'signature', symbolHash: UNKNOWN_SYMBOL },
          { kind: 'file-content', file: 'package.json', contentHash: '0'.repeat(64) },
          { kind: 'file-content', file: 'missing.toml', contentHash: '0'.repeat(64) }
        ]
      } as Partial<DraftClaim>),
      draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
    ]);
    const result = expectOk(anchorWriterLedger(input));

    const subscriptions = result.ledger.claims[0]?.subscriptions ?? [];
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[0]).toMatchObject({ kind: 'cited-value', valueName: 'retries' });
    // The snapshot's hash is authoritative for whole-file subscriptions — never the writer's.
    expect(subscriptions[1]).toMatchObject({ kind: 'file-content', file: 'package.json', contentHash: FILE_HASH });
    expect(result.rejectedProposals).toHaveLength(3);
    expect(result.rejectedProposals[0]?.reason).toContain('no value named "NOT_A_VALUE"');
    expect(result.rejectedProposals[1]?.reason).toContain('is in neither the codemap nor the fingerprint snapshot');
    expect(result.rejectedProposals[2]?.reason).toContain('missing.toml');
    // Rejected proposals surface as warnings too (journaled by the page runner).
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.every((warning) => warning.includes('rejected'))).toBe(true);
  });

  it('resolves a hash-less file-content proposal from the observed reads (kernel-derived hash)', () => {
    const input = anchorInput([
      draft('c1', { proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.ts' }] } as Partial<DraftClaim>),
      draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
    ]);
    const result = expectOk(anchorWriterLedger(input));
    // The whole-file hash comes from the observed reads; the canonical value claim additionally
    // picks up the kernel-resolved cited-value subscription (impl-15 finding 2).
    expect(result.ledger.claims[0]?.subscriptions).toEqual([
      { kind: 'file-content', file: 'src/retry.ts', contentHash: READ_HASH },
      { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'retries', citedValue: '3' }
    ]);
  });

  it('falls back to a conservative file-content subscription from the grounding symbol when nothing resolves', () => {
    const input = anchorInput([
      draft('c1', {
        class: 'code-structure',
        proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
        proposedSubscriptions: [{ kind: 'signature', symbolHash: UNKNOWN_SYMBOL }]
      } as Partial<DraftClaim>),
      draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
    ]);
    const result = expectOk(anchorWriterLedger(input));
    // The grounding symbol's file (from the codemap) with the observed-read hash, never invented.
    expect(result.ledger.claims[0]?.subscriptions).toEqual([
      { kind: 'file-content', file: 'src/retry.ts', contentHash: READ_HASH }
    ]);
    expect(result.rejectedProposals.some((rejected) => rejected.code === 'unknown-symbol')).toBe(true);
  });

  it('derives the fallback from a known symbol named by a rejected facet subscription', () => {
    // The cited-value name is bogus but the SYMBOL is real: the grounded subject is the symbol's
    // codemap file, and the observed-read hash for that exact file is derivable. The predicate is
    // deliberately outside the canonical value grammar so kernel cited-value resolution cannot
    // fire — this probe is about the WHOLE-FILE fallback.
    const input = anchorInput([
      draft('c1', {
        class: 'value',
        predicate: 'retries controls the attempt count',
        proposedSubscriptions: [{ kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'NOPE', citedValue: '3' }]
      } as Partial<DraftClaim>),
      draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
    ]);
    const result = expectOk(anchorWriterLedger(input));
    expect(result.ledger.claims[0]?.subscriptions).toEqual([
      { kind: 'file-content', file: 'src/retry.ts', contentHash: READ_HASH }
    ]);
  });

  it('NEVER substitutes unrelated observed reads: a grounded subject with no derivable hash keeps no dependency', () => {
    // The review probe: the claim grounds src/retry.ts, but the page only observed README.md and
    // the snapshot carries no hash for it. Subscribing the claim to README.md would let the
    // subject change without invalidation, so the claim keeps NO dependency at all.
    const input = anchorInput(
      [
        draft('c1', {
          class: 'code-structure',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: []
        } as Partial<DraftClaim>),
        draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
      ],
      { observedReads: [{ file: 'README.md', contentHash: READ_HASH }] }
    );
    const result = expectOk(anchorWriterLedger(input));
    expect(result.ledger.claims[0]?.subscriptions).toEqual([]);
    expect(result.ledger.claims[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    expect(result.rejectedProposals).toContainEqual(
      expect.objectContaining({ markerId: 'c1', code: 'dependency-underivable' })
    );
  });

  it('DEGRADES to unchecked when a code claim proposes nothing at all — never a repair-eligible error', () => {
    // Sibling of subject-unbound: the kernel cannot vouch for the claim, but nothing here says the
    // prose is wrong, so it must not burn a writer retry.
    const input = anchorInput([
      draft('c1', { class: 'behavior', proposedSubscriptions: [] } as Partial<DraftClaim>),
      draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
    ]);
    const result = expectOk(anchorWriterLedger(input));
    expect(result.ledger.claims).toHaveLength(2);
    expect(result.ledger.claims[0]?.subscriptions).toEqual([]);
    expect(result.rejectedProposals).toContainEqual(
      expect.objectContaining({ markerId: 'c1', proposal: 'subscription', code: 'dependency-underivable' })
    );
    expect(result.warnings.some((warning) => warning.includes('DEPENDENCY-UNDERIVABLE'))).toBe(true);
  });

  it('mints source-linked evidence with the CODEMAP location, rejecting writer-supplied mismatches', () => {
    const input = anchorInput([
      draft('c1', {
        proposedEvidence: [
          // Writer supplies a wrong file and span: the codemap wins, the mismatch is recorded.
          { kind: 'symbol', symbol: KNOWN_SYMBOL, file: 'src/other.ts', span: [1, 2] },
          { kind: 'symbol', symbol: UNKNOWN_SYMBOL },
          { kind: 'url', url: 'https://example.com/spec' }
        ]
      } as Partial<DraftClaim>),
      draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
    ]);
    const result = expectOk(anchorWriterLedger(input));

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.evidenceId).toMatch(/^ev_/);
    expect(result.evidence[0]?.ref).toMatchObject({
      kind: 'source-linked',
      symbol: KNOWN_SYMBOL,
      // Canonical location from the codemap record, never the writer's file/span.
      file: 'src/retry.ts',
      span: [3, 9]
    });
    expect(result.evidence[0]?.outcome).toBe('pass');
    expect(result.ledger.claims[0]?.evidence).toEqual([result.evidence[0]?.evidenceId]);
    // Source-linked grounding never decides correctness — the claim stays unchecked.
    expect(result.ledger.claims[0]?.decidingEvidenceId).toBeUndefined();
    expect(result.rejectedProposals.some((rejected) => rejected.reason.includes('mismatches the codemap record'))).toBe(
      true
    );
    expect(result.rejectedProposals.some((rejected) => rejected.reason.includes('symbol evidence'))).toBe(true);
  });

  it('omits evidence file/span entirely when the codemap cannot resolve the symbol location', () => {
    const bareCodemap = codemapSchema.parse({ schemaVersion: 1, commit: COMMIT, symbols: [] });
    const input = anchorInput(
      [
        draft('c1', { proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }] } as Partial<DraftClaim>),
        draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
      ],
      { codemap: bareCodemap }
    );
    const result = expectOk(anchorWriterLedger(input));
    const ref = result.evidence[0]?.ref as { kind: string; file?: string; span?: unknown } | undefined;
    expect(ref).toMatchObject({ kind: 'source-linked', symbol: KNOWN_SYMBOL });
    expect(ref?.file).toBeUndefined();
    expect(ref?.span).toBeUndefined();
  });

  // EXISTENCE IS THE CODEMAP'S JOB. `extractFingerprints` is an ADDITIVE capability — the public
  // plugin-sdk pack contract requires only `extractSymbols` — so a perfectly good language pack
  // can put every one of its symbols in the codemap and none in the fingerprint snapshot. Testing
  // existence against the snapshot accused all of them of not existing, which verification then
  // escalated to a hard defect ("the identifier does not exist in the source") on correct prose.
  describe('a codemap symbol its pack never fingerprinted', () => {
    const CODEMAP_ONLY = symbolSourceKeySchema.parse(`ts:${'7'.repeat(64)}`);
    const codemapWithUnfingerprinted = codemapSchema.parse({
      schemaVersion: 1,
      commit: COMMIT,
      symbols: [
        ...codemap.symbols,
        { hash: CODEMAP_ONLY, lang: 'py', kind: 'function', name: 'retries', file: 'src/retry.py', span: [1, 4] }
      ]
    });

    it('GROUNDS: symbol evidence mints from the codemap, never rejected as a missing identifier', () => {
      const input = anchorInput(
        [
          draft('c1', {
            class: 'code-structure',
            predicate: 'retries exists',
            proposedEvidence: [{ kind: 'symbol', symbol: CODEMAP_ONLY }],
            proposedSubscriptions: [{ kind: 'file-content', file: 'package.json' }]
          } as Partial<DraftClaim>),
          draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
        ],
        { codemap: codemapWithUnfingerprinted }
      );
      const result = expectOk(anchorWriterLedger(input));
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]?.ref).toMatchObject({ kind: 'source-linked', symbol: CODEMAP_ONLY });
      expect(result.rejectedProposals.some((rejected) => rejected.code === 'unknown-symbol')).toBe(false);
    });

    it('classifies a facet subscription as missing-facet, NOT unknown-symbol', () => {
      const input = anchorInput(
        [
          draft('c1', {
            class: 'code-structure',
            predicate: 'retries exists',
            proposedEvidence: [{ kind: 'symbol', symbol: CODEMAP_ONLY }],
            proposedSubscriptions: [{ kind: 'signature', symbolHash: CODEMAP_ONLY }]
          } as Partial<DraftClaim>),
          draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
        ],
        { codemap: codemapWithUnfingerprinted }
      );
      const result = expectOk(anchorWriterLedger(input));
      expect(result.rejectedProposals).toContainEqual(
        expect.objectContaining({ markerId: 'c1', code: 'missing-facet' })
      );
      expect(result.rejectedProposals.some((rejected) => rejected.code === 'unknown-symbol')).toBe(false);
      // The claim still gets a real invalidation edge: the grounding symbol's own file.
      expect(result.ledger.claims[0]?.subscriptions).toEqual([
        { kind: 'file-content', file: 'src/retry.py', contentHash: PARSED_FILE_HASH }
      ]);
    });

    it('still rejects a hash that is in NEITHER source — a hallucinated symbol stays a defect', () => {
      const input = anchorInput([
        draft('c1', {
          class: 'code-structure',
          predicate: 'retries exists',
          proposedEvidence: [{ kind: 'symbol', symbol: UNKNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'file-content', file: 'package.json' }]
        } as Partial<DraftClaim>),
        draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
      ]);
      const result = expectOk(anchorWriterLedger(input));
      expect(result.evidence).toEqual([]);
      expect(result.rejectedProposals).toContainEqual(
        expect.objectContaining({ markerId: 'c1', proposal: 'evidence', code: 'unknown-symbol' })
      );
    });
  });

  // A whole-file dependency on a normal, cleanly-parsed source file used to be rejected as an
  // unknown file whenever the page had not happened to read it: `unparsedFiles` only lists the
  // files NO pack fingerprinted. Every such rejection was false — the file was right there.
  it('derives an authoritative hash for a PARSED source file the page never observed', () => {
    const input = anchorInput(
      [
        draft('c1', {
          class: 'behavior',
          proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.py' }]
        } as Partial<DraftClaim>),
        draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
      ],
      { observedReads: [] }
    );
    const result = expectOk(anchorWriterLedger(input));
    expect(result.ledger.claims[0]?.subscriptions).toEqual([
      { kind: 'file-content', file: 'src/retry.py', contentHash: PARSED_FILE_HASH }
    ]);
    expect(result.rejectedProposals.some((rejected) => rejected.code === 'unknown-file')).toBe(false);
  });

  it('FAILS (never drops) a claim whose marker sits outside every content block', () => {
    const headingMdx = `# Title\n\n## <Claim id="h1">Heading claim</Claim>\n\nBody text.\n`;
    const page = extractPageEntity({ mdx: headingMdx, slug: 'h' });
    const result = anchorWriterLedger({
      mdx: headingMdx,
      writerLedger: ledger([draft('h1')]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    // The placement error is repair-eligible; the ledger claim also reports its missing marker.
    expect(result.errors.some((issue) => issue.code === 'marker-misplaced' && !issue.kernel)).toBe(true);
    expect(result.errors.some((issue) => issue.code === 'marker-missing' && issue.markerId === 'h1')).toBe(true);
  });

  it('REJECTS a marker with no ledger entry — exact cardinality both ways (review probe)', () => {
    // Two markers, one ledger entry: accepting this would ship the c2 assertion outside the trust
    // denominator. submit_page catches it in-session; anchoring must re-prove it kernel-side.
    const result = anchorWriterLedger(anchorInput([draft('c1')]));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'marker-unclaimed', kernel: false, markerId: 'c2' });
  });

  it('REJECTS duplicate marker ids in the accepted MDX', () => {
    const duplicateMdx = `# Title

Text <Claim id="c1">first assertion.</Claim>

More text <Claim id="c1">second assertion.</Claim>
`;
    const page = extractPageEntity({ mdx: duplicateMdx, slug: 'dup' });
    const result = anchorWriterLedger({
      mdx: duplicateMdx,
      writerLedger: ledger([draft('c1')]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.some((issue) => issue.code === 'marker-duplicate' && issue.markerId === 'c1')).toBe(true);
  });

  // AN UNBINDABLE SUBJECT DEGRADES TO UNCHECKED (impl-15 finding 1): the binding rule is
  // unchanged — an unbound subject still mints NO evidence — but the consequence moved. The page
  // PASSES, the claim ships unchecked, and the drop is recorded and journaled. Failing the page
  // burned a full writer retry over documentation that correctly spells a public name
  // ("docstube generate") whose implementing symbol is called something else.
  const expectDegradedToUnchecked = (
    result: AnchorLedgerResult,
    markerId: string
  ): Extract<AnchorLedgerResult, { ok: true }> => {
    const ok = expectOk(result);
    const claim = ok.ledger.claims.find((entry) => entry.anchor.markerId === markerId);
    expect(claim).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
    // The kernel refused to VOUCH: no source-linked evidence was minted for the unbound subject.
    expect(claim?.evidence).toEqual([]);
    expect(ok.evidence).toEqual([]);
    expect(ok.rejectedProposals.some((rejected) => rejected.code === 'subject-unbound')).toBe(true);
    expect(ok.warnings.some((warning) => warning.includes('SUBJECT-UNBOUND') && warning.includes(markerId))).toBe(true);
    return ok;
  };

  it("Sol's subject probe 1: '`inventedFunction` exists' riding an unrelated real symbol ships UNCHECKED, page PASSES", () => {
    // The symbol resolves (it is real) but the visible prose and predicate name a DIFFERENT
    // identifier — verification must never mint codemap-grounding evidence for it. The kernel
    // drops the evidence proposal instead of failing the page.
    const probeMdx = `# Title\n\nText <Claim id="p1">\`inventedFunction\` exists.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = anchorWriterLedger({
      mdx: probeMdx,
      writerLedger: ledger([
        {
          markerId: 'p1',
          class: 'code-structure',
          predicate: 'inventedFunction exists',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
        }
      ]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    const ok = expectDegradedToUnchecked(result, 'p1');
    const warning = ok.warnings.find((entry) => entry.includes('SUBJECT-UNBOUND'))!;
    expect(warning).toContain('"retries"');
    expect(warning).toContain('inventedFunction');
    expect(warning).toContain('never triggers a retry');
    // The dependency still resolved — a degraded claim is never a dependency-less claim.
    expect(ok.ledger.claims[0]?.subscriptions).toEqual([{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]);
  });

  it("Sol's impl-10 probe: a predicate-only occurrence still mints NO evidence — it degrades, it does not fail", () => {
    // The predicate quietly names the REAL symbol ('retries'), but the VISIBLE prose asserts
    // 'inventedFunction exists'. Readers never see the predicate, so a predicate-only occurrence
    // is laundering: the root identifier must occur in the visible marker text AND the predicate.
    const probeMdx = `# Title\n\nText <Claim id="p1">\`inventedFunction\` exists.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = anchorWriterLedger({
      mdx: probeMdx,
      writerLedger: ledger([
        {
          markerId: 'p1',
          class: 'code-structure',
          predicate: 'retries exists',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
        }
      ]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    const ok = expectDegradedToUnchecked(result, 'p1');
    const warning = ok.warnings.find((entry) => entry.includes('SUBJECT-UNBOUND'))!;
    expect(warning).toContain('visible prose');
    expect(warning).toContain('inventedFunction');
  });

  it("Sol's subject probe 2: '`INVENTED_DEFAULT` is 3' against an unrelated equal-valued name ships UNCHECKED", () => {
    // The cited value resolves and equals 3 — scalar binding alone would pass. The subject rule
    // still refuses to vouch: neither the record name nor any valueName segment is spelled by the
    // sentence, so no evidence is minted and the claim ships unchecked.
    const probeMdx = `# Title\n\nText <Claim id="p2">\`INVENTED_DEFAULT\` is 3.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = anchorWriterLedger({
      mdx: probeMdx,
      writerLedger: ledger([
        {
          markerId: 'p2',
          class: 'value',
          predicate: 'INVENTED_DEFAULT is 3',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [
            { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'DEFAULT_RETRIES', citedValue: '3' }
          ]
        }
      ]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    const ok = expectDegradedToUnchecked(result, 'p2');
    expect(ok.warnings.some((warning) => warning.includes('"DEFAULT_RETRIES"'))).toBe(true);
  });

  it("Sol's impl-10 common-leaf probe: a valueName segment named on both sides never substitutes for the root", () => {
    // Both sides spell the value-path leaf 'DEFAULT_RETRIES', but the subject's root identifier
    // (the codemap record name 'retries') appears nowhere — a common leaf must not launder the
    // claim onto an unrelated symbol. Still no evidence; still not a page failure.
    const probeMdx = `# Title\n\nText <Claim id="p3">\`DEFAULT_RETRIES\` is 3.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = anchorWriterLedger({
      mdx: probeMdx,
      writerLedger: ledger([
        {
          markerId: 'p3',
          class: 'value',
          predicate: 'DEFAULT_RETRIES is 3',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [
            { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'DEFAULT_RETRIES', citedValue: '3' }
          ]
        }
      ]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    const ok = expectDegradedToUnchecked(result, 'p3');
    const warning = ok.warnings.find((entry) => entry.includes('SUBJECT-UNBOUND'))!;
    expect(warning).toContain('"retries"');
    expect(warning).toContain('never substitutes for the root');
  });

  it('a page mixing an unbindable claim with a bindable one keeps the bindable claim fully grounded', () => {
    // The live cli-reference shape: one claim documents the PUBLIC name while its evidence points
    // at the implementing symbol; the neighbouring claim names the symbol properly. The page must
    // pass with the first unchecked and the second still carrying its source-linked evidence.
    const probeMdx =
      `# Title\n\n` +
      `Text <Claim id="p1">\`docstube generate\` generates docs from existing config.</Claim>\n\n` +
      `More <Claim id="p2">\`retries\` exists.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = anchorWriterLedger({
      mdx: probeMdx,
      writerLedger: ledger([
        {
          markerId: 'p1',
          class: 'behavior',
          predicate: 'docstube generate generates docs from existing config',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'body', symbolHash: KNOWN_SYMBOL }]
        },
        {
          markerId: 'p2',
          class: 'code-structure',
          predicate: 'retries exists',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
        }
      ]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    const ok = expectOk(result);
    expect(ok.ledger.claims).toHaveLength(2);
    expect(ok.ledger.claims[0]?.evidence).toEqual([]);
    // Exactly one source-linked record was minted — for the bindable claim only.
    expect(ok.evidence).toHaveLength(1);
    expect(ok.ledger.claims[1]?.evidence).toEqual([ok.evidence[0]?.evidenceId]);
    expect(ok.warnings.some((warning) => warning.includes('SUBJECT-UNBOUND') && warning.includes('p1'))).toBe(true);
    expect(ok.warnings.some((warning) => warning.includes('p2'))).toBe(false);
  });

  it('KERNEL CITED-VALUE RESOLUTION: a canonical value claim with only a whole-file proposal gets a real cited-value subscription', () => {
    // The live configuration-page shape: the writer phrased the claim perfectly but had no symbol
    // hash, so it proposed the conservative whole-file dependency and the value-predicate verifier
    // never ran. The kernel now reads the value path out of the claim's own predicate.
    const probeMdx = `# Title\n\nText <Claim id="k1">\`retries\` defaults to 3.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = expectOk(
      anchorWriterLedger({
        mdx: probeMdx,
        writerLedger: ledger([
          {
            markerId: 'k1',
            class: 'value',
            predicate: 'retries defaults to 3',
            proposedEvidence: [],
            proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.ts' }]
          }
        ]),
        page,
        fingerprints,
        codemap,
        observedReads,
        commit: COMMIT
      })
    );
    expect(result.ledger.claims[0]?.subscriptions).toEqual([
      { kind: 'file-content', file: 'src/retry.ts', contentHash: READ_HASH },
      { kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'retries', citedValue: '3' }
    ]);
    expect(result.warnings.some((warning) => warning.includes('kernel resolved the cited value'))).toBe(true);
  });

  it('kernel cited-value resolution NEVER guesses: an unknown path keeps the conservative whole-file dependency', () => {
    const probeMdx = `# Title\n\nText <Claim id="k2">\`notAValue\` defaults to 3.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = expectOk(
      anchorWriterLedger({
        mdx: probeMdx,
        writerLedger: ledger([
          {
            markerId: 'k2',
            class: 'value',
            predicate: 'notAValue defaults to 3',
            proposedEvidence: [],
            proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.ts' }]
          }
        ]),
        page,
        fingerprints,
        codemap,
        observedReads,
        commit: COMMIT
      })
    );
    expect(result.ledger.claims[0]?.subscriptions).toEqual([
      { kind: 'file-content', file: 'src/retry.ts', contentHash: READ_HASH }
    ]);
    expect(result.warnings.some((warning) => warning.includes('kernel resolved the cited value'))).toBe(false);
  });

  it('kernel cited-value resolution NEVER invents an assertion out of descriptive prose', () => {
    // 'retries defaults to an empty array' names a REAL value path, but the asserted spelling is
    // description, not a scalar literal. Deriving a citedValue from it would report a CONTRADICTION
    // the writer never asserted. Same for the existence forms ('retries is exported'), which the
    // open parser reads as a value assertion.
    for (const [markerId, prose, predicate] of [
      ['k4', '`retries` defaults to an empty array.', 'retries defaults to an empty array'],
      ['k5', '`retries` is exported.', 'retries is exported']
    ] as const) {
      const probeMdx = `# Title\n\nText <Claim id="${markerId}">${prose}</Claim>\n`;
      const result = expectOk(
        anchorWriterLedger({
          mdx: probeMdx,
          writerLedger: ledger([
            {
              markerId,
              class: 'value',
              predicate,
              proposedEvidence: [],
              proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.ts' }]
            }
          ]),
          page: extractPageEntity({ mdx: probeMdx, slug: 'probe' }),
          fingerprints,
          codemap,
          observedReads,
          commit: COMMIT
        })
      );
      expect(result.ledger.claims[0]?.subscriptions).toEqual([
        { kind: 'file-content', file: 'src/retry.ts', contentHash: READ_HASH }
      ]);
    }
  });

  it('kernel cited-value resolution respects subject binding: a path whose root the prose never names stays unresolved', () => {
    // 'DEFAULT_RETRIES' IS a real value path in the snapshot, but its owning symbol's root
    // identifier ('retries') is named nowhere — resolving it would recreate the common-leaf
    // laundering the subject rule exists to stop.
    const probeMdx = `# Title\n\nText <Claim id="k3">\`DEFAULT_RETRIES\` is 3.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = expectOk(
      anchorWriterLedger({
        mdx: probeMdx,
        writerLedger: ledger([
          {
            markerId: 'k3',
            class: 'value',
            predicate: 'DEFAULT_RETRIES is 3',
            proposedEvidence: [],
            proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.ts' }]
          }
        ]),
        page,
        fingerprints,
        codemap,
        observedReads,
        commit: COMMIT
      })
    );
    expect(result.ledger.claims[0]?.subscriptions).toEqual([
      { kind: 'file-content', file: 'src/retry.ts', contentHash: READ_HASH }
    ]);
  });

  it("REJECTS Sol's polarity probe: visible '`retries` does not exist.' over predicate 'retries exists'", () => {
    // Root-token PRESENCE holds on both sides — the old rule anchored this and let real evidence
    // ride visibly false prose into 'checked'. Polarity agreement rejects it repair-eligibly.
    const probeMdx = `# Title\n\nText <Claim id="p4">\`retries\` does not exist.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = anchorWriterLedger({
      mdx: probeMdx,
      writerLedger: ledger([
        {
          markerId: 'p4',
          class: 'code-structure',
          predicate: 'retries exists',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
        }
      ]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors[0]).toMatchObject({ code: 'polarity-mismatch', kernel: false, markerId: 'p4' });
    expect(result.errors[0]?.message).toContain('POLARITY MISMATCH');
    expect(result.errors[0]?.message).toContain('"retries"');
  });

  it('REJECTS the reverse polarity laundering: positive prose over a negated predicate', () => {
    const probeMdx = `# Title\n\nText <Claim id="p4">\`retries\` exists.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = anchorWriterLedger({
      mdx: probeMdx,
      writerLedger: ledger([
        {
          markerId: 'p4',
          class: 'code-structure',
          predicate: 'retries does not exist',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
        }
      ]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors[0]).toMatchObject({ code: 'polarity-mismatch', kernel: false, markerId: 'p4' });
    expect(result.errors[0]?.message).toContain('predicate');
  });

  it('window scoping prevents over-rejection: a positive assertion with a distant "not" still anchors', () => {
    // The trailing negation denies the OBJECT ("not a string"), not the subject — the negation
    // window is scoped to the bound token, so the claim anchors as an ordinary positive fact.
    const probeMdx = `# Title\n\nText <Claim id="p6">Unlike \`shout\`, \`retries\` returns a number — not a string.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = anchorWriterLedger({
      mdx: probeMdx,
      writerLedger: ledger([
        {
          markerId: 'p6',
          class: 'code-structure',
          predicate: 'retries returns a number',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
        }
      ]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(true);
  });

  it('journals a NON-BLOCKING destined-unchecked hint for phrasing outside the checkability grammar (impl-12)', () => {
    // The claim anchors fine (subject bound, polarity agreed), but 'returns a number' is outside
    // the canonical existence grammar — verification will refuse to decide it. Anchoring only
    // HINTS (warning), never errors: unchecked is a legal outcome, not a repair spiral.
    const probeMdx = `# Title\n\nText <Claim id="p8">Unlike \`shout\`, \`retries\` returns a number — not a string.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = anchorWriterLedger({
      mdx: probeMdx,
      writerLedger: ledger([
        {
          markerId: 'p8',
          class: 'code-structure',
          predicate: 'retries returns a number',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
        }
      ]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.warnings.some((warning) => warning.includes('destined to ship UNCHECKED'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('p8'))).toBe(true);
    // Canonically phrased claims produce NO hint (the first test's empty-warnings assertion
    // covers the value form; here the existence form).
    const canonicalMdx = `# Title\n\nText <Claim id="p9">\`retries\` exists.</Claim>\n`;
    const canonical = anchorWriterLedger({
      mdx: canonicalMdx,
      writerLedger: ledger([
        {
          markerId: 'p9',
          class: 'code-structure',
          predicate: 'retries exists',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
        }
      ]),
      page: extractPageEntity({ mdx: canonicalMdx, slug: 'probe' }),
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(expectOk(canonical).warnings).toEqual([]);
  });

  it('ACCEPTS an agreed negative assertion — the ledger takes it; verification leaves it unchecked', () => {
    const probeMdx = `# Title\n\nText <Claim id="p7">\`retries\` never mutates its input.</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = anchorWriterLedger({
      mdx: probeMdx,
      writerLedger: ledger([
        {
          markerId: 'p7',
          class: 'behavior',
          predicate: 'retries never mutates its input',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'body', symbolHash: KNOWN_SYMBOL }]
        }
      ]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(true);
  });

  it('keeps genuine aliasing passing: prose names the codemap record name, not the proposal text', () => {
    // The c1 prose says `retries`; the evidence points at the symbol whose CODEMAP name is
    // 'retries' — the record name binds, never writer-proposed text.
    const result = expectOk(
      anchorWriterLedger(
        anchorInput([draft('c1'), draft('c2', { class: 'intent-history', proposedSubscriptions: [] })])
      )
    );
    expect(result.ledger.claims).toHaveLength(2);
  });

  it('classifies post-acceptance grammar-level scan errors as kernel invariant breaches', () => {
    // The page was extracted from the ACCEPTED MDX; the anchoring input was then altered — the
    // exact drift the kernel must refuse to paper over (submit_page guaranteed a clean scan).
    const acceptedMdx = `# Title\n\nText <Claim id="c1">closed properly.</Claim>\n`;
    const alteredMdx = `# Title\n\nText <Claim id="c1">never closed.\n`;
    const page = extractPageEntity({ mdx: acceptedMdx, slug: 'h' });
    const result = anchorWriterLedger({
      mdx: alteredMdx,
      writerLedger: ledger([draft('c1')]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.some((issue) => issue.code === 'marker-scan-invalid' && issue.kernel)).toBe(true);
  });

  it('re-checks the JSX prohibition: a component inside a marker post-acceptance is a kernel breach', () => {
    // submit_page rejects markers containing JSX elements in-session ('marker-jsx' — components
    // render arbitrary content, e.g. prop text contradicting the scanned children), so one in the
    // anchoring input means the MDX was altered after acceptance.
    const acceptedMdx = `# Title\n\nText <Claim id="c1">\`retries\` defaults to 3.</Claim>\n`;
    const alteredMdx = `# Title\n\nText <Claim id="c1"><Badge label="retries defaults to 9.">\`retries\` defaults to 3.</Badge></Claim>\n`;
    const page = extractPageEntity({ mdx: acceptedMdx, slug: 'h' });
    const result = anchorWriterLedger({
      mdx: alteredMdx,
      writerLedger: ledger([draft('c1')]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.errors.some(
        (issue) => issue.code === 'marker-scan-invalid' && issue.kernel && issue.message.includes('marker-jsx')
      )
    ).toBe(true);
  });

  it('re-checks the attribute whitelist: an extra marker attribute post-acceptance is a kernel breach', () => {
    // submit_page rejects markers carrying any attribute other than id in-session
    // ('marker-attribute' — renderer directives like set:text replace the rendered prose), so one
    // in the anchoring input means the MDX was altered after acceptance.
    const acceptedMdx = `# Title\n\nText <Claim id="c1">\`retries\` defaults to 3.</Claim>\n`;
    const alteredMdx = `# Title\n\nText <Claim id="c1" set:text="retries defaults to 9.">\`retries\` defaults to 3.</Claim>\n`;
    const page = extractPageEntity({ mdx: acceptedMdx, slug: 'h' });
    const result = anchorWriterLedger({
      mdx: alteredMdx,
      writerLedger: ledger([draft('c1')]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.errors.some(
        (issue) => issue.code === 'marker-scan-invalid' && issue.kernel && issue.message.includes('marker-attribute')
      )
    ).toBe(true);
  });

  it('re-checks duplicate marker attributes: two id attributes post-acceptance are a kernel breach', () => {
    // submit_page rejects duplicate attributes in-session ('marker-duplicate-attribute' — the
    // scanner reads the first id while rendering uses the last, so the trust mark would attach to
    // the wrong claim), so one in the anchoring input means the MDX was altered after acceptance.
    const acceptedMdx = `# Title\n\nText <Claim id="c1">\`retries\` defaults to 3.</Claim>\n`;
    const alteredMdx = `# Title\n\nText <Claim id="c1" id="c9">\`retries\` defaults to 3.</Claim>\n`;
    const page = extractPageEntity({ mdx: acceptedMdx, slug: 'h' });
    const result = anchorWriterLedger({
      mdx: alteredMdx,
      writerLedger: ledger([draft('c1')]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.errors.some(
        (issue) =>
          issue.code === 'marker-scan-invalid' && issue.kernel && issue.message.includes('marker-duplicate-attribute')
      )
    ).toBe(true);
  });

  it('re-checks the script/style prohibition: a raw <script> post-acceptance is a kernel breach', () => {
    // submit_page rejects raw script/style elements in-session ('page-script' — a sibling script
    // can rewrite verified claim text after rendering), so one in the anchoring input means the
    // MDX was altered after acceptance.
    const acceptedMdx = `# Title\n\nText <Claim id="c1">\`retries\` defaults to 3.</Claim>\n`;
    const alteredMdx = `# Title\n\nText <Claim id="c1">\`retries\` defaults to 3.</Claim>\n\n<script>rewrite()</script>\n`;
    const page = extractPageEntity({ mdx: acceptedMdx, slug: 'h' });
    const result = anchorWriterLedger({
      mdx: alteredMdx,
      writerLedger: ledger([draft('c1')]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.errors.some(
        (issue) => issue.code === 'marker-scan-invalid' && issue.kernel && issue.message.includes('page-script')
      )
    ).toBe(true);
  });

  it('re-checks the ESM prohibition: an import/export post-acceptance is a kernel breach', () => {
    // submit_page rejects `mdxjsEsm` nodes in-session ('mdx-esm' — an export default is compiled
    // into the page's own rendered wrapper), so one in the anchoring input means the MDX was
    // altered after acceptance. Grammar code, therefore kernel-invariant, exactly like page-script
    // and marker-expression — no per-code wiring, the repairable set is a whitelist.
    const acceptedMdx = `# Title\n\nText <Claim id="c1">\`retries\` defaults to 3.</Claim>\n`;
    const alteredMdx =
      `export default function Evil() { return <script>rewrite()</script> }\n\n` +
      `# Title\n\nText <Claim id="c1">\`retries\` defaults to 3.</Claim>\n`;
    const page = extractPageEntity({ mdx: acceptedMdx, slug: 'h' });
    const result = anchorWriterLedger({
      mdx: alteredMdx,
      writerLedger: ledger([draft('c1')]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.errors.some(
        (issue) => issue.code === 'marker-scan-invalid' && issue.kernel && issue.message.includes('mdx-esm')
      )
    ).toBe(true);
  });

  it('threads the kernel-scanned pureText flag and hints non-pure markers as destined unchecked', () => {
    // The image alt text IS the canonical assertion — but the reader sees a picture. Legal MDX,
    // no repair error: the claim anchors with pureText: false and a non-blocking hint; the
    // verification stage is what refuses existence/value evidence for it.
    const probeMdx = `# Title\n\nText <Claim id="p10">![retries exists.](retries.png)</Claim>\n`;
    const page = extractPageEntity({ mdx: probeMdx, slug: 'probe' });
    const result = anchorWriterLedger({
      mdx: probeMdx,
      writerLedger: ledger([
        {
          markerId: 'p10',
          class: 'code-structure',
          predicate: 'retries exists',
          proposedEvidence: [{ kind: 'symbol', symbol: KNOWN_SYMBOL }],
          proposedSubscriptions: [{ kind: 'signature', symbolHash: KNOWN_SYMBOL }]
        }
      ]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    const ok = expectOk(result);
    expect(ok.anchored[0]?.pureText).toBe(false);
    expect(ok.warnings.some((warning) => warning.includes('destined to ship UNCHECKED'))).toBe(true);
    // A pure marker threads true (the c1 fixture claim is plain prose + inline code).
    const pure = expectOk(
      anchorWriterLedger(
        anchorInput([draft('c1'), draft('c2', { class: 'intent-history', proposedSubscriptions: [] })])
      )
    );
    expect(pure.anchored.every((entry) => entry.pureText)).toBe(true);
  });

  it('re-checks the MDX-expression prohibition: an expression inside a marker post-acceptance is a kernel breach', () => {
    // submit_page rejects markers containing {…} expressions in-session ('marker-expression'), so
    // one appearing in the anchoring input means the MDX was altered after acceptance — a kernel
    // invariant breach, never a writer repair.
    const acceptedMdx = `# Title\n\nText <Claim id="c1">\`retries\` defaults to 3.</Claim>\n`;
    const alteredMdx = `# Title\n\nText <Claim id="c1">\`retries\` {'never '}defaults to 3.</Claim>\n`;
    const page = extractPageEntity({ mdx: acceptedMdx, slug: 'h' });
    const result = anchorWriterLedger({
      mdx: alteredMdx,
      writerLedger: ledger([draft('c1')]),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.errors.some(
        (issue) => issue.code === 'marker-scan-invalid' && issue.kernel && issue.message.includes('marker-expression')
      )
    ).toBe(true);
  });

  // NO HIDDEN DENOMINATOR (harness-state-v2 decision 5, PRODUCT §1.2): the committed ledger
  // carries the coverage linter's uncovered spans, and their presence is reported as a NON-BLOCKING
  // hint — never a repair error that could spiral the bounded retry loop.
  it('records unmarked assertion-shaped prose on the committed ledger as a non-blocking hint', () => {
    const uncoveredMdx = `# Retry\n\n<Claim id="c1">\`retries\` defaults to 3.</Claim>\n\nThe \`backoffFactor\` is set to 2.\n`;
    const result = expectOk(
      anchorWriterLedger({
        mdx: uncoveredMdx,
        writerLedger: ledger([draft('c1')]),
        page: extractPageEntity({ mdx: uncoveredMdx, slug: 'retry' }),
        fingerprints,
        codemap,
        observedReads,
        commit: COMMIT
      })
    );
    expect(result.ledger.claims).toHaveLength(1);
    expect(result.ledger.coverageLint.uncovered).toHaveLength(1);
    expect(result.ledger.coverageLint.uncovered[0]?.excerpt).toBe('The `backoffFactor` is set to 2.');
    // Reported, never blocking: anchoring still succeeded with the writer's full claim inventory.
    expect(result.warnings.some((warning) => warning.includes('not covered by any <Claim> marker'))).toBe(true);
  });

  it('records NO uncovered spans when every assertion carries a marker', () => {
    const result = expectOk(
      anchorWriterLedger(
        anchorInput([draft('c1'), draft('c2', { class: 'intent-history', proposedSubscriptions: [] })])
      )
    );
    expect(result.ledger.coverageLint.uncovered).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
