import { describe, expect, it } from 'vitest';
import { buildFixturePage, buildFixturePageShard } from './fixtures.ts';
import { manifestIndexSchema, pageShardRelativePath, pageShardSchema } from './manifest-schema.ts';

describe('manifest shards', () => {
  it('round-trips a page shard', () => {
    const shard = buildFixturePageShard(buildFixturePage());
    const parsed = pageShardSchema.parse(shard);
    expect(parsed.page.sections[0]?.blocks[0]?.provenance.sources[0]?.symbol).toMatch(/^ts:/);
  });

  it('places current-version shards under pages/ and frozen versions under versions/', () => {
    const current = pageShardRelativePath({ locale: 'en', pageId: 'pg_x', currentVersion: 'latest' });
    expect(current).toBe('pages/en/pg_x.yml');
    const frozen = pageShardRelativePath({ locale: 'de', pageId: 'pg_x', version: '1.x', currentVersion: 'latest' });
    expect(frozen).toBe('versions/1.x/pages/de/pg_x.yml');
    const explicitCurrent = pageShardRelativePath({
      locale: 'en',
      pageId: 'pg_x',
      version: 'latest',
      currentVersion: 'latest'
    });
    expect(explicitCurrent).toBe('pages/en/pg_x.yml');
  });

  it('requires at least one declared version in the index', () => {
    const index = {
      schemaVersion: 1,
      docstubeVersion: '0.0.2',
      sourceLocale: 'en',
      locales: ['en'],
      versions: [],
      pages: [],
      configHash: '0'.repeat(64),
      iaHash: '0'.repeat(64)
    };
    expect(manifestIndexSchema.safeParse(index).success).toBe(false);
    expect(
      manifestIndexSchema.safeParse({ ...index, versions: [{ label: 'latest', status: 'current' }] }).success
    ).toBe(true);
  });
});
