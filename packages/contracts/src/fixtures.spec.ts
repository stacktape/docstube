import type { ZodError, ZodType } from 'zod';
import { describe, expect, it } from 'vitest';
import { contractFixtures, errorCoversPaths, issuePaths } from './fixtures';

const invalidError = (schema: ZodType, value: unknown): ZodError => {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error('Expected fixture value to be invalid.');
  }

  return result.error;
};

describe('contractFixtures', () => {
  describe.each(Object.entries(contractFixtures))('%s', (_name, fixtures) => {
    it('has both valid and invalid cases', () => {
      expect(fixtures.valid.length).toBeGreaterThan(0);
      expect(fixtures.invalid.length).toBeGreaterThan(0);
    });

    for (const valid of fixtures.valid) {
      it(`accepts valid: ${valid.name}`, () => {
        expect(fixtures.schema.safeParse(valid.value).success).toBe(true);
      });
    }

    for (const invalid of fixtures.invalid) {
      it(`rejects invalid with expected paths: ${invalid.name}`, () => {
        const error = invalidError(fixtures.schema, invalid.value);
        expect(error.issues.length).toBeGreaterThan(0);
        expect(errorCoversPaths(error, invalid.expectedPaths)).toBe(true);
      });
    }
  });
});

describe('issuePaths', () => {
  it('returns each issue path as a copied array', () => {
    const error = invalidError(contractFixtures.packageVersion.schema, { name: 'Bad Name', version: 'latest' });
    const paths = issuePaths(error);

    expect(paths).toContainEqual(['name']);
    expect(paths).toContainEqual(['version']);
  });
});

describe('errorCoversPaths', () => {
  it('is false when an expected path is missing', () => {
    const error = invalidError(contractFixtures.packageVersion.schema, { name: 'docstube', version: 'latest' });

    expect(errorCoversPaths(error, [['name']])).toBe(false);
  });
});
