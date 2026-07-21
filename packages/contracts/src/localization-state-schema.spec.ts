import { describe, expect, it } from 'vitest';
import {
  localizationPlanSchema,
  localizationRenditionSchema,
  localizationRouteRecordSchema,
  localizationSchedulerRecordSchema,
  localizationSchedulerStateSchema,
  routeResolutionSchema,
  terminologyEntrySchema,
  translationMemoryUnitKeySchema
} from './localization-state-schema.ts';

const hash = 'a'.repeat(64);
const pageId = 'pg_00000000000000000000';
const now = '2026-07-12T00:00:00.000Z';

describe('localization scheduler', () => {
  it('accepts the five scheduler states and rejects others', () => {
    for (const state of ['absent', 'pending', 'ready', 'stale', 'failed']) {
      expect(localizationSchedulerStateSchema.safeParse(state).success).toBe(true);
    }
    expect(localizationSchedulerStateSchema.safeParse('translated').success).toBe(false);
    // Route vocabulary is a different axis and must not leak into scheduler state.
    expect(localizationSchedulerStateSchema.safeParse('source-fallback').success).toBe(false);
  });

  it('canonicalizes the version key — an omitted version parses to the explicit latest label', () => {
    const omitted = localizationSchedulerRecordSchema.parse({ schemaVersion: 1, locale: 'de', pageId, state: 'ready' });
    expect(omitted.version).toBe('latest');
    const explicit = localizationSchedulerRecordSchema.parse({
      schemaVersion: 1,
      version: 'latest',
      locale: 'de',
      pageId,
      state: 'ready'
    });
    // One encoding: both inputs produce the identical canonical key.
    expect(explicit).toEqual(omitted);
    const rendition = localizationRenditionSchema.parse({
      schemaVersion: 1,
      locale: 'de',
      pageId,
      rendition: 'candidate',
      sourceContentRevision: hash
    });
    expect(rendition.version).toBe('latest');
    const route = localizationRouteRecordSchema.parse({ schemaVersion: 1, locale: 'de', pageId, resolution: 'ready' });
    expect(route.version).toBe('latest');
  });

  it('keys records by version, locale, and page with a retry basis for dead letters', () => {
    const result = localizationSchedulerRecordSchema.safeParse({
      schemaVersion: 1,
      locale: 'pt-BR',
      pageId,
      state: 'failed',
      deadLettered: true,
      retryBasis: { sourceContentRevision: hash, glossaryRevision: hash, policyVersion: 'v1', model: 'model-x' },
      updatedAt: now
    });
    expect(result.success).toBe(true);
    const versioned = localizationSchedulerRecordSchema.safeParse({
      schemaVersion: 1,
      version: '1.x',
      locale: 'de',
      pageId,
      state: 'ready'
    });
    expect(versioned.success).toBe(true);
    expect(versioned.data?.deadLettered).toBe(false);
  });

  it('rejects an unversioned scheduler record', () => {
    expect(localizationSchedulerRecordSchema.safeParse({ locale: 'de', pageId, state: 'ready' }).success).toBe(false);
  });

  it('rejects an incomplete retry basis — every retry input must be captured', () => {
    const result = localizationSchedulerRecordSchema.safeParse({
      schemaVersion: 1,
      locale: 'de',
      pageId,
      state: 'failed',
      deadLettered: true,
      retryBasis: { sourceContentRevision: hash }
    });
    expect(result.success).toBe(false);
  });

  it('permits dead-lettering only on failed records, and only with a retry basis', () => {
    const retryBasis = { sourceContentRevision: hash, glossaryRevision: hash, policyVersion: 'v1', model: 'model-x' };
    // A ready record cannot be dead-lettered.
    expect(
      localizationSchedulerRecordSchema.safeParse({
        schemaVersion: 1,
        locale: 'de',
        pageId,
        state: 'ready',
        deadLettered: true,
        retryBasis
      }).success
    ).toBe(false);
    // A dead letter without its retry basis cannot decide when to retry.
    expect(
      localizationSchedulerRecordSchema.safeParse({
        schemaVersion: 1,
        locale: 'de',
        pageId,
        state: 'failed',
        deadLettered: true
      }).success
    ).toBe(false);
    expect(
      localizationSchedulerRecordSchema.safeParse({
        schemaVersion: 1,
        locale: 'de',
        pageId,
        state: 'failed',
        deadLettered: true,
        retryBasis
      }).success
    ).toBe(true);
  });
});

