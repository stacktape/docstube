import { createHash } from 'node:crypto';

export const sha256Hex = (input: string | Uint8Array): string => createHash('sha256').update(input).digest('hex');

// Deterministic JSON: object keys sorted recursively, no whitespace. Used for cache keys and
// content hashes so semantically-equal inputs hash identically regardless of construction order.
const normalizeForJson = (input: unknown): unknown => {
  if (Array.isArray(input)) {
    return input.map(normalizeForJson);
  }
  if (input !== null && typeof input === 'object') {
    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, normalizeForJson(entryValue)]));
  }
  return input;
};

export const canonicalJson = (value: unknown): string => JSON.stringify(normalizeForJson(value));

export const hashValue = (value: unknown): string => sha256Hex(canonicalJson(value));

// Content hash for text artifacts (MDX blocks, read files). Line endings are normalized so the
// same content hashes identically across platforms.
export const contentHash = (text: string): string => sha256Hex(text.replaceAll('\r\n', '\n'));
