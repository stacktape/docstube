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
  context: 'ctx',
  knowledgeNeed: 'kn',
  knowledgeFact: 'kf',
  evidence: 'ev',
  waiver: 'wv',
  // A locale/version-independent logical entity thread (trust-model-v2 decision 8): the durable
  // identity human threads and knowledge bind to, distinct from any full entity address.
  entityThread: 'et'
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
export const knowledgeNeedIdSchema = idSchema(idPrefixes.knowledgeNeed);
export const knowledgeFactIdSchema = idSchema(idPrefixes.knowledgeFact);
export const contextIdSchema = idSchema(idPrefixes.context);
export const evidenceIdSchema = idSchema(idPrefixes.evidence);
export const waiverIdSchema = idSchema(idPrefixes.waiver);
export const entityThreadIdSchema = idSchema(idPrefixes.entityThread);

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
// '.' (the repo root itself) is allowed; traversal and self-referencing segments are not.
export const repoPathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value), {
    message: 'expected a repo-relative POSIX path'
  })
  .refine(
    (value) =>
      value === '.' || value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    { message: 'path must not contain empty, "." or ".." segments' }
  );

export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

// Abbreviated through full git object ids: SHA-1 (7..40 hex) or full SHA-256 (exactly 64 hex).
// 41..63 hex chars are impossible git object ids and are rejected.
const GIT_SHA_PATTERN = /^(?:[0-9a-f]{7,40}|[0-9a-f]{64})$/;
export const gitShaSchema = z.string().regex(GIT_SHA_PATTERN);

// Content-derived keys namespaced by producer: "ts:<sha256>", "py:<sha256>", "openapi:<sha256>".
export const sourceKeySchema = z.string().regex(/^[a-z][a-z0-9-]*:[0-9a-f]{64}$/);

// Distinct branded primitives for the v2 contracts. All five were previously conflated behind
// sourceKeySchema / sha256HexSchema / gitShaSchema; branding stops a git commit, a content hash,
// a fingerprint print, an entity revision, and a symbol source key from being passed for one
// another once codemap/core integrate (Sol fidelity review, interop risks).

// A git commit id (repository revision — never used as a content-derived revision).
export const gitCommitSchema = z.string().regex(GIT_SHA_PATTERN).brand<'GitCommit'>();
export type GitCommit = z.infer<typeof gitCommitSchema>;

// A sha256 over normalized content (files, pages, glossaries, scoped snapshots).
export const contentHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<'ContentHash'>();
export type ContentHash = z.infer<typeof contentHashSchema>;

// A typed-fingerprint print emitted by a language pack (signature/value/body facet hash).
export const fingerprintPrintSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<'FingerprintPrint'>();
export type FingerprintPrint = z.infer<typeof fingerprintPrintSchema>;

// A content-derived revision of a docs entity (page/section/block) — NOT a git commit.
export const entityRevisionSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<'EntityRevision'>();
export type EntityRevision = z.infer<typeof entityRevisionSchema>;

// The codemap symbol identity key: `<lang>:<sha256>` over kind + containerPath + normalized
// declaration. The grounding key for claims and fingerprint subscriptions.
export const symbolSourceKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*:[0-9a-f]{64}$/)
  .brand<'SymbolSourceKey'>();
export type SymbolSourceKey = z.infer<typeof symbolSourceKeySchema>;

export const severitySchema = z.enum(['info', 'warning', 'error']);
export type Severity = z.infer<typeof severitySchema>;

// Inclusive 1-based line range within a file.
export const lineSpanSchema = z
  .tuple([z.number().int().positive(), z.number().int().positive()])
  .refine(([start, end]) => end >= start, { message: 'span end must be >= start' });
export type LineSpan = z.infer<typeof lineSpanSchema>;
