import type { Flag, FlagKind, ManifestIndex, PageShard } from '@docstube/contracts';
import {
  buildFixtureClaimLedger,
  buildFixturePage,
  buildFixturePageShard,
  buildFixtureProvenanceV2,
  canonicalStateJson,
  mintId,
  idPrefixes
} from '@docstube/contracts';
import { manifestIndexRelativePath } from './verified-delta.ts';
import type { WorkspaceFileReader } from './verified-delta.ts';

// Pure fixture plumbing for the action tests: no git, no network, no filesystem.

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
  systemFlags: [...(input.systemFlags ?? [])]
});

export const shardRelativePath = (shard: PageShard): string =>
  `.docstube/manifest/pages/${shard.locale}/${shard.page.id}.json`;

export const buildFixtureWorkspace = (input: {
  shards: readonly PageShard[];
  systemFlags?: readonly Flag[];
}): { files: Map<string, string>; readWorkspaceFile: WorkspaceFileReader } => {
  const files = new Map<string, string>();
  files.set(
    manifestIndexRelativePath,
    canonicalStateJson(buildFixtureManifestIndex({ shards: input.shards, systemFlags: input.systemFlags }))
  );
  for (const shard of input.shards) {
    files.set(shardRelativePath(shard), canonicalStateJson(shard));
  }
  return { files, readWorkspaceFile: async (relativePath) => files.get(relativePath) };
};

// A shard with the v2 trust spine attached: two ClaimEvidence records (one checked, one
// unchecked) so claim-count assertions have honest non-zero inputs.
export const buildFixtureShardWithFlags = (flags: readonly Flag[]): PageShard => {
  const page = buildFixturePage();
  const ledger = buildFixtureClaimLedger(page.id);
  return {
    ...buildFixturePageShard(page),
    ledger,
    provenance: buildFixtureProvenanceV2(ledger),
    flags: [...flags]
  };
};
