import type { FingerprintSnapshot, SymbolFingerprint } from '@docstube/contracts';
import { hashValue } from '@docstube/contracts';

// The MATERIAL side of the typed fingerprint ladder: the facets whose change makes a previously
// true statement about a symbol possibly false. It is the same split diff-fingerprints already
// draws with `bodyOnly` (pipeline-v2 decision 4) — signature + cited values + declared schema
// shape are material; the body is not — expressed here as a single stable hash so a record can
// BIND to a subject across refactors instead of re-diffing two codemaps.
//
// Why a hash and not the diff: knowledge facts (dx-knowledge-v2 decision 6) are answered once and
// live for months. The symbol hash re-mints on ANY declaration edit, including a body-only or
// formatting-only one, so a durable binding keyed on it would go stale on every cosmetic
// refactor. Keyed on the material fingerprint, a cosmetic refactor rebinds silently (the material
// facets are unchanged, only the identity key moved) and a material change is detectable with no
// "before" snapshot at all.
//
// Packs that emit NO facets for a symbol fall back to the symbol hash itself, so the binding
// degrades to whole-declaration invalidation — never less safe than the previous behavior, and
// never ambiguous across symbols.
export const materialFingerprint = (symbolHash: string, fingerprint: SymbolFingerprint | undefined): string => {
  const hasFacets =
    fingerprint !== undefined &&
    (fingerprint.signaturePrint !== undefined ||
      fingerprint.schemaShapePrint !== undefined ||
      Object.keys(fingerprint.valuePrints).length > 0);
  if (!hasFacets) {
    return hashValue({ kind: 'symbol-declaration', symbolHash });
  }
  return hashValue({
    kind: 'symbol-material',
    signature: fingerprint.signaturePrint ?? null,
    schemaShape: fingerprint.schemaShapePrint ?? null,
    values: fingerprint.valuePrints
  });
};

// Every symbol in a snapshot indexed by its material fingerprint. A fingerprint claimed by more
// than one symbol (identical overloads, generated code) is AMBIGUOUS: rebinding to either would be
// a guess, so callers treat it as "cannot bind" rather than picking one.
export const materialFingerprintIndex = (snapshot: FingerprintSnapshot): Map<string, string[]> => {
  const index = new Map<string, string[]>();
  for (const fingerprint of snapshot.symbols) {
    const key = materialFingerprint(fingerprint.symbolHash, fingerprint);
    const bucket = index.get(key);
    if (bucket) {
      bucket.push(fingerprint.symbolHash);
    } else {
      index.set(key, [fingerprint.symbolHash]);
    }
  }
  return index;
};
