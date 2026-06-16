import { describe, expect, it } from 'vitest';
import { registryComponentSchema, registrySchema, reservedComponentNames } from './registry-schema.ts';

describe('registry component metadata', () => {
  it('reserves the Screenshot component name', () => {
    expect([...reservedComponentNames]).toEqual(['Screenshot']);
  });

  it('rejects non-PascalCase component names', () => {
    expect(registryComponentSchema.safeParse({ name: 'callout', props: { ref: 'callout-props' } }).success).toBe(false);
  });

  it('defaults a component status to stable', () => {
    const component = registryComponentSchema.parse({ name: 'Callout', props: { ref: 'callout-props' } });
    expect(component.status).toBe('stable');
  });

  it('requires Screenshot to remain reserved', () => {
    expect(registryComponentSchema.safeParse({ name: 'Screenshot', props: { ref: 'screenshot-props' } }).success).toBe(
      false
    );
  });

  it('rejects reserved status for non-reserved component names', () => {
    expect(
      registryComponentSchema.safeParse({ name: 'Callout', status: 'reserved', props: { ref: 'callout-props' } })
        .success
    ).toBe(false);
  });

  it('snapshots a representative registry', () => {
    const registry = registrySchema.parse({
      components: [
        {
          name: 'Callout',
          description: 'Highlighted aside for notes and warnings',
          category: 'content',
          props: { ref: 'callout-props' }
        },
        {
          name: 'CodeGroup',
          description: 'Tabbed group of code blocks',
          category: 'code',
          status: 'experimental',
          props: { ref: 'code-group-props' }
        },
        {
          name: 'Screenshot',
          description: 'Reserved screenshot component (capture not implemented)',
          status: 'reserved',
          props: { ref: 'screenshot-props' }
        }
      ]
    });

    expect(registry).toMatchSnapshot();
  });
});
