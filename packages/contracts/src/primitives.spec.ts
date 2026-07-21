import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash, hashValue } from './hashing.ts';
import {
  contentHashSchema,
  entityRevisionSchema,
  entityThreadIdSchema,
  gitCommitSchema,
  gitShaSchema,
  idPrefixes,
  localeCodeSchema,
  mintId,
  pageIdSchema,
  repoPathSchema,
  symbolSourceKeySchema
} from './primitives.ts';

describe('id minting', () => {
  it('mints ids that validate against their own schema', () => {
    const id = mintId(idPrefixes.page);
    expect(pageIdSchema.safeParse(id).success).toBe(true);
  });

  it('mints unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => mintId(idPrefixes.block)));
    expect(ids.size).toBe(1000);
  });
});

describe('repo paths', () => {
  it('rejects absolute and Windows-style paths', () => {
    expect(repoPathSchema.safeParse('src/cli.ts').success).toBe(true);
    expect(repoPathSchema.safeParse('/etc/passwd').success).toBe(false);
    expect(repoPathSchema.safeParse('C:/Projects/x.ts').success).toBe(false);
    expect(repoPathSchema.safeParse('src\\cli.ts').success).toBe(false);
  });

  it('rejects traversal and self-referencing segments but keeps "." as the repo root', () => {
    expect(repoPathSchema.safeParse('.').success).toBe(true);
    for (const path of ['../x', 'src/../../y', './..', '..', './src/cli.ts', 'src//cli.ts', 'src/']) {
      expect(repoPathSchema.safeParse(path).success).toBe(false);
    }
  });
});

describe('locale codes', () => {
  it('accepts language, script, and region subtags', () => {
    for (const locale of ['en', 'de', 'pt-BR', 'zh-Hans', 'zh-Hant', 'zh-Hans-CN', 'sr-Latn-RS']) {
      expect(localeCodeSchema.safeParse(locale).success).toBe(true);
    }
  });

  it('rejects malformed locale codes', () => {
    for (const locale of ['EN', 'pt-br', 'zh-hans', 'zh-Hans-cn', 'english', 'en_US', '']) {
      expect(localeCodeSchema.safeParse(locale).success).toBe(false);
    }
  });
});

describe('git object ids', () => {
  it('accepts abbreviated SHA-1 (7..40 hex) and full SHA-256 (64 hex)', () => {
    for (const schema of [gitShaSchema, gitCommitSchema]) {
      expect(schema.safeParse('a1b2c3d').success).toBe(true);
      expect(schema.safeParse('a'.repeat(40)).success).toBe(true);
      expect(schema.safeParse('a'.repeat(64)).success).toBe(true);
    }
  });

  it('rejects impossible lengths — 41..63 hex chars are no git object id', () => {
    for (const schema of [gitShaSchema, gitCommitSchema]) {
      expect(schema.safeParse('a'.repeat(41)).success).toBe(false);
      expect(schema.safeParse('a'.repeat(63)).success).toBe(false);
      expect(schema.safeParse('a'.repeat(6)).success).toBe(false);
      expect(schema.safeParse('a'.repeat(65)).success).toBe(false);
      expect(schema.safeParse('G'.repeat(40)).success).toBe(false);
    }
  });
});

describe('distinct content-derived primitives', () => {
  it('keeps content hashes and entity revisions sha256-shaped', () => {
    for (const schema of [contentHashSchema, entityRevisionSchema]) {
      expect(schema.safeParse('a'.repeat(64)).success).toBe(true);
      expect(schema.safeParse('a'.repeat(40)).success).toBe(false);
    }
  });

  it('keeps the symbol source key namespaced — a bare sha is not a symbol key', () => {
    expect(symbolSourceKeySchema.safeParse(`ts:${'a'.repeat(64)}`).success).toBe(true);
    expect(symbolSourceKeySchema.safeParse('a'.repeat(64)).success).toBe(false);
  });

  it('mints entity-thread ids distinct from entity addresses', () => {
    const threadId = mintId(idPrefixes.entityThread);
    expect(entityThreadIdSchema.safeParse(threadId).success).toBe(true);
    expect(pageIdSchema.safeParse(threadId).success).toBe(false);
    expect(entityThreadIdSchema.safeParse(mintId(idPrefixes.page)).success).toBe(false);
  });
});

describe('hashing', () => {
  it('canonicalJson is key-order independent and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: 2, c: undefined })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(hashValue({ b: 1, a: 2 })).toBe(hashValue({ a: 2, b: 1 }));
  });

  it('contentHash normalizes line endings', () => {
    expect(contentHash('a\r\nb')).toBe(contentHash('a\nb'));
  });
});
