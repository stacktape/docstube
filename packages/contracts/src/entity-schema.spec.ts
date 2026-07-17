import { describe, expect, it } from 'vitest';
import { blockTypeSchema, componentBlockType, listPageEntityIds, pageEntitySchema } from './entity-schema.ts';
import { buildFixturePage } from './fixtures.ts';
import { rollUpGuarantee } from './provenance-schema.ts';

describe('entity schema', () => {
  it('round-trips the fixture page', () => {
    const page = buildFixturePage();
    const parsed = pageEntitySchema.parse(page);
    expect(parsed.sections[0]?.blocks[0]?.claims[0]?.claimClass).toBe('code-sample');
  });

  it('accepts core block types and registry component types, rejects malformed ones', () => {
    expect(blockTypeSchema.safeParse('code-example').success).toBe(true);
    expect(blockTypeSchema.safeParse(componentBlockType('Callout')).success).toBe(true);
    expect(blockTypeSchema.safeParse('component:').success).toBe(false);
    expect(blockTypeSchema.safeParse('Component:Callout').success).toBe(false);
  });

  it('collects every entity id in a page exactly once', () => {
    const page = buildFixturePage();
    const ids = listPageEntityIds(page);
    expect(ids).toHaveLength(new Set(ids).size);
    // page + preamble block + section + code block + claim
    expect(ids).toHaveLength(5);
  });

  it('rejects a page whose slug is not path-safe', () => {
    const page = { ...buildFixturePage(), slug: 'Getting Started' };
    expect(pageEntitySchema.safeParse(page).success).toBe(false);
  });
});

describe('guarantee roll-up', () => {
  it('is pessimistic', () => {
    expect(rollUpGuarantee(['proven', 'scored', 'proven'])).toBe('scored');
    expect(rollUpGuarantee(['proven', 'out-of-domain'])).toBe('out-of-domain');
    expect(rollUpGuarantee(['proven', 'proven'])).toBe('proven');
  });

  it('treats an entity with nothing provable as scored, never silently proven', () => {
    expect(rollUpGuarantee([])).toBe('scored');
  });
});
