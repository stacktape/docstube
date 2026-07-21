import { z } from 'zod';
import { claimClassTokenSchema, evidenceKindSchema } from './claim-ledger-schema.ts';

// AssuranceProfile (quality-ci-reader-v2 decisions 1 and 3): the versioned per-project declaration
// of what the assurance claim actually covers. It is DESCRIPTIVE ONLY — it declares which
// languages, claim classes, and evidence kinds/capabilities were present, and never configures
// them: the class/evidence authority table, ledger completeness, and publication policy are
// kernel-owned constants (the configurable policy engine is explicitly v2, PRODUCT §3.3).

export const supportLevelSchema = z.enum(['supported', 'preview', 'unavailable']);
export type SupportLevel = z.infer<typeof supportLevelSchema>;

// Generated from the actual registries (language packs, verifiers, transports…) and consumed by
// the website, wizard, doctor, and Action validation: category → capability id → level.
export const supportMatrixSchema = z.object({
  schemaVersion: z.literal(1),
  categories: z.record(z.string().min(1), z.record(z.string().min(1), supportLevelSchema)).default({})
});
export type SupportMatrix = z.infer<typeof supportMatrixSchema>;

export const assuranceProfileSchema = z.object({
  schemaVersion: z.literal(1),
  // The domain revision of the profile CONTENT (bumps when coverage genuinely changes);
  // schemaVersion above is the serialization-format version.
  profileVersion: z.number().int().positive(),
  // Languages actually covered by installed language packs.
  languages: z.array(z.string().min(1)).default([]),
  // Claim classes a registered verifier can decide in this project.
  claimClasses: z.array(claimClassTokenSchema).default([]),
  // Evidence kinds the installed verifier set can produce.
  evidenceKinds: z.array(evidenceKindSchema).default([]),
  // Environment capabilities that were present (runtimes, package managers…) — recorded so
  // execution evidence is interpretable, never a requirements knob.
  capabilities: z.array(z.string().min(1)).default([])
});
export type AssuranceProfile = z.infer<typeof assuranceProfileSchema>;
