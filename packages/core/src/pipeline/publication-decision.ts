import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ClaimCorrectness,
  ClaimDisposition,
  CoverageObligationDelta,
  EvidenceKind,
  Finding,
  ManifestIndex,
  OutputInventory,
  PublicationDecision,
  PublicationRegression
} from '@docstube/contracts';
import { hashValue, outputInventorySchema, publicationDecisionSchema } from '@docstube/contracts';
import { docstubeVersion } from '../version.ts';
import type { ManifestStore } from '../state/manifest-store.ts';

// The kernel-owned fail-closed PublicationDecision (PRODUCT §3.3, quality-ci-reader-v2 decisions
// 9/11/12/13). `docstube generate --ci` emits ONE decision plus the output inventory it is bound
// to; the GitHub Action validates and ENFORCES them — it never re-derives publishability.
//
// WHERE THE ARTIFACTS LIVE: `.docstube/runs/` — machine-local, gitignored, and already excluded
// from the Action's commit-path selection, so the decision can never be committed as if it were
// docs state, while still being readable from the workspace the CLI just ran in. Fixed file names
// (not `<runId>/`) because the Action must find the decision without knowing the run id.
export const publicationDecisionRelativePath = '.docstube/runs/publication-decision.json';
export const outputInventoryRelativePath = '.docstube/runs/output-inventory.json';

export type PublicationExecution = 'completed' | 'paused-budget' | 'failed';

export type BlockingDisposition = {
  pageId: string;
  claimId: string;
  status: 'contradicted' | 'maintainer-input-needed';
};

// Everything the RUN knows. The inventory (and therefore the candidate binding hash) can only be
// collected after the site has been emitted, so the run hands these facts to the emit step rather
// than minting a decision it would immediately have to rewrite.
export type PublicationDecisionInputs = {
  baseSha: string;
  sourceSha: string;
  execution: PublicationExecution;
  planned: number;
  completed: number;
  deferred: number;
  deterministicGate: 'clean' | 'blocked';
  regressions: PublicationRegression[];
  newBlockingDispositions: BlockingDisposition[];
  coverageDelta: CoverageObligationDelta[];
};

const sha256Hex = (input: string | Uint8Array): string => createHash('sha256').update(input).digest('hex');

// ── Ledger comparison (decision 12) ────────────────────────────────────────────────────────────

// Deciding-evidence authority, highest first. A claim that stays `checked` but drops to a weaker
// deciding kind has had its guarantee downgraded even though the badge count is unchanged — that
// is exactly the silent regression counts cannot see.
const evidenceAuthorityRank: Record<EvidenceKind, number> = {
  execution: 5,
  'schema-check': 4,
  'value-predicate': 4,
  'owner-attestation': 3,
  'external-citation': 3,
  'project-defined': 2,
  'codemap-grounding': 1,
  'source-linked': 0
};

export type ClaimSnapshot = {
  claimId: string;
  correctness: ClaimCorrectness;
  disposition: ClaimDisposition;
  decidingKind: EvidenceKind | undefined;
};

export type PageLedgerSnapshot = {
  pageId: string;
  claims: ClaimSnapshot[];
};

export type LedgerSnapshot = {
  pages: Map<string, PageLedgerSnapshot>;
  // True when a manifest that CLAIMS pages could not be read back. Absence of a manifest is the
  // first-run state (nothing can have regressed); an unreadable one is missing evidence, and
  // missing evidence fails closed rather than reading as "no regression".
  unreadable: boolean;
};

const isAttested = (claim: ClaimSnapshot): boolean =>
  claim.correctness === 'checked' && claim.disposition === 'owner-attested';

// A page earns the badge only when it HAS claims and every one of them is checked.
const hasBadge = (page: PageLedgerSnapshot): boolean =>
  page.claims.length > 0 && page.claims.every((claim) => claim.correctness === 'checked');

export const snapshotPageLedger = (shard: {
  page: { id: string };
  provenance?: { claimEvidence: readonly ClaimEvidenceLike[] } | undefined;
}): PageLedgerSnapshot => ({
  pageId: shard.page.id,
  claims: (shard.provenance?.claimEvidence ?? []).map((record) => ({
    claimId: record.claimId,
    correctness: record.correctness,
    disposition: record.disposition,
    decidingKind:
      record.decidingEvidenceId === undefined
        ? undefined
        : record.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId)?.ref.kind
  }))
});

