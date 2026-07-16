import { describe, expect, it } from 'vitest';
import { buildFixturePage, buildFixturePageShard } from '@docstube/contracts';
import {
  buildFixtureFlag,
  buildFixtureShardWithFlags,
  buildFixtureWorkspace,
  shardRelativePath
} from './test-support.ts';
import { countPageGuarantees, isPageShardPath, loadVerifiedDelta } from './verified-delta.ts';

describe('verified delta', () => {
  it('recognizes page shard paths including frozen versions and Windows separators', () => {
    expect(isPageShardPath('.docstube/manifest/pages/en/pg_00000000000000000000.yml')).toBe(true);
    expect(isPageShardPath('.docstube/manifest/versions/1.x/pages/en/pg_00000000000000000000.yml')).toBe(true);
    expect(isPageShardPath('.docstube\\manifest\\pages\\en\\pg_00000000000000000000.yml')).toBe(true);
    expect(isPageShardPath('.docstube/manifest/manifest.yml')).toBe(false);
    expect(isPageShardPath('docs-site/content/en/installation.mdx')).toBe(false);
  });

  it('counts block and claim guarantees per page', () => {
    // Fixture page: scored preamble block; proven code block with one proven claim.
    expect(countPageGuarantees(buildFixturePage())).toEqual({ proven: 2, scored: 1, 'out-of-domain': 0 });
  });

  it('computes changed pages, guarantee counts, and open flags from the manifest', async () => {
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
      guarantees: { proven: 2, scored: 1, 'out-of-domain': 0 }
    });
    expect(delta?.changedPages[0]?.openFlags.map((flag) => flag.kind)).toEqual(['coverage']);
    expect(delta?.totals).toEqual({ proven: 2, scored: 1, 'out-of-domain': 0 });
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
