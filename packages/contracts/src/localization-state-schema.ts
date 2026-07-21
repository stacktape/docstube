import { z } from 'zod';
import {
  blockIdSchema,
  claimIdSchema,
  contentHashSchema,
  isoTimestampSchema,
  localeCodeSchema,
  pageIdSchema,
  sectionIdSchema,
  versionLabelSchema
} from './primitives.ts';

// Localization contracts (i18n-lifecycle-v2 target architecture). Three separate axes that must
// never collapse into one field: (a) SCHEDULER state — desired vs published reconciliation per
// {version, locale, page}; (b) ARTIFACT references — candidate and published renditions bound to
// a content-derived source revision; (c) ROUTE resolution — what the emitter serves. The version
// dimension is REQUIRED and defaults to the explicit 'latest' label: one canonical encoding, no
// omitted-vs-'latest' ambiguity (0.1.0 documents `latest` only; v1.x versioning adds labels).

export const localizationSchedulerStateSchema = z.enum(['absent', 'pending', 'ready', 'stale', 'failed']);
export type LocalizationSchedulerState = z.infer<typeof localizationSchedulerStateSchema>;

// Everything a dead-lettered page-locale's retry decision depends on: retry happens only when at
// least one component changes (content, glossary, policy, model) or on explicit request.
export const retryBasisSchema = z.object({
  sourceContentRevision: contentHashSchema,
  glossaryRevision: contentHashSchema,
  policyVersion: z.string().min(1),
  model: z.string().min(1)
});
export type RetryBasis = z.infer<typeof retryBasisSchema>;

export const localizationSchedulerRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: versionLabelSchema.default('latest'),
    locale: localeCodeSchema,
    pageId: pageIdSchema,
    state: localizationSchedulerStateSchema,
    // Persistent failures dead-letter; the recorded basis decides when a retry is warranted.
    deadLettered: z.boolean().default(false),
    retryBasis: retryBasisSchema.optional(),
    updatedAt: isoTimestampSchema.optional()
  })
  .superRefine((record, ctx) => {
    if (!record.deadLettered) {
      return;
    }
    // Dead-lettering is a terminal failure refinement — a ready/pending record cannot be one.
    if (record.state !== 'failed') {
      ctx.addIssue({
        code: 'custom',
        path: ['deadLettered'],
        message: "only a 'failed' page-locale can be dead-lettered"
      });
    }
    if (record.retryBasis === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['retryBasis'],
        message: 'a dead-lettered record must capture the retry basis that decides when to retry'
      });
    }
  });
export type LocalizationSchedulerRecord = z.infer<typeof localizationSchedulerRecordSchema>;

// A candidate or published rendition artifact reference. `sourceContentRevision` is the
// content-derived revision of the canonical source page the rendition was translated from —
// never a git commit ('stale' = the source page content moved past it).
export const localizationRenditionSchema = z.object({
  schemaVersion: z.literal(1),
  version: versionLabelSchema.default('latest'),
  locale: localeCodeSchema,
  pageId: pageIdSchema,
  rendition: z.enum(['candidate', 'published']),
  sourceContentRevision: contentHashSchema,
  translatedAt: isoTimestampSchema.optional()
});
export type LocalizationRendition = z.infer<typeof localizationRenditionSchema>;

// Route resolution per {version, locale, page} — what the emitter serves, with reader-visible
// explanations. Emit consumes this explicitly, never infers from file presence.
export const routeResolutionSchema = z.enum(['ready', 'stale', 'source-fallback', 'unavailable']);
export type RouteResolution = z.infer<typeof routeResolutionSchema>;

export const localizationRouteRecordSchema = z.object({
  schemaVersion: z.literal(1),
  version: versionLabelSchema.default('latest'),
  locale: localeCodeSchema,
  pageId: pageIdSchema,
  resolution: routeResolutionSchema
});
export type LocalizationRouteRecord = z.infer<typeof localizationRouteRecordSchema>;