type ClaimEvidenceLike = {
  claimId: string;
  correctness: ClaimCorrectness;
  disposition: ClaimDisposition;
  decidingEvidenceId?: string | undefined;
  evidence: readonly { evidenceId: string; ref: { kind: EvidenceKind } }[];
};

// Reads the SOURCE-LOCALE shards of a manifest index into comparable snapshots. Translations carry
// no ledger of their own (the canonical ledger is the source locale's), so they cannot regress
// independently.
export const readLedgerSnapshot = async (input: {
  store: ManifestStore;
  index: ManifestIndex | undefined;
  locale: string;
}): Promise<LedgerSnapshot> => {
  const pages = new Map<string, PageLedgerSnapshot>();
  if (input.index === undefined) {
    return { pages, unreadable: false };
  }
  let unreadable = false;
  for (const entry of input.index.pages) {
    try {
      const shard = await input.store.readPageShard({ locale: input.locale, pageId: entry.id });
      if (shard === undefined) {
        // An index that outruns its shards cannot prove the candidate kept what the base had.
        unreadable = true;
        continue;
      }
      pages.set(entry.id, snapshotPageLedger(shard));
    } catch {
      unreadable = true;
    }
  }
  return { pages, unreadable };
};

// The semantic base-vs-candidate comparison. Only pages present in BOTH sides are compared: a page
// that left (or joined) the manifest is an IA change, already surfaced by the `structural-change`
// flag, and treating every rename as a guarantee downgrade would block ordinary IA work forever.
export const compareLedgerSnapshots = (
  base: LedgerSnapshot,
  candidate: LedgerSnapshot
): { regressions: PublicationRegression[]; newBlockingDispositions: BlockingDisposition[] } => {
  const regressions: PublicationRegression[] = [];
  for (const [pageId, basePage] of base.pages) {
    const candidatePage = candidate.pages.get(pageId);
    if (candidatePage === undefined) {
      continue;
    }
    const candidateClaims = new Map(candidatePage.claims.map((claim) => [claim.claimId, claim]));

    if (hasBadge(basePage) && !hasBadge(candidatePage)) {
      regressions.push({
        kind: 'badge-loss',
        pageId,
        detail: 'every claim on this page was checked at the base; the candidate no longer checks all of them'
      });
    }

    for (const baseClaim of basePage.claims) {
      const candidateClaim = candidateClaims.get(baseClaim.claimId);
      if (baseClaim.correctness === 'checked' && candidateClaim !== undefined) {
        if (candidateClaim.correctness !== 'checked') {
          regressions.push({
            kind: 'disposition-regression',
            pageId,
            detail: `claim ${baseClaim.claimId} moved from checked to ${candidateClaim.correctness}`
          });
        } else if (
          baseClaim.decidingKind !== undefined &&
          candidateClaim.decidingKind !== undefined &&
          evidenceAuthorityRank[candidateClaim.decidingKind] < evidenceAuthorityRank[baseClaim.decidingKind]
        ) {
          regressions.push({
            kind: 'evidence-authority-weakening',
            pageId,
            detail: `claim ${baseClaim.claimId} is still checked, but its deciding evidence weakened from ${baseClaim.decidingKind} to ${candidateClaim.decidingKind}`
          });
        }
      }
      // A maintainer attestation is durable human input. Losing it — by re-deciding the claim or by
      // dropping the claim entirely — is a loss of recorded human knowledge, never a content detail.
      if (isAttested(baseClaim) && (candidateClaim === undefined || !isAttested(candidateClaim))) {
        regressions.push({
          kind: 'attestation-loss',
          pageId,
          detail:
            candidateClaim === undefined
              ? `owner-attested claim ${baseClaim.claimId} is gone from the candidate ledger`
              : `owner-attested claim ${baseClaim.claimId} is no longer attested`
        });
      }
    }

    // A checked-count drop is legitimate ONLY to the extent that checked claims were deleted; any
    // drop beyond that is coverage silently walking backwards.
    const baseChecked = basePage.claims.filter((claim) => claim.correctness === 'checked');
    const candidateChecked = candidatePage.claims.filter((claim) => claim.correctness === 'checked').length;
    const deletedChecked = baseChecked.filter((claim) => !candidateClaims.has(claim.claimId)).length;
    const drop = baseChecked.length - candidateChecked;
    if (drop > deletedChecked) {
      regressions.push({
        kind: 'checked-count-drop',
        pageId,
        detail: `checked claims fell from ${baseChecked.length} to ${candidateChecked} while only ${deletedChecked} checked claim(s) were deleted`
      });
    }
  }

  // No new debt (decision 13): a blocking condition already present at the base keeps blocking its
  // own scope but must not hold unrelated work; a blocking condition this run INTRODUCED blocks.
  const newBlockingDispositions: BlockingDisposition[] = [];
  for (const [pageId, candidatePage] of candidate.pages) {
    const basePage = base.pages.get(pageId);
    const baseClaims = new Map((basePage?.claims ?? []).map((claim) => [claim.claimId, claim]));
    for (const claim of candidatePage.claims) {
      const status =
        claim.correctness === 'contradicted'
          ? ('contradicted' as const)
          : claim.disposition === 'maintainer-input-needed'
            ? ('maintainer-input-needed' as const)
            : undefined;
      if (status === undefined) {
        continue;
      }
      const baseClaim = baseClaims.get(claim.claimId);
      const wasBlocking =
        baseClaim !== undefined &&
        (status === 'contradicted'
          ? baseClaim.correctness === 'contradicted'
          : baseClaim.disposition === 'maintainer-input-needed');
      if (!wasBlocking) {
        newBlockingDispositions.push({ pageId, claimId: claim.claimId, status });
      }
    }
  }

  return { regressions, newBlockingDispositions };
};

