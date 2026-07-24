import { describe, expect, it } from 'vitest';
import { blockTypeSchema, componentBlockType, listPageEntityIds, pageEntitySchema } from './entity-schema.ts';
import { buildFixturePage } from './fixtures.ts';

describe('entity schema', () => {
  it('round-trips the fixture page (no legacy claims/guarantee fields exist on entities)', () => {
    const page = buildFixturePage();
    const parsed = pageEntitySchema.parse(page);
    expect(parsed.sections[0]?.blocks[0]?.blockType).toBe('code-example');
    expect(Object.keys(parsed)).not.toContain('guarantee');
    expect(Object.keys(parsed.sections[0]?.blocks[0] ?? {})).not.toContain('claims');
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
    // page + preamble block + section + code block
    expect(ids).toHaveLength(4);
  });

  it('rejects a page whose slug is not path-safe', () => {
    const page = { ...buildFixturePage(), slug: 'Getting Started' };
    expect(pageEntitySchema.safeParse(page).success).toBe(false);
  });
});