// One ordered translatable unit from the canonical parse (ARCHITECTURE §11.1): what enters model
// output. Code, links, identifiers, and component structure never do.
export const translatableUnitSchema = z.object({
  unitId: z.string().min(1),
  // The owning docs entity the unit belongs to.
  entityId: z.union([pageIdSchema, sectionIdSchema, blockIdSchema]),
  sourceTextHash: contentHashSchema,
  // Ordered placeholder tokens the unit contains (identifiers, links, component slots) — the
  // kernel rejects returned units whose placeholder shape changed.
  placeholders: z.array(z.string().min(1)).default([]),
  claimRefs: z.array(claimIdSchema).default([]),
  // Position in the canonical document order.
  order: z.number().int().nonnegative()
});
export type TranslatableUnit = z.infer<typeof translatableUnitSchema>;

export const localizationPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: versionLabelSchema.default('latest'),
    locale: localeCodeSchema,
    pageId: pageIdSchema,
    sourceContentRevision: contentHashSchema,
    units: z.array(translatableUnitSchema).default([])
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    for (const unit of plan.units) {
      if (seen.has(unit.unitId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['units'],
          message: `duplicate unitId "${unit.unitId}" — the kernel rejects duplicate units in a returned map`
        });
      }
      seen.add(unit.unitId);
    }
  });
export type LocalizationPlan = z.infer<typeof localizationPlanSchema>;

// Per-term terminology policy (i18n-lifecycle-v2 decision 7): translate-to a chosen rendering,
// keep the source term, or forbid known-bad variants. Entries carry origin so precedence is
// enforceable: user-authored entries win over ai-authored ones PERMANENTLY — a terminology
// bootstrap or refresh must never overwrite an origin:user entry.
export const terminologyPolicySchema = z.enum(['translate-to', 'keep-source', 'forbidden']);

export const terminologyEntrySchema = z
  .object({
    term: z.string().min(1),
    locale: localeCodeSchema,
    policy: terminologyPolicySchema,
    // Required for translate-to; the forbidden variants for 'forbidden'.
    translation: z.string().min(1).optional(),
    forbiddenVariants: z.array(z.string().min(1)).optional(),
    origin: z.enum(['ai', 'user'])
  })
  .superRefine((entry, ctx) => {
    if (entry.policy === 'translate-to' && entry.translation === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['translation'],
        message: "a 'translate-to' entry must name the target rendering"
      });
    }
    if (
      entry.policy === 'forbidden' &&
      (entry.forbiddenVariants === undefined || entry.forbiddenVariants.length === 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['forbiddenVariants'],
        message: "a 'forbidden' entry must list at least one forbidden variant"
      });
    }
  });
export type TerminologyEntry = z.infer<typeof terminologyEntrySchema>;

export const terminologyProfileSchema = z.object({
  schemaVersion: z.literal(1),
  locale: localeCodeSchema,
  entries: z.array(terminologyEntrySchema).default([])
});
export type TerminologyProfile = z.infer<typeof terminologyProfileSchema>;

// Translation-memory unit key: unchanged units never retranslate. Keyed by the source+target
// locale PAIR — the same English unit translated into de and into pt-BR are different memories.
export const translationMemoryUnitKeySchema = z.object({
  sourceTextHash: contentHashSchema,
  sourceLocale: localeCodeSchema,
  targetLocale: localeCodeSchema,
  // Ordered placeholder tokens the unit contains — a placeholder-shape change invalidates the
  // memory even when visible text is unchanged.
  placeholderShape: z.array(z.string().min(1)).default([]),
  // Relevant glossary term → revision hash at translation time.
  glossaryRevisions: z.record(z.string().min(1), contentHashSchema).default({}),
  policyVersion: z.string().min(1)
});
export type TranslationMemoryUnitKey = z.infer<typeof translationMemoryUnitKeySchema>;