describe('rendition artifacts and route resolution', () => {
  it('binds candidate/published renditions to a content-derived source revision', () => {
    const result = localizationRenditionSchema.safeParse({
      schemaVersion: 1,
      locale: 'de',
      pageId,
      rendition: 'candidate',
      sourceContentRevision: hash,
      translatedAt: now
    });
    expect(result.success).toBe(true);
    // A git commit is not a page-content revision.
    const gitSha = localizationRenditionSchema.safeParse({
      schemaVersion: 1,
      locale: 'de',
      pageId,
      rendition: 'published',
      sourceContentRevision: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
    });
    expect(gitSha.success).toBe(false);
    expect(
      localizationRenditionSchema.safeParse({
        schemaVersion: 1,
        locale: 'de',
        pageId,
        rendition: 'route-fallback',
        sourceContentRevision: hash
      }).success
    ).toBe(false);
  });

  it('resolves routes to ready/stale/source-fallback/unavailable', () => {
    for (const resolution of ['ready', 'stale', 'source-fallback', 'unavailable']) {
      expect(
        localizationRouteRecordSchema.safeParse({ schemaVersion: 1, locale: 'de', pageId, resolution }).success
      ).toBe(true);
    }
    expect(routeResolutionSchema.safeParse('candidate').success).toBe(false);
  });
});

describe('localization plan', () => {
  const unit = (unitId: string, order: number) => ({
    unitId,
    entityId: 'bl_00000000000000000000',
    sourceTextHash: hash,
    placeholders: ['{code:0}'],
    claimRefs: ['cl_00000000000000000000'],
    order
  });

  it('round-trips ordered units with owning entity, placeholders, and claim refs', () => {
    const result = localizationPlanSchema.safeParse({
      schemaVersion: 1,
      locale: 'de',
      pageId,
      sourceContentRevision: hash,
      units: [unit('u1', 0), unit('u2', 1)]
    });
    expect(result.success).toBe(true);
  });

  it('rejects duplicate unit ids — the kernel rejects duplicate units in a returned map', () => {
    const result = localizationPlanSchema.safeParse({
      schemaVersion: 1,
      locale: 'de',
      pageId,
      sourceContentRevision: hash,
      units: [unit('u1', 0), unit('u1', 1)]
    });
    expect(result.success).toBe(false);
  });
});

describe('terminology profile entries', () => {
  it('carries per-term policy with attributed origin — user entries win permanently', () => {
    const ai = terminologyEntrySchema.safeParse({
      term: 'docstube',
      locale: 'de',
      policy: 'keep-source',
      origin: 'ai'
    });
    expect(ai.success).toBe(true);
    const user = terminologyEntrySchema.safeParse({
      term: 'claim ledger',
      locale: 'de',
      policy: 'translate-to',
      translation: 'Aussagen-Register',
      origin: 'user'
    });
    expect(user.success).toBe(true);
  });

  it('rejects a translate-to entry without its target rendering and unknown origins', () => {
    expect(
      terminologyEntrySchema.safeParse({ term: 'claim', locale: 'de', policy: 'translate-to', origin: 'user' }).success
    ).toBe(false);
    expect(
      terminologyEntrySchema.safeParse({ term: 'claim', locale: 'de', policy: 'keep-source', origin: 'vendor' }).success
    ).toBe(false);
  });

  it('requires at least one forbidden variant on a forbidden entry', () => {
    expect(
      terminologyEntrySchema.safeParse({ term: 'docstube', locale: 'de', policy: 'forbidden', origin: 'user' }).success
    ).toBe(false);
    expect(
      terminologyEntrySchema.safeParse({
        term: 'docstube',
        locale: 'de',
        policy: 'forbidden',
        forbiddenVariants: [],
        origin: 'user'
      }).success
    ).toBe(false);
    expect(
      terminologyEntrySchema.safeParse({
        term: 'docstube',
        locale: 'de',
        policy: 'forbidden',
        forbiddenVariants: ['DocsTube', 'Docstube-Programm'],
        origin: 'user'
      }).success
    ).toBe(true);
  });
});

describe('translation memory unit keys', () => {
  it('is keyed by the source+target locale pair with placeholder shape and glossary revisions', () => {
    const result = translationMemoryUnitKeySchema.safeParse({
      sourceTextHash: hash,
      sourceLocale: 'en',
      targetLocale: 'de',
      placeholderShape: ['{code:0}', '{link:1}'],
      glossaryRevisions: { docstube: hash },
      policyVersion: 'v1'
    });
    expect(result.success).toBe(true);
    // One locale is not a pair.
    expect(
      translationMemoryUnitKeySchema.safeParse({ sourceTextHash: hash, locale: 'de', policyVersion: 'v1' }).success
    ).toBe(false);
  });

  it('rejects a key without a policy version — policy changes must invalidate memory', () => {
    const result = translationMemoryUnitKeySchema.safeParse({
      sourceTextHash: hash,
      sourceLocale: 'en',
      targetLocale: 'de'
    });
    expect(result.success).toBe(false);
  });
});
