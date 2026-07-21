import { z } from 'zod';
import { gitShaSchema, repoPathSchema, sha256HexSchema, sourceKeySchema } from './primitives.ts';

// Typed fingerprint ladder (pipeline-v2 decision 4). `symbolHash` is the codemap identity key
// (packages/codemap symbol-hash.ts: `<lang>:<sha256>` over kind + containerPath + normalized
// declaration). The prints below are finer-grained content hashes emitted by language packs so
// ledger claims can subscribe to exactly the facet they depend on: shape claims → signaturePrint,
// value claims → the named value's print, body subscriptions rare.
export const symbolFingerprintSchema = z.object({
  symbolHash: sourceKeySchema,
  signaturePrint: sha256HexSchema,
  // Named cited values (e.g. a default, a constant) → hash of the normalized value text.
  valuePrints: z.record(z.string().min(1), sha256HexSchema).default({}),
  bodyPrint: sha256HexSchema
});
export type SymbolFingerprint = z.infer<typeof symbolFingerprintSchema>;

// Whole-file fallback for files no language pack can parse (package.json, poms, README…): the
// ladder is never less safe than whole-file hashing, precision improves per file type.
export const fileFingerprintSchema = z.object({
  file: repoPathSchema,
  contentHash: sha256HexSchema
});
export type FileFingerprint = z.infer<typeof fileFingerprintSchema>;

export const fingerprintSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  commit: gitShaSchema,
  symbols: z.array(symbolFingerprintSchema).default([]),
  unparsedFiles: z.array(fileFingerprintSchema).default([])
});
export type FingerprintSnapshot = z.infer<typeof fingerprintSnapshotSchema>;
