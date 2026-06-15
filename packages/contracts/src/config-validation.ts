import type { ZodError } from 'zod';
import { type DocstubeConfig, docstubeConfigSchema } from './config-schema';
import { type Glossary, glossarySchema } from './glossary-schema';
import { type Ia, iaSchema } from './ia-schema';

// Runtime validation helpers for the config family. These operate on already-parsed JS values
// (e.g. from a YAML load). YAML text handling and comment-preserving edits live in the core
// package, which owns config loading/editing.

export type ConfigFamilyFile = 'docstube.yml' | 'ia.yml' | 'glossary.yaml';

export type ConfigParseResult<T> = { ok: true; value: T } | { ok: false; file: ConfigFamilyFile; error: ZodError };

// Structured boundary error. Carries the offending config file and the raw Zod issues so
// callers can render precise diagnostics instead of a vague string.
export class ConfigValidationError extends Error {
  readonly file: ConfigFamilyFile;
  readonly issues: ZodError['issues'];

  constructor(file: ConfigFamilyFile, error: ZodError) {
    super(`Invalid ${file}: ${error.issues.length} issue(s)`);
    this.name = 'ConfigValidationError';
    this.file = file;
    this.issues = error.issues;
  }
}

export const safeParseDocstubeConfig = (input: unknown): ConfigParseResult<DocstubeConfig> => {
  const result = docstubeConfigSchema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, file: 'docstube.yml', error: result.error };
};

export const safeParseIa = (input: unknown): ConfigParseResult<Ia> => {
  const result = iaSchema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, file: 'ia.yml', error: result.error };
};

export const safeParseGlossary = (input: unknown): ConfigParseResult<Glossary> => {
  const result = glossarySchema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, file: 'glossary.yaml', error: result.error };
};

const unwrap = <T>(result: ConfigParseResult<T>): T => {
  if (result.ok) {
    return result.value;
  }
  throw new ConfigValidationError(result.file, result.error);
};

export const parseDocstubeConfig = (input: unknown): DocstubeConfig => unwrap(safeParseDocstubeConfig(input));

export const parseIa = (input: unknown): Ia => unwrap(safeParseIa(input));

export const parseGlossary = (input: unknown): Glossary => unwrap(safeParseGlossary(input));
