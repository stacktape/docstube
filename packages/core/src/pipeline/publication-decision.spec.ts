import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outputInventorySchema, publicationDecisionSchema } from '@docstube/contracts';
import {
  buildPublicationDecision,
  collectOutputInventory,
  compareLedgerSnapshots,
  emitPublicationDecision,
  failedPublicationInputs,
  inventoryBindingHash,
  outputInventoryRelativePath,
  publicationDecisionRelativePath,
  resolveDeterministicGate
} from './publication-decision.ts';
import type { ClaimSnapshot, LedgerSnapshot, PublicationDecisionInputs } from './publication-decision.ts';

const commit = 'a'.repeat(40);
const pageId = 'pg_00000000000000000000';
const claimId = (suffix: string) => `cl_${suffix.padEnd(20, '0')}`;

const snapshot = (claims: ClaimSnapshot[], unreadable = false): LedgerSnapshot => ({
  pages: new Map([[pageId, { pageId, claims }]]),
  unreadable
});

const checked = (suffix: string, decidingKind: ClaimSnapshot['decidingKind'] = 'value-predicate'): ClaimSnapshot => ({
  claimId: claimId(suffix),
  correctness: 'checked',
  disposition: null,
  decidingKind
});

const baseInputs = (overrides: Partial<PublicationDecisionInputs> = {}): PublicationDecisionInputs => ({
  baseSha: commit,
  sourceSha: commit,
  execution: 'completed',
  planned: 2,
  completed: 2,
  deferred: 0,
  deterministicGate: 'clean',
  regressions: [],
  newBlockingDispositions: [],
  coverageDelta: [],
  ...overrides
});

describe('base-vs-candidate ledger comparison', () => {
  it('reports badge loss when a fully checked page stops being fully checked', () => {
    const { regressions } = compareLedgerSnapshots(
      snapshot([checked('a'), checked('b')]),
      snapshot([
        checked('a'),
        {
          claimId: claimId('b'),
          correctness: 'unchecked',
          disposition: 'no-checker-available',
          decidingKind: undefined
        }
      ])
    );
    expect(regressions.map((entry) => entry.kind)).toContain('badge-loss');
    expect(regressions.map((entry) => entry.kind)).toContain('disposition-regression');
  });

  it('reports a checked claim that became contradicted', () => {
    const { regressions } = compareLedgerSnapshots(
      snapshot([checked('a')]),
      snapshot([
        { claimId: claimId('a'), correctness: 'contradicted', disposition: null, decidingKind: 'value-predicate' }
      ])
    );
    expect(regressions.some((entry) => entry.kind === 'disposition-regression')).toBe(true);
    expect(regressions.find((entry) => entry.kind === 'disposition-regression')?.detail).toContain('contradicted');
  });

  it('allows a checked-count drop explained by deletion, but never one that is not', () => {
    // Two checked claims at the base; one deleted outright — the drop is fully explained.
    const explained = compareLedgerSnapshots(snapshot([checked('a'), checked('b')]), snapshot([checked('a')]));
    expect(explained.regressions.some((entry) => entry.kind === 'checked-count-drop')).toBe(false);

    // Same drop, but the claim is still there and merely stopped being checked.
    const unexplained = compareLedgerSnapshots(
      snapshot([checked('a'), checked('b')]),
      snapshot([
        checked('a'),
        {
          claimId: claimId('b'),
          correctness: 'unchecked',
          disposition: 'no-checker-available',
          decidingKind: undefined
        }
      ])
    );
    expect(unexplained.regressions.some((entry) => entry.kind === 'checked-count-drop')).toBe(true);
  });

  it('reports evidence authority weakening even when the badge and the counts are unchanged', () => {
    const { regressions } = compareLedgerSnapshots(
      snapshot([checked('a', 'execution')]),
      snapshot([checked('a', 'codemap-grounding')])
    );
    expect(regressions.map((entry) => entry.kind)).toEqual(['evidence-authority-weakening']);

    // Strengthening is not a regression.
    const stronger = compareLedgerSnapshots(
      snapshot([checked('a', 'codemap-grounding')]),
      snapshot([checked('a', 'execution')])
    );
    expect(stronger.regressions).toEqual([]);
  });

  it('reports attestation loss whether the attestation was re-decided or the claim disappeared', () => {
    const attested: ClaimSnapshot = {
      claimId: claimId('a'),
      correctness: 'checked',
      disposition: 'owner-attested',
      decidingKind: 'owner-attestation'
    };
    const redecided = compareLedgerSnapshots(snapshot([attested]), snapshot([checked('a')]));
    expect(redecided.regressions.some((entry) => entry.kind === 'attestation-loss')).toBe(true);

    const dropped = compareLedgerSnapshots(snapshot([attested]), snapshot([]));
    expect(dropped.regressions.some((entry) => entry.kind === 'attestation-loss')).toBe(true);
  });

  it('blocks NEW blocking dispositions but lets pre-existing debt through (no new debt)', () => {
    const contradicted: ClaimSnapshot = {
      claimId: claimId('a'),
      correctness: 'contradicted',
      disposition: null,
      decidingKind: 'value-predicate'
    };
    const fresh = compareLedgerSnapshots(snapshot([]), snapshot([contradicted]));
    expect(fresh.newBlockingDispositions).toEqual([{ pageId, claimId: claimId('a'), status: 'contradicted' }]);

    const preexisting = compareLedgerSnapshots(snapshot([contradicted]), snapshot([contradicted]));
    expect(preexisting.newBlockingDispositions).toEqual([]);
  });

  it('ignores pages that are not on both sides — an IA change is not a guarantee downgrade', () => {
    const base: LedgerSnapshot = {
      pages: new Map([['pg_0000000000000000000a', { pageId: 'pg_0000000000000000000a', claims: [checked('a')] }]]),
      unreadable: false
    };
    const candidate: LedgerSnapshot = {
      pages: new Map([['pg_0000000000000000000b', { pageId: 'pg_0000000000000000000b', claims: [checked('a')] }]]),
      unreadable: false
    };
    expect(compareLedgerSnapshots(base, candidate).regressions).toEqual([]);
  });
});

