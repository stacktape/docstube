import { z } from 'zod';
import { semverSchema } from './primitives.ts';

// Every plugin declares what it is and what it needs up front (npm-style trust posture,
// PRODUCT §3.4). Declarations are shown to the user at first run and cross-checked against what
// the plugin actually registers; v1 enforcement is honest-but-soft (ARCHITECTURE.md §6.3).

export const pluginApiVersion = 1;

export const pluginPermissionsSchema = z.object({
  network: z.boolean().default(false),
  // Executables the plugin may spawn ("shellcheck", "pyright"). Empty = none.
  exec: z.array(z.string().min(1)).default([]),
  // Repo-relative roots the plugin may write into via host-provided FS handles. Empty = read-only.
  writableRoots: z.array(z.string().min(1)).default([])
});
export type PluginPermissions = z.infer<typeof pluginPermissionsSchema>;

export const pluginCapabilityKindSchema = z.enum([
  'verifier',
  'language-pack',
  'content-source',
  'importer',
  'deploy-target',
  'search-provider',
  'component'
]);
export type PluginCapabilityKind = z.infer<typeof pluginCapabilityKindSchema>;

export const pluginCapabilityDeclarationSchema = z.object({
  kind: pluginCapabilityKindSchema,
  // Ids the plugin intends to register under this kind (verifier ids, component names, …).
  ids: z.array(z.string().min(1)).min(1)
});

export const pluginManifestSchema = z.object({
  apiVersion: z.literal(pluginApiVersion),
  // npm convention: "docstube-plugin-<x>" for shared plugins; local plugins may use any name.
  name: z.string().regex(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/),
  version: semverSchema,
  description: z.string().optional(),
  permissions: pluginPermissionsSchema.default({ network: false, exec: [], writableRoots: [] }),
  capabilities: z.array(pluginCapabilityDeclarationSchema).min(1)
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
