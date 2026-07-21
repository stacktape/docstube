import { describe, expect, it } from 'vitest';
import {
  localizationPageStateSchema,
  localizationStateSchema,
  translationMemoryUnitKeySchema
} from './localization-state-schema.ts';

const hash = 'a'.repeat(64);
const pageId = 'pg_00000000000000000000';

describe('localization scheduler states', () => {
  it('accepts the five scheduler states and rejects others', () => {
    for (const state of ['absent', 'pending', 'ready', 'stale', 'failed']) {
      expect(localizationStateSchema.safeParse(state).success).toBe(true);
    }
    expect(localizationStateSchema.safeParse('translated').success).toBe(false);
  });

  it('round-trips a ready rendition with its publication state and source revision', () => {
    const result = localizationPageStateSchema.safeParse({
      locale: 'pt-BR',
      pageId,
      state: 'ready',
      translatedFromRevision: 'a1b2c3d',
      publication: 'published',
      updatedAt: '2026-07-12T00:00:00.000Z'
    });
    expect(result.success).toBe(true);
    expect(result.data?.deadLettered).toBe(false);
  });

  it('rejects publication states outside candidate/published/route-fallback', () => {
    const result = localizationPageStateSchema.safeParse({
      locale: 'de',
      pageId,
      state: 'failed',
      publication: 'live'
    });
    expect(result.success).toBe(false);
  });
});

describe('translation memory unit keys', () => {
  it('round-trips a key with placeholder shape and glossary revisions', () => {
    const result = translationMemoryUnitKeySchema.safeParse({
      sourceTextHash: hash,
      locale: 'de',
      placeholderShape: ['{code:0}', '{link:1}'],
      glossaryRevisions: { docstube: hash },
      policyVersion: 'v1'
    });
    expect(result.success).toBe(true);
  });

  it('rejects a key without a policy version — policy changes must invalidate memory', () => {
    const result = translationMemoryUnitKeySchema.safeParse({ sourceTextHash: hash, locale: 'de' });
    expect(result.success).toBe(false);
  });
});
