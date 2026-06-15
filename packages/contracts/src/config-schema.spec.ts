import type { ZodError, ZodType } from 'zod';
import { describe, expect, it } from 'vitest';
import { docstubeConfigSchema } from './config-schema';
import { configFamilyFixtures, docstubeConfigFixtures } from './config-fixtures';
import {
  ConfigValidationError,
  type ConfigParseResult,
  parseDocstubeConfig,
  safeParseDocstubeConfig,
  safeParseGlossary,
  safeParseIa
} from './config-validation';
import { errorCoversPaths } from './fixtures';

const invalidError = (schema: ZodType, value: unknown): ZodError => {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error('Expected config fixture value to be invalid.');
  }

  return result.error;
};

const parsedValue = <T>(result: ConfigParseResult<T>): T => {
  if (!result.ok) {
    throw new Error(`Expected ${result.file} to parse successfully.`);
  }

  return result.value;
};

const parseFailure = <T>(result: ConfigParseResult<T>): Extract<ConfigParseResult<T>, { ok: false }> => {
  if (result.ok) {
    throw new Error('Expected config parse to fail.');
  }

  return result;
};

const capturedValidationError = (parse: () => unknown): ConfigValidationError => {
  try {
    parse();
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected ConfigValidationError.');
};

describe('config family fixtures', () => {
  describe.each(Object.entries(configFamilyFixtures))('%s', (_name, fixtures) => {
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

describe('docstubeConfigSchema defaults', () => {
  it('fills output, version, ia, and glossary defaults', () => {
    const config = parseDocstubeConfig(docstubeConfigFixtures.valid[0]!.value);

    expect(config.version).toBe(1);
    expect(config.output).toEqual({ dir: 'docs', layout: 'single-tree' });
    expect(config.ia).toBe('ia.yml');
    expect(config.glossary).toBe('glossary.yaml');
    expect(config.site.locale).toBe('en');
  });
});

describe('reserved screenshots object', () => {
  it('validates an object without triggering screenshot behavior', () => {
    const config = parseDocstubeConfig({
      site: { name: 'Acme' },
      docsType: 'application',
      personas: [{ id: 'developer', title: 'Developer' }],
      agents: { writer: { adapter: 'claude' } },
      screenshots: { enabled: true, anyReservedKey: 'preserved' }
    });

    expect(config.screenshots).toEqual({ enabled: true, anyReservedKey: 'preserved' });
  });

  it('still rejects a non-object screenshots value', () => {
    const result = docstubeConfigSchema.safeParse({
      site: { name: 'Acme' },
      docsType: 'application',
      personas: [{ id: 'developer', title: 'Developer' }],
      agents: { writer: { adapter: 'claude' } },
      screenshots: 'enabled'
    });

    expect(result.success).toBe(false);
  });
});

describe('validation helpers', () => {
  it('safeParseDocstubeConfig returns a typed value on success', () => {
    const value = parsedValue(safeParseDocstubeConfig(docstubeConfigFixtures.valid[0]!.value));

    expect(value.site.name).toBe('Acme Toolkit');
  });

  it('safeParse reports the offending file on failure', () => {
    const result = parseFailure(safeParseIa({ nav: [] }));

    expect(result.file).toBe('ia.yml');
  });

  it('parseDocstubeConfig throws a structured ConfigValidationError', () => {
    const error = capturedValidationError(() => parseDocstubeConfig({ docsType: 'library' }));

    expect(error.file).toBe('docstube.yml');
    expect(error.issues.length).toBeGreaterThan(0);
  });

  it('safeParseGlossary accepts a valid glossary', () => {
    const result = safeParseGlossary(configFamilyFixtures.glossary.valid[0]!.value);

    expect(result.ok).toBe(true);
  });
});
