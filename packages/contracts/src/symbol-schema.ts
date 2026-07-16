import { z } from 'zod';
import { lineSpanSchema, repoPathSchema, sourceKeySchema } from './primitives.ts';

// A codemap symbol. Identity is `hash` — derived from kind + container path + normalized
// declaration content, never from the identifier name (PRODUCT §3.2). `name` exists for display
// and citation links only; a rename produces a new hash (remove + add), which is intended: the
// dependent entities must regenerate.
export const symbolKindSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
export const knownSymbolKinds = [
  'function',
  'class',
  'method',
  'property',
  'type',
  'interface',
  'enum',
  'variable',
  'module',
  'endpoint',
  'schema',
  'cli-command',
  'cli-flag',
  'env-var'
] as const;

export const symbolRecordSchema = z.object({
  hash: sourceKeySchema,
  lang: z.string().regex(/^[a-z][a-z0-9-]*$/),
  kind: symbolKindSchema,
  name: z.string().min(1),
  containerPath: z.array(z.string()).default([]),
  file: repoPathSchema,
  span: lineSpanSchema,
  visibility: z.enum(['public', 'internal', 'private']).default('public'),
  // Normalized signature/declaration text the hash was computed over (debugging + citations).
  signature: z.string().optional(),
  // Multi-project (monorepo) dimension; single-project repos use the default.
  project: z.string().default('.')
});
export type SymbolRecord = z.infer<typeof symbolRecordSchema>;

export const codemapSchema = z.object({
  schemaVersion: z.literal(1),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/),
  symbols: z.array(symbolRecordSchema),
  // Declared-partial-coverage is a state, never silent truncation (PRODUCT §4.1 scale).
  partial: z.object({ reason: z.string(), skippedPaths: z.array(repoPathSchema) }).optional()
});
export type Codemap = z.infer<typeof codemapSchema>;

export const symbolDiffSchema = z.object({
  added: z.array(symbolRecordSchema),
  removed: z.array(symbolRecordSchema),
  // Same container path + kind + name but different hash: treated as changed for regeneration
  // scoping; pure renames intentionally surface as removed + added.
  changed: z.array(z.object({ before: symbolRecordSchema, after: symbolRecordSchema })),
  unchangedCount: z.number().int().nonnegative()
});
export type SymbolDiff = z.infer<typeof symbolDiffSchema>;
