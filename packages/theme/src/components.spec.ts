import { describe, expect, it } from 'vitest';
import { builtinComponentNames, builtinComponents } from './components.ts';

describe('builtinComponents', () => {
  it('every component has a valid name, description, and parseable Zod props schema', () => {
    expect(builtinComponents.length).toBeGreaterThanOrEqual(8);
    for (const component of builtinComponents) {
      expect(component.name).toMatch(/^[A-Z][A-Za-z0-9]*$/);
      expect(component.description.length).toBeGreaterThan(0);
      const result = component.propsSchema.safeParse({});
      expect(typeof result.success).toBe('boolean');
    }
  });

  it('component names are unique', () => {
    expect(new Set(builtinComponentNames).size).toBe(builtinComponents.length);
  });

  it('Callout accepts valid props and applies the tone default', () => {
    const callout = builtinComponents.find((component) => component.name === 'Callout');
    expect(callout).toBeDefined();
    const parsed = callout?.propsSchema.safeParse({ tone: 'warning', title: 'Heads up' });
    expect(parsed?.success).toBe(true);
    const defaulted = callout?.propsSchema.safeParse({});
    expect(defaulted?.success).toBe(true);
    expect((defaulted?.data as { tone: string } | undefined)?.tone).toBe('info');
  });

  it('Callout rejects unknown tones and unknown props', () => {
    const callout = builtinComponents.find((component) => component.name === 'Callout');
    expect(callout?.propsSchema.safeParse({ tone: 'loud' }).success).toBe(false);
    expect(callout?.propsSchema.safeParse({ bogus: true }).success).toBe(false);
  });

  it('Tabs requires at least one tab', () => {
    const tabs = builtinComponents.find((component) => component.name === 'Tabs');
    expect(tabs?.propsSchema.safeParse({ tabs: [] }).success).toBe(false);
    expect(tabs?.propsSchema.safeParse({ tabs: [{ label: 'npm', value: 'npm' }] }).success).toBe(true);
  });
});
