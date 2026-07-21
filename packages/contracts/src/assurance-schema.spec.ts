import { describe, expect, it } from 'vitest';
import { assuranceProfileSchema, supportMatrixSchema } from './assurance-schema.ts';

describe('assurance profile', () => {
  it('round-trips a descriptive profile: languages, classes, evidence kinds, capabilities', () => {
    const result = assuranceProfileSchema.safeParse({
      schemaVersion: 1,
      profileVersion: 3,
      languages: ['typescript', 'python'],
      claimClasses: ['code-structure', 'value'],
      evidenceKinds: ['codemap-grounding', 'value-predicate', 'execution'],
      capabilities: ['node>=24']
    });
    expect(result.success).toBe(true);
  });

  it('separates the format version from the domain profile revision', () => {
    expect(assuranceProfileSchema.safeParse({ profileVersion: 1 }).success).toBe(false);
    expect(assuranceProfileSchema.safeParse({ schemaVersion: 1, profileVersion: 0 }).success).toBe(false);
  });

  it('is descriptive only — trust-configuration knobs are not part of the contract', () => {
    const parsed = assuranceProfileSchema.parse({
      schemaVersion: 1,
      profileVersion: 1,
      // Stripped, never honored: class authority and publication policy are kernel-owned.
      claimClasses: ['value'],
      ledgerCompleteness: { maxUncoveredAssertionSpans: 100 },
      publication: { contradicted: 'publish' }
    });
    expect(parsed).toEqual({
      schemaVersion: 1,
      profileVersion: 1,
      languages: [],
      claimClasses: ['value'],
      evidenceKinds: [],
      capabilities: []
    });
  });

  it('rejects unknown evidence kinds and malformed class tokens', () => {
    expect(
      assuranceProfileSchema.safeParse({ schemaVersion: 1, profileVersion: 1, evidenceKinds: ['gut-feeling'] }).success
    ).toBe(false);
    expect(
      assuranceProfileSchema.safeParse({ schemaVersion: 1, profileVersion: 1, claimClasses: ['Not A Class'] }).success
    ).toBe(false);
  });
});

describe('support matrix', () => {
  it('maps category → capability → support level under a versioned envelope', () => {
    const result = supportMatrixSchema.safeParse({
      schemaVersion: 1,
      categories: {
        languages: { typescript: 'supported', python: 'preview', java: 'unavailable' },
        transports: { 'claude-cli': 'supported' }
      }
    });
    expect(result.success).toBe(true);
  });

  it('rejects levels outside supported/preview/unavailable and unversioned matrices', () => {
    expect(
      supportMatrixSchema.safeParse({ schemaVersion: 1, categories: { languages: { typescript: 'beta' } } }).success
    ).toBe(false);
    expect(supportMatrixSchema.safeParse({ categories: {} }).success).toBe(false);
  });
});
