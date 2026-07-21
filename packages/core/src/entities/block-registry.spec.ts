import { describe, expect, it } from 'vitest';
import { createBlockRegistry } from './block-registry.ts';

describe('createBlockRegistry', () => {
  it('always knows the inline Claim marker as core MDX vocabulary', () => {
    const registry = createBlockRegistry([]);
    const claim = registry.get('component:Claim');
    expect(claim).toBeDefined();
    expect(claim?.propsSchema.safeParse({ id: 'c1' }).success).toBe(true);
    // The id prop is required and follows the marker-id grammar.
    expect(claim?.propsSchema.safeParse({}).success).toBe(false);
    expect(claim?.propsSchema.safeParse({ id: 'not valid!' }).success).toBe(false);
    expect(registry.list()).toContain('component:Claim');
  });
});
