import { describe, expect, it } from 'vitest';
import { archetypeDefaultsSchema, archetypeSchema, defaultsForArchetype } from './archetype-schema.ts';

describe('archetypes', () => {
  it('accepts the v2 archetype set and rejects the legacy docType names', () => {
    expect(archetypeSchema.safeParse('cli-tool').success).toBe(true);
    expect(archetypeSchema.safeParse('external-library').success).toBe(false);
  });

  it('produces schema-valid defaults for every archetype', () => {
    for (const archetype of archetypeSchema.options) {
      const defaults = defaultsForArchetype(archetype);
      expect(archetypeDefaultsSchema.safeParse(defaults).success).toBe(true);
      expect(defaults.suggestedPersonas.length).toBeGreaterThan(0);
    }
  });

  it('kills the private-repo→internal-docs misclassification: only internal-tooling defaults internal', () => {
    const internalArchetypes = archetypeSchema.options.filter(
      (archetype) => defaultsForArchetype(archetype).visibility === 'internal'
    );
    expect(internalArchetypes).toEqual(['internal-tooling']);
  });

  it('turns coverage on for symbol-surfaced archetypes and off for product docs', () => {
    expect(defaultsForArchetype('library').coverage).toBe('on');
    expect(defaultsForArchetype('api-service').coverage).toBe('on');
    expect(defaultsForArchetype('saas-product').coverage).toBe('off');
    expect(defaultsForArchetype('monorepo-mixed').coverage).toBe('auto');
  });
});
