// Public API of @docstube/codemap — the language-agnostic codemap host (ARCHITECTURE.md §7).
//
// Design note: tree-sitter remains the multi-language strategy for packs without a good compiler
// API (Python/Java get tree-sitter/griffe later); a language pack owns its extraction method, and
// the TypeScript pack uses the TypeScript compiler API. The kernel-owned parts — symbol hashing
// and diffing — are parser-agnostic; that is the actual contract.

export { hashSymbol, normalizeDeclaration } from './symbol-hash.ts';
export type { HashSymbolInput } from './symbol-hash.ts';
export { walkRepoFiles } from './walk.ts';
export type { WalkOptions } from './walk.ts';
export { buildCodemap, InvalidSymbolRecordError } from './build-codemap.ts';
export type { BuildCodemapOptions } from './build-codemap.ts';
export { diffSymbols } from './diff-symbols.ts';
export { buildFingerprintSnapshot, InvalidSymbolFingerprintError } from './build-fingerprints.ts';
export type {
  BuildFingerprintSnapshotOptions,
  FingerprintCapablePack,
  PackFingerprints
} from './build-fingerprints.ts';
export { materialFingerprint, materialFingerprintIndex } from './material-fingerprint.ts';
export { diffFingerprints } from './diff-fingerprints.ts';
export type { FingerprintDiff, FingerprintedCodemap, SymbolFacetChange } from './diff-fingerprints.ts';
