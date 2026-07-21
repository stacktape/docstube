import { describe, expect, it } from 'vitest';
import { iaSchema } from './ia-schema.ts';
import { convertIaToV2, iaV2Schema, walkIaV2Nodes } from './ia-v2-schema.ts';

const page = (slug: string, extra: Record<string, unknown> = {}) => ({
  kind: 'page',
  slug,
  title: slug,
  brief: `About ${slug}.`,
  primaryPersona: 'app-developer',
  depth: 'standard',
  ...extra
});

describe('ia v2 schema', () => {
  it('accepts a tree of groups and pages', () => {
    const result = iaV2Schema.safeParse({
      schemaVersion: 2,
      tree: [
        page('getting-started', { sourceScope: { globs: ['src/cli/**'], symbols: ['Cli.*'] } }),
        {
          kind: 'group',
          groupId: 'guides',
          title: 'Guides',
          consistency: { mode: 'explicit', rules: [{ code: 'required-facets', parameters: { facets: ['Pricing'] } }] },
          children: [page('advanced', { secondaryPersonas: ['operator'], structuralExceptions: ['pricing'] })]
        }
      ]
    });
    expect(result.success).toBe(true);
  });

  it('models consistency as registry-addressed rules — the legacy requiredFacets key is a hard error', () => {
    const result = iaV2Schema.safeParse({
      schemaVersion: 2,
      tree: [
        {
          kind: 'group',
          groupId: 'guides',
          title: 'Guides',
          consistency: { mode: 'explicit', requiredFacets: ['Pricing'] },
          children: [page('advanced')]
        }
      ]
    });
    expect(result.success).toBe(false);
    const badCode = iaV2Schema.safeParse({
      schemaVersion: 2,
      tree: [
        {
          kind: 'group',
          groupId: 'guides',
          title: 'Guides',
          consistency: { mode: 'explicit', rules: [{ code: 'Not A Code' }] },
          children: [page('advanced')]
        }
      ]
    });
    expect(badCode.success).toBe(false);
  });

  it('rejects a malformed page sourceScope — the coverage ratchet depends on its shape', () => {
    const result = iaV2Schema.safeParse({
      schemaVersion: 2,
      tree: [page('getting-started', { sourceScope: { paths: ['src/**'] } })]
    });
    expect(result.success).toBe(false);
  });

  it('rejects a node with an unknown kind — the union is explicit, never inferred', () => {
    const result = iaV2Schema.safeParse({
      schemaVersion: 2,
      tree: [{ kind: 'folder', groupId: 'guides', title: 'Guides', children: [] }]
    });
    expect(result.success).toBe(false);
  });

  it('rejects a page missing its primary persona', () => {
    const node = page('setup') as Record<string, unknown>;
    delete node['primaryPersona'];
    expect(iaV2Schema.safeParse({ schemaVersion: 2, tree: [node] }).success).toBe(false);
  });

  it('rejects duplicate slugs, pageIds, and groupIds anywhere in the tree', () => {
    const dupSlug = iaV2Schema.safeParse({
      schemaVersion: 2,
      tree: [page('setup'), { kind: 'group', groupId: 'g', title: 'G', children: [page('setup')] }]
    });
    expect(dupSlug.success).toBe(false);
    const pageId = 'pg_00000000000000000000';
    const dupPageId = iaV2Schema.safeParse({
      schemaVersion: 2,
      tree: [page('a', { pageId }), page('b', { pageId })]
    });
    expect(dupPageId.success).toBe(false);
    const dupGroupId = iaV2Schema.safeParse({
      schemaVersion: 2,
      tree: [
        { kind: 'group', groupId: 'g', title: 'G1', children: [page('a')] },
        { kind: 'group', groupId: 'g', title: 'G2', children: [page('b')] }
      ]
    });
    expect(dupGroupId.success).toBe(false);
  });

  it('hard-errors on unknown keys in either node kind', () => {
    const result = iaV2Schema.safeParse({ schemaVersion: 2, tree: [page('a', { breif: 'typo' })] });
    expect(result.success).toBe(false);
  });
});

describe('legacy ia conversion', () => {
  it('upgrades pages and grouping nodes with stable groupIds and persona defaults', () => {
    const legacy = iaSchema.parse({
      schemaVersion: 1,
      tree: [
        { title: 'Getting started', slug: 'getting-started', brief: 'Start here.', depth: 'overview' },
        {
          title: 'Guides',
          slug: 'guides',
          children: [{ title: 'Advanced', slug: 'advanced', brief: 'Deep dive.', pageId: 'pg_00000000000000000000' }]
        }
      ],
      pageCountTarget: 12
    });
    const v2 = convertIaToV2(legacy, { defaultPrimaryPersona: 'app-developer' });
    expect(v2.schemaVersion).toBe(2);
    expect(v2.pageCountTarget).toBe(12);
    const [first, group] = v2.tree;
    expect(first).toMatchObject({
      kind: 'page',
      slug: 'getting-started',
      depth: 'overview',
      primaryPersona: 'app-developer'
    });
    expect(group).toMatchObject({ kind: 'group', groupId: 'guides' });
    const pages = walkIaV2Nodes(v2.tree).filter((node) => node.kind === 'page');
    expect(pages).toHaveLength(2);
    expect(pages[1]).toMatchObject({ pageId: 'pg_00000000000000000000', depth: 'standard' });
  });

  it('falls back to the title when a legacy page node has a pageId but no brief', () => {
    const legacy = iaSchema.parse({
      schemaVersion: 1,
      tree: [{ title: 'Reference', slug: 'reference', pageId: 'pg_00000000000000000000' }]
    });
    const v2 = convertIaToV2(legacy, { defaultPrimaryPersona: 'app-developer' });
    expect(v2.tree[0]).toMatchObject({ kind: 'page', brief: 'Reference' });
  });

  it('derives nested groupIds from the ancestor slug path', () => {
    const legacy = iaSchema.parse({
      schemaVersion: 1,
      tree: [
        {
          title: 'API',
          slug: 'api',
          children: [{ title: 'REST', slug: 'rest', children: [{ title: 'Auth', slug: 'auth', brief: 'Auth.' }] }]
        }
      ]
    });
    const v2 = convertIaToV2(legacy, { defaultPrimaryPersona: 'app-developer' });
    const groups = walkIaV2Nodes(v2.tree).filter((node) => node.kind === 'group');
    expect(groups.map((group) => group.groupId)).toEqual(['api', 'api-rest']);
  });
});
