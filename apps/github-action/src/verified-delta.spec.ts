import { describe, expect, it } from 'vitest';
import { buildFixturePage, buildFixturePageShard, buildFixtureStructuralFinding } from '@docstube/contracts';
import {
  buildFixtureFlag,
  buildFixtureShardWithFlags,
  buildFixtureWorkspace,
  shardRelativePath
} from './test-support.ts';
import { countShardClaims, isPageShardPath, loadVerifiedDelta } from './verified-delta.ts';

describe('structural quality in the verified delta', () => {
  it('reports open structural findings separately, never as flags', async () => {
    const shard = buildFixtureShardWithFlags([]);
    const groupFinding = buildFixtureStructuralFinding([shard.page.id, 'pg_00000000000000000009']);
    const pageFinding = {
      ...groupFinding,
      key: 'structure.empty-section:page',
      code: 'structure.empty-section',
      scope: { kind: 'entity' as const, pageId: shard.page.id },
      detector: { kind: 'deterministic' as const, id: 'outline-integrity', version: '1' },
      authority: { kind: 'builtin-rule' as const, ruleCode: 'outline-integrity.empty-section' }
    };
    const workspace = buildFixtureWorkspace({
      shards: [{ ...shard, structuralFindings: [pageFinding] }],
      structuralGroups: [
        {
          schemaVersion: 1,
          groupId: 'compute-resources',
          generatedAt: '2026-07-12T00:00:00.000Z',
          pageIds: [shard.page.id],
          findings: [groupFinding, { ...groupFinding, key: 'resolved-one', status: { state: 'resolved' } }]
        }
      ]
    });

    const delta = await loadVerifiedDelta({ changedFiles: [], readWorkspaceFile: workspace.readWorkspaceFile });

    expect(delta?.structural.openPageFindings).toBe(1);
    expect(delta?.structural.openGroupFindings).toBe(1);
    // The merge-gate input is untouched by structural work items.
    expect(delta?.openFlags).toEqual([]);
  });
});

describe('verified delta', () => {
  it('recognizes page shard paths including frozen versions and Windows separators', () => {
    expect(isPageShardPath('.docstube/manifest/pages/en/pg_00000000000000000000.json')).toBe(true);
    expect(isPageShardPath('.docstube/manifest/versions/1.x/pages/en/pg_00000000000000000000.json')).toBe(true);
    expect(isPageShardPath('.docstube\\manifest\\pages\\en\\pg_00000000000000000000.json')).toBe(true);
    expect(isPageShardPath('.docstube/manifest/manifest.json')).toBe(false);
    expect(isPageShardPath('docs-site/content/en/installation.mdx')).toBe(false);
  });

  it('counts claims per shard from the canonical ClaimEvidence records', () => {
    // Fixture spine: one checked code-structure claim, one unchecked value claim.
    expect(countShardClaims(buildFixtureShardWithFlags([]))).toEqual({ checked: 1, unchecked: 1, contradicted: 0 });
    // No trust spine → honest zeros, never invented counts.
    expect(countShardClaims(buildFixturePageShard(buildFixturePage()))).toEqual({
      checked: 0,
      unchecked: 0,
      contradicted: 0
    });
  });

  it('computes changed pages, claim counts, and open flags from the manifest', async () => {
    const shard = buildFixtureShardWithFlags([
      buildFixtureFlag({ kind: 'coverage' }),
      buildFixtureFlag({ kind: 'guarantee-downgrade', status: 'resolved' })
    ]);
    const untouchedShard = buildFixtureShardWithFlags([buildFixtureFlag({ kind: 'tribal-knowledge' })]);
    const systemFlag = buildFixtureFlag({ kind: 'system', summary: 'build system misidentified' });
    const workspace = buildFixtureWorkspace({ shards: [shard, untouchedShard], systemFlags: [systemFlag] });

    const delta = await loadVerifiedDelta({
      changedFiles: [shardRelativePath(shard), 'docs-site/content/en/getting-started/installation.mdx'],
      readWorkspaceFile: workspace.readWorkspaceFile
    });

    expect(delta).toBeDefined();
    expect(delta?.changedPages).toHaveLength(1);
    expect(delta?.changedPages[0]).toMatchObject({
      pageId: shard.page.id,
      slug: 'getting-started/installation',
      locale: 'en',
      claims: { checked: 1, unchecked: 1, contradicted: 0 }
    });
    expect(delta?.changedPages[0]?.openFlags.map((flag) => flag.kind)).toEqual(['coverage']);
    expect(delta?.totals).toEqual({ checked: 1, unchecked: 1, contradicted: 0 });
    // The gate input covers ALL open flags: changed shard + untouched shard + index systemFlags;
    // the resolved flag never appears.
    expect(delta?.openFlags.map((flag) => flag.kind).toSorted()).toEqual(['coverage', 'system', 'tribal-knowledge']);
  });

  it('returns undefined when no manifest index exists', async () => {
    await expect(
      loadVerifiedDelta({ changedFiles: ['docs-site/index.mdx'], readWorkspaceFile: async () => undefined })
    ).resolves.toBeUndefined();
  });

  it('throws a path-labeled error for a corrupt shard', async () => {
    const shard = buildFixturePageShard(buildFixturePage());
    const workspace = buildFixtureWorkspace({ shards: [shard] });
    workspace.files.set(shardRelativePath(shard), 'schemaVersion: 99');

    await expect(
      loadVerifiedDelta({ changedFiles: [shardRelativePath(shard)], readWorkspaceFile: workspace.readWorkspaceFile })
    ).rejects.toThrow(shardRelativePath(shard));
  });
});
