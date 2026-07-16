import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixturePage, buildFixturePageShard } from '@docstube/contracts';
import { CoreError } from '../errors.ts';
import { createManifestStore } from './manifest-store.ts';
import { cutVersionSnapshot } from './version-cut.ts';

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-vercut-'));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('cutVersionSnapshot', () => {
  it('freezes every current shard under the label and records the version', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    const shard = buildFixturePageShard(buildFixturePage());
    await store.writePageShard(shard);
    await store.writeIndex({
      schemaVersion: 1,
      docstubeVersion: '0.0.2',
      sourceLocale: 'en',
      locales: ['en'],
      versions: [{ label: 'latest', status: 'current' }],
      pages: [
        { id: shard.page.id, slug: shard.page.slug, title: shard.page.title, path: `content/en/${shard.page.slug}.mdx` }
      ],
      configHash: '0'.repeat(64),
      iaHash: '0'.repeat(64),
      systemFlags: []
    });

    const result = await cutVersionSnapshot({ repoRoot, label: '1.x', currentVersion: 'latest' });
    expect(result.pagesFrozen).toBe(1);

    const frozen = await store.readPageShard({ locale: 'en', pageId: shard.page.id, version: '1.x' });
    expect(frozen?.version).toBe('1.x');
    // Frozen snapshots carry the entity ids they were cut with.
    expect(frozen?.page.id).toBe(shard.page.id);
    const frozenPath = join(
      repoRoot,
      '.docstube',
      'manifest',
      'versions',
      '1.x',
      'pages',
      'en',
      `${shard.page.id}.yml`
    );
    expect((await stat(frozenPath)).isFile()).toBe(true);

    const index = await store.readIndex();
    expect(index?.versions).toContainEqual(expect.objectContaining({ label: '1.x', status: 'frozen' }));
    // The live version stays live.
    expect(index?.versions).toContainEqual(expect.objectContaining({ label: 'latest', status: 'current' }));
  });

  it('refuses to freeze the current version label', async () => {
    const store = createManifestStore(repoRoot, 'latest');
    await store.writeIndex({
      schemaVersion: 1,
      docstubeVersion: '0.0.2',
      sourceLocale: 'en',
      locales: ['en'],
      versions: [{ label: 'latest', status: 'current' }],
      pages: [],
      configHash: '0'.repeat(64),
      iaHash: '0'.repeat(64),
      systemFlags: []
    });
    await expect(cutVersionSnapshot({ repoRoot, label: 'latest', currentVersion: 'latest' })).rejects.toThrow(
      CoreError
    );
  });
});