// ── Output inventory (decision 11) ─────────────────────────────────────────────────────────────

// Machine-local state under `.docstube/` (ARCHITECTURE §5.2): rebuildable, never committed, and
// therefore never part of the commit-boundary allowlist.
// `staging` is the staged-atomic publish area (publish-staging.ts): completed-but-unpublished work.
// Declaring it would invite the Action to commit a half-applied plan — the exact failure decision 3
// exists to prevent — so it is machine-local like runs/ and cache/.
const machineLocalNames = new Set(['runs', 'cache', 'staging', 'telemetry.json']);
const isMachineLocal = (relativePath: string): boolean => {
  const segments = relativePath.split('/');
  return (
    segments[0] === '.docstube' &&
    (machineLocalNames.has(segments[1] ?? '') || segments[1]?.startsWith('db.sqlite') === true)
  );
};

// docstube's declared output roots — the same prefixes the dirty-tree probes ignore because a
// normal run writes them.
export const publicationOutputRoots = (outDir: string): string[] => {
  const normalized = outDir.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  return [...(normalized === '' || normalized === '.' ? [] : [normalized]), '.docstube'];
};

const walkFiles = async (root: string, prefix: string): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = `${prefix}/${entry.name}`;
    if (isMachineLocal(relativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
};

// The exact commit-boundary allowlist: every file under docstube's declared output roots, with its
// content hash. Files an earlier run wrote and this one left alone are declared too — they are part
// of the candidate tree, and the Action stages only the intersection with what git reports dirty.
// Anything dirty OUTSIDE these roots (a source file an agent edited, say) is undeclared by
// construction and marks the candidate ineligible.
export const collectOutputInventory = async (input: { repoRoot: string; outDir: string }): Promise<OutputInventory> => {
  const paths: string[] = [];
  for (const root of publicationOutputRoots(input.outDir)) {
    paths.push(...(await walkFiles(input.repoRoot, root)));
  }
  const entries = [];
  for (const path of [...new Set(paths)].toSorted()) {
    const bytes = await readFile(join(input.repoRoot, path));
    entries.push({ path, contentHash: sha256Hex(bytes) });
  }
  return outputInventorySchema.parse({ schemaVersion: 1, entries });
};

// The candidate binding hash: the decision is bound to the EXACT output tree by hashing the
// inventory. The Action recomputes this from the inventory it read and refuses a decision that
// does not bind to it.
export const inventoryBindingHash = (inventory: OutputInventory): string => hashValue(inventory);

// ── Decision assembly ──────────────────────────────────────────────────────────────────────────

export const buildPublicationDecision = (input: {
  inputs: PublicationDecisionInputs;
  candidateArtifactHash: string;
}): PublicationDecision => {
  const { inputs } = input;
  const hasCoverageRegression = inputs.coverageDelta.some(
    (delta) =>
      (delta.beforeStatus === 'documented' && delta.afterStatus !== 'documented') ||
      (delta.beforeStatus === 'generated-reference-only' && delta.afterStatus === 'unassigned')
  );
  const publishable = inputs.execution === 'completed' && inputs.deferred === 0 && inputs.deterministicGate === 'clean';
  const autoMergeEligible =
    publishable &&
    inputs.regressions.length === 0 &&
    inputs.newBlockingDispositions.length === 0 &&
    !hasCoverageRegression;

  const reasonCodes = [
    inputs.execution === 'paused-budget' ? 'budget.frozen' : undefined,
    inputs.execution === 'failed' ? 'execution.failed' : undefined,
    inputs.deterministicGate === 'blocked' ? 'gate.blocked' : undefined,
    inputs.deferred > 0 ? 'plan.deferred' : undefined,
    inputs.regressions.length > 0 ? 'ledger.regression' : undefined,
    inputs.newBlockingDispositions.length > 0 ? 'ledger.blocking-disposition' : undefined,
    hasCoverageRegression ? 'coverage.regression' : undefined
  ].filter((code): code is string => code !== undefined);

  return publicationDecisionSchema.parse({
    schemaVersion: 1,
    toolVersion: docstubeVersion,
    baseSha: inputs.baseSha,
    sourceSha: inputs.sourceSha,
    candidateArtifactHash: input.candidateArtifactHash,
    execution: inputs.execution,
    plan: { planned: inputs.planned, completed: inputs.completed, deferred: inputs.deferred },
    deterministicGate: inputs.deterministicGate,
    regressions: inputs.regressions,
    newBlockingDispositions: inputs.newBlockingDispositions,
    coverageDelta: inputs.coverageDelta,
    publishable,
    autoMergeEligible,
    reasonCodes
  });
};

// Collects the inventory, mints the decision bound to it, and writes both artifacts. Called by the
// CLI AFTER site emission, so the inventory describes the tree the Action is about to stage.
export const emitPublicationDecision = async (input: {
  repoRoot: string;
  outDir: string;
  inputs: PublicationDecisionInputs;
}): Promise<{ decision: PublicationDecision; inventory: OutputInventory }> => {
  const inventory = await collectOutputInventory({ repoRoot: input.repoRoot, outDir: input.outDir });
  const decision = buildPublicationDecision({
    inputs: input.inputs,
    candidateArtifactHash: inventoryBindingHash(inventory)
  });
  await mkdir(join(input.repoRoot, '.docstube', 'runs'), { recursive: true });
  await writeFile(
    join(input.repoRoot, publicationDecisionRelativePath),
    `${JSON.stringify(decision, undefined, 2)}\n`,
    'utf8'
  );
  await writeFile(
    join(input.repoRoot, outputInventoryRelativePath),
    `${JSON.stringify(inventory, undefined, 2)}\n`,
    'utf8'
  );
  return { decision, inventory };
};

// A run that ESCAPED with an error still owes CI a decision: without one the Action cannot tell a
// crashed run from a run that never emitted, and both must fail closed anyway — but only the
// decision says WHY on the PR.
export const failedPublicationInputs = (input: { commit: string; planned?: number }): PublicationDecisionInputs => ({
  baseSha: input.commit,
  sourceSha: input.commit,
  execution: 'failed',
  planned: input.planned ?? 0,
  completed: 0,
  deferred: input.planned ?? 0,
  deterministicGate: 'blocked',
  regressions: [],
  newBlockingDispositions: [],
  coverageDelta: []
});

// The deterministic gate is 'clean' only when nothing ERRORED and the run's evidence is bound to a
// revision it can vouch for. A dirty or unknown working tree means the checked bytes need never
// have existed in the recorded commit — that is not a publishable candidate for an unattended merge.
export const resolveDeterministicGate = (input: {
  findings: readonly Finding[];
  dirtyWorkingTree: boolean;
  baseUnreadable: boolean;
}): 'clean' | 'blocked' =>
  input.findings.some((finding) => finding.severity === 'error') || input.dirtyWorkingTree || input.baseUnreadable
    ? 'blocked'
    : 'clean';
