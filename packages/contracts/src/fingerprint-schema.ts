import { z } from 'zod';
import {
  contentHashSchema,
  fingerprintPrintSchema,
  gitCommitSchema,
  repoPathSchema,
  symbolSourceKeySchema
} from './primitives.ts';

// Typed fingerprint ladder (pipeline-v2 decision 4). `symbolHash` is the codemap identity key
// (packages/codemap symbol-hash.ts: `<lang>:<sha256>` over kind + containerPath + normalized
// declaration). Language packs emit UP TO three prints per symbol — every print is optional where
// the facet does not exist (.d.ts files are signature-only; symbols without extractable values
// emit no value prints) — so ledger claims can subscribe to exactly the facet they depend on.
export const symbolFingerprintSchema = z.object({
  symbolHash: symbolSourceKeySchema,
  signaturePrint: fingerprintPrintSchema.optional(),
  // Named cited values (e.g. a default, a constant) → hash of the normalized value text.
  valuePrints: z.record(z.string().min(1), fingerprintPrintSchema).default({}),
  bodyPrint: fingerprintPrintSchema.optional()
});
export type SymbolFingerprint = z.infer<typeof symbolFingerprintSchema>;

// Whole-file fallback for files no language pack can parse (package.json, poms, README…): the
// ladder is never less safe than whole-file hashing, precision improves per file type.
export const fileFingerprintSchema = z.object({
  file: repoPathSchema,
  contentHash: contentHashSchema
});
export type FileFingerprint = z.infer<typeof fileFingerprintSchema>;

export const fingerprintSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  commit: gitCommitSchema,
  symbols: z.array(symbolFingerprintSchema).default([]),
  unparsedFiles: z.array(fileFingerprintSchema).default([])
});
export type FingerprintSnapshot = z.infer<typeof fingerprintSnapshotSchema>;
