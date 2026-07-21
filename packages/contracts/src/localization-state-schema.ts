import { z } from 'zod';
import { gitShaSchema, isoTimestampSchema, localeCodeSchema, pageIdSchema, sha256HexSchema } from './primitives.ts';

// Localization scheduler state (i18n-lifecycle-v2 target architecture): desired vs published is
// reconciled per locale × page; every source-mutating command drives these states. Publication is
// a separate dimension — emit consumes explicit route resolution, never infers from file presence.

export const localizationStateSchema = z.enum(['absent', 'pending', 'ready', 'stale', 'failed']);
export type LocalizationState = z.infer<typeof localizationStateSchema>;

export const localizationPublicationStateSchema = z.enum(['candidate', 'published', 'route-fallback']);
export type LocalizationPublicationState = z.infer<typeof localizationPublicationStateSchema>;

export const localizationPageStateSchema = z.object({
  locale: localeCodeSchema,
  pageId: pageIdSchema,
  state: localizationStateSchema,
  // Source revision the current rendition was translated from ('stale' = source moved past it).
  translatedFromRevision: gitShaSchema.optional(),
  publication: localizationPublicationStateSchema.optional(),
  // Persistent failures dead-letter: retried only when content/glossary/policy/model changes.
  deadLettered: z.boolean().default(false),
  updatedAt: isoTimestampSchema.optional()
});
export type LocalizationPageState = z.infer<typeof localizationPageStateSchema>;

// Translation-memory unit key: unchanged units never retranslate. The key captures everything a
// cached translation depends on — source text, locale, placeholder inventory, the glossary
// entries in scope, and the translation policy version.
export const translationMemoryUnitKeySchema = z.object({
  sourceTextHash: sha256HexSchema,
  locale: localeCodeSchema,
  // Ordered placeholder tokens the unit contains (identifiers, links, component slots) — a
  // placeholder-shape change invalidates the memory even when visible text is unchanged.
  placeholderShape: z.array(z.string().min(1)).default([]),
  // Relevant glossary term → revision hash at translation time.
  glossaryRevisions: z.record(z.string().min(1), sha256HexSchema).default({}),
  policyVersion: z.string().min(1)
});
export type TranslationMemoryUnitKey = z.infer<typeof translationMemoryUnitKeySchema>;
