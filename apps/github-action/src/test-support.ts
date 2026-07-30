import type {
  CiPreflightCheck,
  CiPreflightReport,
  Flag,
  FlagKind,
  ManifestIndex,
  PageShard,
  StructuralGroupShard
} from '@docstube/contracts';
import { ciPreflightReportSchema } from '@docstube/contracts';
import {
  buildFixtureClaimLedger,
  buildFixturePage,
  buildFixturePageShard,
  buildFixtureProvenanceV2,
  canonicalStateJson,
  hashValue,
  mintId,
  idPrefixes,
  sha256Hex
} from '@docstube/contracts';
import { outputInventorySchema, publicationDecisionSchema } from '@docstube/contracts';
import { outputInventoryRelativePath, publicationDecisionRelativePath } from './merge-decision.ts';
import type { PublicationValidation } from './merge-decision.ts';
import { manifestIndexRelativePath } from './verified-delta.ts';
import type { RiskCriticDelta, WorkspaceFileReader } from './verified-delta.ts';

// Pure fixture plumbing for the action tests: no git, no network, no filesystem.

// A CI preflight report as the pinned CLI would print it. `checks` fully replaces the default set,
// so a test can express exactly the failure it means.
export const buildFixturePreflightReport = (
  input: {
    checks?: readonly CiPreflightCheck[];
    automationMode?: CiPreflightReport['automationMode'];
    automationReason?: string;
  } = {}
): CiPreflightReport => {
  const checks = input.checks ?? [
    { id: 'node-runtime', title: 'node', status: 'pass', blocking: true, detail: 'v24.12.0' },
    { id: 'transport-credential', title: 'transport credential', status: 'pass', blocking: true, detail: 'KEY is set' }
  ];
  const fatal = checks.filter((check) => check.blocking && check.status === 'fail').map((check) => check.id);
  return ciPreflightReportSchema.parse({
    schemaVersion: 1,
    toolVersion: '0.0.2',
    generatedAt: '2026-07-29T00:00:00.000Z',
    mode: 'ci',
    automationMode: input.automationMode ?? 'approval-assisted',
    automationReason: input.automationReason ?? 'the workflow token is a GitHub App installation token.',
    checks,
    ok: fatal.length === 0,
    fatal
  });
};

export const buildFixtureFlag = (overrides: Partial<Flag> & { kind: FlagKind }): Flag => ({
  id: mintId(idPrefixes.flag),
  status: 'open',
  summary: `fixture ${overrides.kind} flag`,
  createdAt: '2026-07-12T00:00:00.000Z',
  ...overrides
});

export const buildFixtureManifestIndex = (input: {
  shards: readonly PageShard[];
  systemFlags?: readonly Flag[];
  structuralGroups?: readonly StructuralGroupShard[];
}): ManifestIndex => ({
  schemaVersion: 1,
  docstubeVersion: '0.0.2',
  sourceLocale: 'en',
  locales: ['en'],
  versions: [{ label: 'latest', status: 'current' }],
  pages: input.shards.map((shard) => ({
    id: shard.page.id,
    slug: shard.page.slug,
    title: shard.page.title,
    path: `docs-site/content/${shard.locale}/${shard.page.slug}.mdx`
  })),
  configHash: '0'.repeat(64),
  iaHash: '1'.repeat(64),
  structuralGroups: (input.structuralGroups ?? []).map((group) => group.groupId),
  systemFlags: [...(input.systemFlags ?? [])]
});

export const shardRelativePath = (shard: PageShard): string =>
  `.docstube/manifest/pages/${shard.locale}/${shard.page.id}.json`;

export const buildFixtureWorkspace = (input: {
  shards: readonly PageShard[];
  systemFlags?: readonly Flag[];
  structuralGroups?: readonly StructuralGroupShard[];
}): { files: Map<string, string>; readWorkspaceFile: WorkspaceFileReader } => {
  const files = new Map<string, string>();
  files.set(
    manifestIndexRelativePath,
    canonicalStateJson(
      buildFixtureManifestIndex({
        shards: input.shards,
        systemFlags: input.systemFlags,
        structuralGroups: input.structuralGroups
      })
    )
  );
  for (const shard of input.shards) {
    files.set(shardRelativePath(shard), canonicalStateJson(shard));
  }
  for (const group of input.structuralGroups ?? []) {
    files.set(`.docstube/manifest/structure/${group.groupId}.json`, canonicalStateJson(group));
  }
  return { files, readWorkspaceFile: async (relativePath) => files.get(relativePath) };
};

