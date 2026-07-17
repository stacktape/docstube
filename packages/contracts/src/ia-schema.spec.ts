import { describe, expect, it } from 'vitest';
import { iaSchema } from './ia-schema.ts';

const node = (slug: string, extra: Record<string, unknown> = {}) => ({
  title: slug,
  slug,
  brief: `About ${slug}.`,
  ...extra
});

describe('ia.yml schema', () => {
  it('accepts a tree with unique page slugs and pageIds', () => {
    const result = iaSchema.safeParse({
      schemaVersion: 1,
      tree: [node('getting-started'), { title: 'Guides', slug: 'guides', children: [node('advanced')] }]
    });
    expect(result.success).toBe(true);
  });

  it('rejects duplicate pageIds anywhere in the tree', () => {
    const pageId = 'pg_00000000000000000000';
    const result = iaSchema.safeParse({
      schemaVersion: 1,
      tree: [node('a', { pageId }), { title: 'B', slug: 'b', children: [node('c', { pageId })] }]
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes('duplicate pageId'))).toBe(true);
  });

  it('rejects two page-rendering nodes that resolve to the same slug route', () => {
    const result = iaSchema.safeParse({
      schemaVersion: 1,
      tree: [node('setup'), { title: 'Guides', slug: 'guides', children: [node('setup')] }]
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes('duplicate page slug'))).toBe(true);
  });

  it('allows grouping nodes (no brief, no pageId) to reuse a slug without colliding', () => {
    const result = iaSchema.safeParse({
      schemaVersion: 1,
      tree: [
        { title: 'API', slug: 'api', children: [node('client')] },
        { title: 'API again', slug: 'api', children: [node('server')] }
      ]
    });
    expect(result.success).toBe(true);
  });

  it('hard-errors on unknown keys — typos must not vanish silently', () => {
    const root = iaSchema.safeParse({ schemaVersion: 1, tree: [node('a')], pageCount: 5 });
    expect(root.success).toBe(false);
    const nested = iaSchema.safeParse({
      schemaVersion: 1,
      tree: [{ title: 'A', slug: 'a', breif: 'typo of brief' }]
    });
    expect(nested.success).toBe(false);
  });
});
