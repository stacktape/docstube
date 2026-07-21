import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createBlockRegistry } from './block-registry.ts';

describe('createBlockRegistry', () => {
  it('does NOT register Claim as a component — it is inline claim vocabulary, never a block type', () => {
    const registry = createBlockRegistry([]);
    expect(registry.get('component:Claim')).toBeUndefined();
    expect(registry.list()).not.toContain('component:Claim');
  });

  it('registers configured components under component:<Name>', () => {
    const registry = createBlockRegistry([
      { name: 'Callout', description: 'A callout box.', propsSchema: z.object({ kind: z.enum(['info', 'warning']) }) }
    ]);
    const callout = registry.get('component:Callout');
    expect(callout?.propsSchema.safeParse({ kind: 'info' }).success).toBe(true);
    expect(callout?.propsSchema.safeParse({ kind: 'loud' }).success).toBe(false);
    expect(registry.list()).toContain('component:Callout');
  });
});
