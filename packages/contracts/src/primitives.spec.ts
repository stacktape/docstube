import type { ZodError, ZodType } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  identifierSchema,
  jsonValueSchema,
  packageVersionSchema,
  relativePathSchema,
  semverSchema,
  severities,
  severitySchema,
  timestampSchema
} from './primitives.ts';

const invalidError = (schema: ZodType, value: unknown): ZodError => {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error('Expected value to be invalid.');
  }

  return result.error;
};

describe('identifierSchema', () => {
  it('accepts lowercase kebab-case', () => {
    expect(identifierSchema.parse('getting-started')).toBe('getting-started');
  });

  it('rejects uppercase and underscores at the root path', () => {
    const error = invalidError(identifierSchema, 'Getting_Started');

    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.issues[0]?.path).toEqual([]);
  });
});

describe('relativePathSchema', () => {
  it('accepts a repo-relative posix path', () => {
    expect(relativePathSchema.parse('src/contracts.ts')).toBe('src/contracts.ts');
  });

  it('rejects absolute paths, backslashes, and traversal', () => {
    for (const bad of ['/abs', 'C:/Users/congy/project', 'C:project', 'src\\win', '../escape']) {
      const error = invalidError(relativePathSchema, bad);
      expect(error.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('severitySchema', () => {
  it('matches the blocker/major/minor taxonomy', () => {
    expect([...severities]).toEqual(['blocker', 'major', 'minor']);
    for (const value of severities) {
      expect(severitySchema.parse(value)).toBe(value);
    }
  });

  it('rejects unknown severities', () => {
    expect(severitySchema.safeParse('critical').success).toBe(false);
  });
});

describe('timestampSchema', () => {
  it('accepts UTC and offset ISO timestamps', () => {
    expect(timestampSchema.parse('2026-06-16T12:00:00Z')).toBe('2026-06-16T12:00:00Z');
    expect(timestampSchema.parse('2026-06-16T14:00:00+02:00')).toBe('2026-06-16T14:00:00+02:00');
  });

  it('rejects date-only strings', () => {
    expect(timestampSchema.safeParse('2026-06-16').success).toBe(false);
  });
});

describe('jsonValueSchema', () => {
  it('accepts nested JSON values', () => {
    expect(jsonValueSchema.parse({ ok: true, list: [1, null, 'x'] })).toEqual({ ok: true, list: [1, null, 'x'] });
  });

  it('rejects non-JSON values', () => {
    expect(jsonValueSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('semverSchema', () => {
  it('accepts release and prerelease versions', () => {
    expect(semverSchema.parse('1.2.3')).toBe('1.2.3');
    expect(semverSchema.parse('0.0.2-rc.1')).toBe('0.0.2-rc.1');
  });

  it('rejects partial and prefixed versions', () => {
    expect(semverSchema.safeParse('1.2').success).toBe(false);
    expect(semverSchema.safeParse('v1.2.3').success).toBe(false);
  });
});

describe('packageVersionSchema', () => {
  it('accepts scoped and unscoped package metadata', () => {
    expect(packageVersionSchema.parse({ name: '@docstube/contracts', version: '0.0.2' })).toEqual({
      name: '@docstube/contracts',
      version: '0.0.2'
    });
  });

  it('reports the offending field path for an invalid version', () => {
    const error = invalidError(packageVersionSchema, { name: 'docstube', version: 'latest' });

    expect(error.issues.map((issue) => issue.path)).toContainEqual(['version']);
  });
});
