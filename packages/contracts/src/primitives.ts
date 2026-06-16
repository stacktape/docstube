import { z } from 'zod';

// Lowercase kebab-case identifier shared by page IDs, section IDs, and slugs.
// Concrete page/section ID rules layer on top of this primitive in later tasks.
export const identifierSchema = z
  .string()
  .min(1, { error: 'identifier must not be empty' })
  .max(128, { error: 'identifier must be at most 128 characters' })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'identifier must be lowercase kebab-case' });

export type Identifier = z.infer<typeof identifierSchema>;

// Repo-relative POSIX path. No leading slash, no backslashes, no `..` traversal, no NUL bytes.
export const relativePathSchema = z
  .string()
  .min(1, { error: 'path must not be empty' })
  .refine((value) => !value.startsWith('/'), { error: 'path must be repo-relative, not absolute' })
  .refine((value) => !/^[a-zA-Z]:/.test(value), { error: 'path must be repo-relative, not absolute' })
  .refine((value) => !value.includes('\\'), { error: 'path must use POSIX separators' })
  .refine((value) => !value.split('/').includes('..'), { error: 'path must not contain `..` traversal' })
  .refine((value) => !value.includes('\0'), { error: 'path must not contain NUL bytes' });

export type RelativePath = z.infer<typeof relativePathSchema>;

// Finding severity taxonomy. Derived quality scores live separately from finding severity.
export const severities = ['blocker', 'major', 'minor'] as const;

export const severitySchema = z.enum(severities);

export type Severity = z.infer<typeof severitySchema>;

// ISO 8601 timestamp, UTC `Z` or an explicit offset.
export const timestampSchema = z.iso.datetime({ offset: true });

export type Timestamp = z.infer<typeof timestampSchema>;

// Recursive JSON value. Used by contracts that carry opaque structured payloads.
export const jsonValueSchema = z.json();

export type JsonValue = z.infer<typeof jsonValueSchema>;

// Semantic version per the semver.org reference grammar.
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const semverSchema = z.string().regex(semverPattern, { error: 'must be a valid semantic version' });

export type Semver = z.infer<typeof semverSchema>;

// npm package name: optionally scoped, lowercase, URL-safe.
const packageNamePattern = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export const packageNameSchema = z
  .string()
  .min(1, { error: 'package name must not be empty' })
  .max(214, { error: 'package name must be at most 214 characters' })
  .regex(packageNamePattern, { error: 'must be a valid npm package name' });

export type PackageName = z.infer<typeof packageNameSchema>;

// Minimal package version metadata shared across config, manifest, and adapter contracts.
export const packageVersionSchema = z.object({
  name: packageNameSchema,
  version: semverSchema
});

export type PackageVersion = z.infer<typeof packageVersionSchema>;
