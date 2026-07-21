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

// Canonical serialization for MACHINE-OWNED committed state (harness-state-v2 decision 12):
// sorted-key compact JSON + trailing newline, LF-only. Callers serialize the PARSED schema output
// (defaults materialized — the 'latest'-default rule), so semantically-unchanged content is
// byte-stable and git diffs stay minimal. Human-owned files stay YAML and never use this.
export const canonicalStateJson = (value: unknown): string => `${canonicalJson(value)}\n`;
