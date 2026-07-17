import { z } from 'zod';

// Crockford base32 (lowercase, no i/l/o/u) — unambiguous in URLs, logs, and YAML.
const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const ID_BODY_LENGTH = 20;
const ID_BODY_PATTERN = `[${ID_ALPHABET}]{${ID_BODY_LENGTH}}`;

export const idPrefixes = {
  page: 'pg',
  section: 'sc',
  block: 'bl',
  claim: 'cl',
  flag: 'fl',
  run: 'run',
  task: 'tk',
  context: 'ctx'
} as const;

export type IdPrefix = (typeof idPrefixes)[keyof typeof idPrefixes];

export const mintId = (prefix: IdPrefix): string => {
  const bytes = new Uint8Array(ID_BODY_LENGTH);
  crypto.getRandomValues(bytes);
  let body = '';
  for (const byte of bytes) {
    body += ID_ALPHABET[byte % 32];
  }
  return `${prefix}_${body}`;
};

export const idSchema = (prefix: IdPrefix) => z.string().regex(new RegExp(`^${prefix}_${ID_BODY_PATTERN}$`));

export const pageIdSchema = idSchema(idPrefixes.page);
export const sectionIdSchema = idSchema(idPrefixes.section);
export const blockIdSchema = idSchema(idPrefixes.block);
export const claimIdSchema = idSchema(idPrefixes.claim);
export const flagIdSchema = idSchema(idPrefixes.flag);
export const runIdSchema = idSchema(idPrefixes.run);
export const taskIdSchema = idSchema(idPrefixes.task);

export const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/, 'expected a semver version');

export const isoTimestampSchema = z.iso.datetime({ offset: true });

// BCP-47 subset we support: language, optional script subtag, optional region —
// "en", "pt-BR", "zh-Hans", "zh-Hans-CN".
export const localeCodeSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/, 'expected a locale code like "en", "pt-BR", or "zh-Hans"');

// Docs version labels are user-declared, path-safe strings: "1.x", "v2", "2026-06".
export const versionLabelSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

// Repo-relative POSIX path (the manifest never stores absolute or Windows-style paths).
export const repoPathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value), {
    message: 'expected a repo-relative POSIX path'
  });

export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

// Content-derived keys namespaced by producer: "ts:<sha256>", "py:<sha256>", "openapi:<sha256>".
export const sourceKeySchema = z.string().regex(/^[a-z][a-z0-9-]*:[0-9a-f]{64}$/);

export const severitySchema = z.enum(['info', 'warning', 'error']);
export type Severity = z.infer<typeof severitySchema>;

// Inclusive 1-based line range within a file.
export const lineSpanSchema = z
  .tuple([z.number().int().positive(), z.number().int().positive()])
  .refine(([start, end]) => end >= start, { message: 'span end must be >= start' });
export type LineSpan = z.infer<typeof lineSpanSchema>;
