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
  unparsedFiles: [{ file: 'package.json', contentHash: FILE_HASH }]
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
    expect(result.rejectedProposals[1]?.reason).toContain('is not in the fingerprint snapshot');
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
    expect(result.ledger.claims[0]?.subscriptions).toEqual([
      { kind: 'file-content', file: 'src/retry.ts', contentHash: READ_HASH }
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
    expect(result.rejectedProposals.some((rejected) => rejected.reason.includes('not in the fingerprint'))).toBe(true);
  });

  it('derives the fallback from a known symbol named by a rejected facet subscription', () => {
    // The cited-value name is bogus but the SYMBOL is real: the grounded subject is the symbol's
    // codemap file, and the observed-read hash for that exact file is derivable.
    const input = anchorInput([
      draft('c1', {
        class: 'value',
        proposedSubscriptions: [{ kind: 'cited-value', symbolHash: KNOWN_SYMBOL, valueName: 'NOPE', citedValue: '3' }]
      } as Partial<DraftClaim>),
      draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
    ]);
    const result = expectOk(anchorWriterLedger(input));
    expect(result.ledger.claims[0]?.subscriptions).toEqual([
      { kind: 'file-content', file: 'src/retry.ts', contentHash: READ_HASH }
    ]);
  });

  it('NEVER substitutes unrelated observed reads: a grounded subject with no derivable hash fails closed', () => {
    // The review probe: the claim grounds src/retry.ts, but the page only observed README.md.
    // Subscribing the claim to README.md would let the subject change without invalidation — the
    // claim must fail closed instead.
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
    const result = anchorWriterLedger(input);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors[0]).toMatchObject({ code: 'subscription-unresolvable', kernel: false, markerId: 'c1' });
    expect(result.errors[0]?.message).toContain('grounded subject');
  });

  it('fails closed when a code claim proposes nothing at all — no grounded subject exists to fall back to', () => {
    const input = anchorInput([
      draft('c1', { class: 'behavior', proposedSubscriptions: [] } as Partial<DraftClaim>),
      draft('c2', { class: 'intent-history', proposedSubscriptions: [] })
    ]);
    const result = anchorWriterLedger(input);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors[0]).toMatchObject({ code: 'subscription-unresolvable', kernel: false, markerId: 'c1' });
    expect(result.errors[0]?.message).toContain('file-content');
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

  it("REJECTS Sol's subject probe 1: '`inventedFunction` exists' riding an unrelated real symbol", () => {
    // The symbol resolves (it is real) but the visible prose and predicate name a DIFFERENT
    // identifier — accepting it would let verification mint codemap-grounding evidence for a
    // hallucinated subject. Repair-eligible: fix the prose or drop the wrong symbol.
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
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors[0]).toMatchObject({ code: 'subject-unbound', kernel: false, markerId: 'p1' });
    expect(result.errors[0]?.message).toContain('"retries"');
    expect(result.errors[0]?.message).toContain('inventedFunction');
  });

  it("REJECTS Sol's impl-10 probe: predicate-only occurrence — visible prose asserts a subject the evidence never proves", () => {
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
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors[0]).toMatchObject({ code: 'subject-unbound', kernel: false, markerId: 'p1' });
    expect(result.errors[0]?.message).toContain('visible prose');
    expect(result.errors[0]?.message).toContain('inventedFunction');
  });

  it("REJECTS Sol's subject probe 2: '`INVENTED_DEFAULT` is 3' against an unrelated equal-valued name", () => {
    // The cited value resolves and equals 3 — scalar binding alone would pass. The subject rule
    // rejects it: neither the record name nor any valueName segment is spelled by the sentence.
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
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.every((issue) => issue.code === 'subject-unbound')).toBe(true);
    expect(result.errors.some((issue) => issue.message.includes('"DEFAULT_RETRIES"'))).toBe(true);
  });

  it("REJECTS Sol's impl-10 common-leaf probe: a valueName segment named on both sides never substitutes for the root", () => {
    // Both sides spell the value-path leaf 'DEFAULT_RETRIES', but the subject's root identifier
    // (the codemap record name 'retries') appears nowhere — a common leaf must not launder the
    // claim onto an unrelated symbol.
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
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.every((issue) => issue.code === 'subject-unbound')).toBe(true);
    expect(result.errors[0]?.message).toContain('"retries"');
    expect(result.errors[0]?.message).toContain('never substitutes for the root');
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
});
