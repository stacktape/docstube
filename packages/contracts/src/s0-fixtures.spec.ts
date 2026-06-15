import type { ZodError, ZodType } from 'zod';
import { describe, expect, it } from 'vitest';
import { errorCoversPaths } from './fixtures';
import { s0Fixtures } from './s0-fixtures';

const invalidError = (schema: ZodType, value: unknown): ZodError => {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error('Expected S0 fixture value to be invalid.');
  }

  return result.error;
};

describe('s0 contract fixtures', () => {
  describe.each(Object.entries(s0Fixtures))('%s', (_name, fixtures) => {
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
