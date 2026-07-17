import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash, hashValue } from './hashing.ts';
import { idPrefixes, localeCodeSchema, mintId, pageIdSchema, repoPathSchema } from './primitives.ts';

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

describe('hashing', () => {
  it('canonicalJson is key-order independent and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: 2, c: undefined })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(hashValue({ b: 1, a: 2 })).toBe(hashValue({ a: 2, b: 1 }));
  });

  it('contentHash normalizes line endings', () => {
    expect(contentHash('a\r\nb')).toBe(contentHash('a\nb'));
  });
});
