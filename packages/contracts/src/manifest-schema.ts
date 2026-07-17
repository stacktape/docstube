import { z } from 'zod';
import { pageEntitySchema } from './entity-schema.ts';
import { flagSchema } from './flag-schema.ts';
import {
  isoTimestampSchema,
  localeCodeSchema,
  pageIdSchema,
  repoPathSchema,
  semverSchema,
  sha256HexSchema,
  versionLabelSchema
} from './primitives.ts';

// The committed manifest is the lockfile of the docs (PRODUCT §3.10): derived state committed for
// determinism and branch-correctness. Sharded one-file-per-page-per-locale so parallel PRs never
// conflict; `manifest.yml` holds only slow-moving index data. All writes are deterministic
// (stable key order) so diffs are honest.

export const manifestPageIndexEntrySchema = z.object({
  id: pageIdSchema,
  slug: z.string().min(1),
  title: z.string().min(1),
  // Path of the generated MDX relative to the site content root, for the source locale.
  path: repoPathSchema
});

export const manifestVersionSchema = z.object({
  label: versionLabelSchema,
  // `current` is live from HEAD; `frozen` snapshots were cut at release time (model C).
  status: z.enum(['current', 'frozen']),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/)
    .optional(),
  cutAt: isoTimestampSchema.optional()
});

export const coverageStatsSchema = z.object({
  publicSymbols: z.number().int().nonnegative(),
  documentedSymbols: z.number().int().nonnegative()
});

export const manifestIndexSchema = z.object({
  schemaVersion: z.literal(1),
  docstubeVersion: semverSchema,
  sourceLocale: localeCodeSchema,
  locales: z.array(localeCodeSchema),
  versions: z.array(manifestVersionSchema).min(1),
  pages: z.array(manifestPageIndexEntrySchema),
  // Content hashes of the intent files the docs were generated from.
  configHash: sha256HexSchema,
  iaHash: sha256HexSchema,
  // Doc-type-conditional (on for libraries/SDKs, off for apps/services).
  coverage: coverageStatsSchema.optional(),
  // Cross-page and system-level flags; entity-scoped flags live in page shards.
  systemFlags: z.array(flagSchema).default([])
});
export type ManifestIndex = z.infer<typeof manifestIndexSchema>;

// One shard = one page in one locale: `.docstube/manifest/pages/<locale>/<pageId>.yml`
// (frozen versions under `.docstube/manifest/versions/<version>/pages/…`).
export const pageShardSchema = z.object({
  schemaVersion: z.literal(1),
  locale: localeCodeSchema,
  version: versionLabelSchema,
  sourceCommit: z.string().regex(/^[0-9a-f]{7,64}$/),
  generatedAt: isoTimestampSchema,
  page: pageEntitySchema,
  flags: z.array(flagSchema).default([]),
  // Reserved for the signed-provenance contract (PRODUCT §4.2); unsigned in v1.
  signature: z.string().optional()
});
export type PageShard = z.infer<typeof pageShardSchema>;

export const pageShardRelativePath = (input: {
  locale: string;
  pageId: string;
  version?: string | undefined;
  currentVersion: string;
}): string => {
  const base =
    input.version !== undefined && input.version !== input.currentVersion ? `versions/${input.version}/pages` : 'pages';
  return `${base}/${input.locale}/${input.pageId}.yml`;
};