describe('deterministic gate', () => {
  it('is clean only when nothing errored, the tree was trustworthy, and the base could be read', () => {
    expect(resolveDeterministicGate({ findings: [], dirtyWorkingTree: false, baseUnreadable: false })).toBe('clean');
    expect(
      resolveDeterministicGate({
        findings: [{ source: 'verifier', check: 'link-check', severity: 'error', message: 'broken link' }],
        dirtyWorkingTree: false,
        baseUnreadable: false
      })
    ).toBe('blocked');
    // A warning is not an error.
    expect(
      resolveDeterministicGate({
        findings: [{ source: 'verifier', check: 'source-revision', severity: 'warning', message: 'dirty' }],
        dirtyWorkingTree: false,
        baseUnreadable: false
      })
    ).toBe('clean');
    expect(resolveDeterministicGate({ findings: [], dirtyWorkingTree: true, baseUnreadable: false })).toBe('blocked');
    // Missing base evidence never reads as "no regression".
    expect(resolveDeterministicGate({ findings: [], dirtyWorkingTree: false, baseUnreadable: true })).toBe('blocked');
  });
});

describe('decision assembly', () => {
  it('a clean completed run is publishable and auto-merge eligible with no reason codes', () => {
    const decision = buildPublicationDecision({ inputs: baseInputs(), candidateArtifactHash: '0'.repeat(64) });
    expect(decision).toMatchObject({ publishable: true, autoMergeEligible: true, reasonCodes: [] });
  });

  it('a budget-paused run is never publishable and states budget.frozen + plan.deferred', () => {
    const decision = buildPublicationDecision({
      inputs: baseInputs({ execution: 'paused-budget', planned: 5, completed: 2, deferred: 3 }),
      candidateArtifactHash: '0'.repeat(64)
    });
    expect(decision.publishable).toBe(false);
    expect(decision.autoMergeEligible).toBe(false);
    expect(decision.reasonCodes).toEqual(['budget.frozen', 'plan.deferred']);
  });

  it('a regression keeps a publishable candidate out of auto-merge and names its reason code', () => {
    const decision = buildPublicationDecision({
      inputs: baseInputs({ regressions: [{ kind: 'badge-loss', pageId }] }),
      candidateArtifactHash: '0'.repeat(64)
    });
    expect(decision.publishable).toBe(true);
    expect(decision.autoMergeEligible).toBe(false);
    expect(decision.reasonCodes).toEqual(['ledger.regression']);
  });

  it('a coverage-obligation rank decrease fires coverage.regression; a declared omission does not', () => {
    const debt = buildPublicationDecision({
      inputs: baseInputs({
        coverageDelta: [
          { obligationId: 'ob-retry', scope: 'src/retry.ts', beforeStatus: 'documented', afterStatus: 'unassigned' }
        ]
      }),
      candidateArtifactHash: '0'.repeat(64)
    });
    expect(debt.reasonCodes).toContain('coverage.regression');
    expect(debt.autoMergeEligible).toBe(false);

    const declared = buildPublicationDecision({
      inputs: baseInputs({
        coverageDelta: [
          {
            obligationId: 'ob-retry',
            scope: 'src/retry.ts',
            beforeStatus: 'unassigned',
            afterStatus: 'intentionally-omitted'
          }
        ]
      }),
      candidateArtifactHash: '0'.repeat(64)
    });
    expect(declared.autoMergeEligible).toBe(true);
  });

  it('a crashed run still produces a decision that reconciles and fails closed', () => {
    const decision = buildPublicationDecision({
      inputs: failedPublicationInputs({ commit, planned: 4 }),
      candidateArtifactHash: '0'.repeat(64)
    });
    expect(decision.execution).toBe('failed');
    expect(decision.plan).toEqual({ planned: 4, completed: 0, deferred: 4 });
    expect(decision.publishable).toBe(false);
    expect(decision.reasonCodes).toEqual(expect.arrayContaining(['execution.failed', 'gate.blocked', 'plan.deferred']));
  });
});

