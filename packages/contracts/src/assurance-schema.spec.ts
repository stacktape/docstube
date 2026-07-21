import { describe, expect, it } from 'vitest';
import { assuranceProfileSchema, supportMatrixSchema } from './assurance-schema.ts';

describe('assurance profile', () => {
  it('round-trips a profile scoping claim classes to accepted evidence kinds', () => {
    const result = assuranceProfileSchema.safeParse({
      profileVersion: 1,
      languages: ['typescript', 'python'],
      sourceProviders: ['openapi'],
      repoRoots: ['.'],
      artifactTypes: ['mdx-site'],
      claimClasses: [
        { class: 'shape', acceptedEvidence: ['codemap-grounding'] },
        { class: 'value', acceptedEvidence: ['execution', 'schema-check'] }
      ],
      requiredEnvironmentCapabilities: ['node>=24'],
      publication: { contradicted: 'block' }
    });
    expect(result.success).toBe(true);
    expect(result.data?.ledgerCompleteness).toEqual({ requireInlineAnchors: true, maxUncoveredAssertionSpans: 0 });
    expect(result.data?.publication).toEqual({
      unchecked: 'publish-labeled',
      ownerAttested: 'publish',
      contradicted: 'block'
    });
  });

  it('rejects a claim-class policy with no accepted evidence or unknown kinds', () => {
    const empty = assuranceProfileSchema.safeParse({
      profileVersion: 1,
      claimClasses: [{ class: 'shape', acceptedEvidence: [] }]
    });
    expect(empty.success).toBe(false);
    const unknown = assuranceProfileSchema.safeParse({
      profileVersion: 1,
      claimClasses: [{ class: 'shape', acceptedEvidence: ['gut-feeling'] }]
    });
    expect(unknown.success).toBe(false);
  });
});

describe('support matrix', () => {
  it('maps category → capability → support level', () => {
    const result = supportMatrixSchema.safeParse({
      languages: { typescript: 'supported', python: 'preview', java: 'unavailable' },
      transports: { 'claude-cli': 'supported' }
    });
    expect(result.success).toBe(true);
  });

  it('rejects levels outside supported/preview/unavailable', () => {
    expect(supportMatrixSchema.safeParse({ languages: { typescript: 'beta' } }).success).toBe(false);
  });
});