// The commit the fixture workspace pretends to have generated at.
export const fixtureHeadCommit = 'a'.repeat(40);

// Writes a valid publication decision + output inventory into a fixture workspace. Declared paths
// get materialized content so the hash the Action recomputes agrees with the declared one; the
// decision binds to the inventory exactly as the kernel mints it.
export const attachFixturePublication = (input: {
  files: Map<string, string>;
  declaredPaths: readonly string[];
  decision?: Record<string, unknown>;
  // Raw text overrides for the corruption cases (unparseable JSON, schema-invalid, unknown codes).
  decisionText?: string;
  inventoryText?: string;
  omitDecision?: boolean;
  omitInventory?: boolean;
}): { candidateArtifactHash: string } => {
  const entries = [...input.declaredPaths].toSorted().map((path) => {
    const content = input.files.get(path) ?? `fixture content for ${path}\n`;
    input.files.set(path, content);
    return { path, contentHash: sha256Hex(content) };
  });
  const inventory = { schemaVersion: 1, entries };
  const candidateArtifactHash = hashValue(inventory);
  const decision = {
    schemaVersion: 1,
    toolVersion: '0.0.2',
    baseSha: fixtureHeadCommit,
    sourceSha: fixtureHeadCommit,
    candidateArtifactHash,
    execution: 'completed',
    plan: { planned: 1, completed: 1, deferred: 0 },
    deterministicGate: 'clean',
    regressions: [],
    newBlockingDispositions: [],
    coverageDelta: [],
    publishable: true,
    autoMergeEligible: true,
    reasonCodes: [],
    ...input.decision
  };
  if (input.omitInventory !== true) {
    input.files.set(outputInventoryRelativePath, input.inventoryText ?? JSON.stringify(inventory));
  }
  if (input.omitDecision !== true) {
    input.files.set(publicationDecisionRelativePath, input.decisionText ?? JSON.stringify(decision));
  }
  return { candidateArtifactHash };
};

// An already-validated publication decision, for tests that exercise the gate/reporting rather
// than the artifact loading.
export const fixturePublicationValidation = (overrides: Record<string, unknown> = {}): PublicationValidation => {
  const inventory = outputInventorySchema.parse({ schemaVersion: 1, entries: [] });
  return {
    ok: true,
    inventory,
    decision: publicationDecisionSchema.parse({
      schemaVersion: 1,
      toolVersion: '0.0.2',
      baseSha: fixtureHeadCommit,
      sourceSha: fixtureHeadCommit,
      candidateArtifactHash: hashValue(inventory),
      execution: 'completed',
      plan: { planned: 1, completed: 1, deferred: 0 },
      deterministicGate: 'clean',
      regressions: [],
      newBlockingDispositions: [],
      coverageDelta: [],
      publishable: true,
      autoMergeEligible: true,
      reasonCodes: [],
      ...overrides
    })
  };
};

// A delta whose risk critic found nothing and whose linter flagged nothing — the baseline for
// tests about OTHER sections of the report.
export const emptyRiskCriticDelta = (): RiskCriticDelta => ({
  findings: [],
  semanticAssertionRisks: 0,
  uncoveredAssertions: 0,
  pendingPages: []
});

// A shard with the v2 trust spine attached: two ClaimEvidence records (one checked, one
// unchecked) so claim-count assertions have honest non-zero inputs.
export const buildFixtureShardWithFlags = (flags: readonly Flag[]): PageShard => {
  const page = buildFixturePage();
  const ledger = buildFixtureClaimLedger(page);
  return {
    ...buildFixturePageShard(page),
    ledger,
    provenance: buildFixtureProvenanceV2(ledger),
    flags: [...flags]
  };
};
