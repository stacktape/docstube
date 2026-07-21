import { z } from 'zod';
import { claimClassV2Schema, evidenceKindSchema } from './claim-ledger-schema.ts';
import { repoPathSchema } from './primitives.ts';

// AssuranceProfile (quality-ci-reader-v2 decisions 1 and 3): the versioned per-project declaration
// of what the assurance claim actually covers. In-product honesty mechanism — assurance claims are
// scoped to supported surfaces; preview features are explicitly outside them.

export const supportLevelSchema = z.enum(['supported', 'preview', 'unavailable']);
export type SupportLevel = z.infer<typeof supportLevelSchema>;

// Generated from the actual registries (language packs, verifiers, transports…) and consumed by
// the website, wizard, doctor, and Action validation: category → capability id → level.
export const supportMatrixSchema = z.record(z.string().min(1), z.record(z.string().min(1), supportLevelSchema));
export type SupportMatrix = z.infer<typeof supportMatrixSchema>;

// What content in a given disposition is allowed to do at publish time.
export const publicationRuleSchema = z.enum(['publish', 'publish-labeled', 'block']);

export const claimClassPolicySchema = z.object({
  class: claimClassV2Schema,
  acceptedEvidence: z.array(evidenceKindSchema).min(1)
});

export const assuranceProfileSchema = z.object({
  profileVersion: z.number().int().positive(),
  languages: z.array(z.string().min(1)).default([]),
  sourceProviders: z.array(z.string().min(1)).default([]),
  repoRoots: z.array(repoPathSchema).default([]),
  artifactTypes: z.array(z.string().min(1)).default([]),
  claimClasses: z.array(claimClassPolicySchema).default([]),
  // Environment capabilities execution evidence depends on (runtimes, package managers…).
  requiredEnvironmentCapabilities: z.array(z.string().min(1)).default([]),
  ledgerCompleteness: z
    .object({
      // Inline <Claim> anchors must validate at submit time.
      requireInlineAnchors: z.boolean().default(true),
      // Coverage-linter budget: assertion-shaped spans allowed to remain unclaimed per page.
      maxUncoveredAssertionSpans: z.number().int().nonnegative().default(0)
    })
    .prefault({}),
  publication: z
    .object({
      unchecked: publicationRuleSchema.default('publish-labeled'),
      ownerAttested: publicationRuleSchema.default('publish'),
      contradicted: publicationRuleSchema.default('block')
    })
    .prefault({})
});
export type AssuranceProfile = z.infer<typeof assuranceProfileSchema>;
