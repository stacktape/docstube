import { createHash } from 'node:crypto';
import { z } from 'zod';
import { semverSchema } from './primitives';

// Cache-key derivation for agent steps.
//
// PLAN.md: cache every agent step by prompt hash, input file hashes, model id, adapter id, and
// adapter version. The derived key is the SHA-256 of a canonical serialization of those fields.
// Input file hashes are sorted before serialization so the key is independent of read order;
// every other field is serialized in a fixed key order. The same inputs always produce the same
// key, and any change to a field changes the key.

// Lowercase hex SHA-256 digest, shared by cache keys and manifest provenance hashes.
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, { error: 'must be a lowercase hex SHA-256 digest' });

export type Sha256 = z.infer<typeof sha256Schema>;

// The exact fields that contribute to a cache key, in canonical order.
export const cacheKeyFields = ['adapterId', 'adapterVersion', 'inputHashes', 'model', 'promptHash'] as const;

export const cacheKeyInputSchema = z.strictObject({
  promptHash: sha256Schema,
  inputHashes: z.array(sha256Schema),
  model: z.string().min(1, { error: 'model id must not be empty' }),
  adapterId: z.string().min(1, { error: 'adapter id must not be empty' }),
  adapterVersion: semverSchema
});

export type CacheKeyInput = z.infer<typeof cacheKeyInputSchema>;

// Canonical serialization: fixed key order, sorted input hashes, no incidental whitespace.
const canonicalize = (input: CacheKeyInput): string =>
  JSON.stringify({
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    inputHashes: input.inputHashes.toSorted(),
    model: input.model,
    promptHash: input.promptHash
  });

export const deriveCacheKey = (input: CacheKeyInput): string => {
  const parsed = cacheKeyInputSchema.parse(input);
  return createHash('sha256').update(canonicalize(parsed)).digest('hex');
};