describe('output inventory + artifact emission', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'docstube-publication-'));
    await mkdir(join(repoRoot, '.docstube', 'manifest', 'pages', 'en'), { recursive: true });
    await mkdir(join(repoRoot, '.docstube', 'cache', 'agent-calls'), { recursive: true });
    await mkdir(join(repoRoot, '.docstube', 'runs', 'run_1'), { recursive: true });
    await mkdir(join(repoRoot, 'docs-site', 'content', 'en'), { recursive: true });
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, '.docstube', 'manifest', 'manifest.json'), '{"schemaVersion":1}', 'utf8');
    await writeFile(join(repoRoot, '.docstube', 'cache', 'agent-calls', 'abc.json'), '{}', 'utf8');
    await writeFile(join(repoRoot, '.docstube', 'runs', 'run_1', 'journal.jsonl'), '{}\n', 'utf8');
    await writeFile(join(repoRoot, 'docs-site', 'content', 'en', 'index.mdx'), '# hello\n', 'utf8');
    await writeFile(join(repoRoot, 'src', 'retry.ts'), 'export const retries = 3;\n', 'utf8');
  });

  afterEach(async () => {
    await rm(repoRoot, { force: true, recursive: true });
  });

  it('declares docstube-owned outputs only — never machine-local state and never user source', async () => {
    const inventory = await collectOutputInventory({ repoRoot, outDir: 'docs-site' });
    expect(inventory.entries.map((entry) => entry.path)).toEqual([
      '.docstube/manifest/manifest.json',
      'docs-site/content/en/index.mdx'
    ]);
    expect(inventory.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.contentHash))).toBe(true);
  });

  it('writes both artifacts, binds the decision to the inventory, and keeps them out of the commit', async () => {
    const { decision, inventory } = await emitPublicationDecision({
      repoRoot,
      outDir: 'docs-site',
      inputs: baseInputs()
    });
    expect(decision.candidateArtifactHash).toBe(inventoryBindingHash(inventory));

    const writtenDecision = publicationDecisionSchema.parse(
      JSON.parse(await readFile(join(repoRoot, publicationDecisionRelativePath), 'utf8'))
    );
    const writtenInventory = outputInventorySchema.parse(
      JSON.parse(await readFile(join(repoRoot, outputInventoryRelativePath), 'utf8'))
    );
    expect(writtenDecision.candidateArtifactHash).toBe(inventoryBindingHash(writtenInventory));
    // The artifacts describe the candidate; they are never part of it.
    expect(writtenInventory.entries.some((entry) => entry.path.startsWith('.docstube/runs/'))).toBe(false);
  });
});
