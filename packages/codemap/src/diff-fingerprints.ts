import type { Codemap, FingerprintSnapshot, SymbolFingerprint } from '@docstube/contracts';
import { diffSymbols } from './diff-symbols.ts';

// Facet-level fingerprint diffing (pipeline-v2 decision 4): the reconciler's invalidation input.
// Local types on purpose — this is host output consumed in-process, not committed state, so it
// does not belong in @docstube/contracts.

// One side of the diff: the codemap (display identities pair a changed symbol's old and new
// hashes, exactly as diffSymbols does) plus the fingerprint snapshot built at the same commit.
export type FingerprintedCodemap = {
  codemap: Codemap;
  fingerprints: FingerprintSnapshot;
};

// An entry with every facet false is a pure REKEY (e.g. object-literal key reordering: the raw
// declaration changed, no print did) — subscribers migrate to afterHash, nothing invalidates.
export type SymbolFacetChange = {
  // The symbol hash covers the full normalized declaration, so ANY facet edit re-mints it — a
  // changed symbol therefore has two hashes. Subscribers keyed on beforeHash migrate to afterHash.
  beforeHash: string;
  afterHash: string;
  signatureChanged: boolean;
  // Value names present on both sides whose print differs — value claims subscribe per name.
  changedValueNames: string[];
  addedValueNames: string[];
  removedValueNames: string[];
  bodyChanged: boolean;
  // Body changed while the signature and every value print held — the "regenerates 0 pages" case.
  bodyOnly: boolean;
};

export type FingerprintDiff = {
  changed: SymbolFacetChange[];
  // Symbol hashes with no counterpart on the other side. Includes fingerprint-only symbols (e.g.
  // .d.ts signatures, which have no codemap record): those can only be paired by identical hash,
  // so an edited .d.ts signature surfaces as removed + added — safe over-invalidation.
  addedSymbols: string[];
  removedSymbols: string[];
  unchangedCount: number;
  // Whole-file fallback records diffed by path + content hash.
  files: { added: string[]; changed: string[]; removed: string[] };
};

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const facetChange = (
  beforeHash: string,
  afterHash: string,
  before: SymbolFingerprint | undefined,
  after: SymbolFingerprint | undefined
): SymbolFacetChange => {
  // No facet data on one side (the pack does not emit fingerprints): every facet is presumed
  // changed — never less safe than whole-declaration invalidation.
  if (before === undefined || after === undefined) {
    return {
      beforeHash,
      afterHash,
      signatureChanged: true,
      changedValueNames: [],
      addedValueNames: [],
      removedValueNames: [],
      bodyChanged: true,
      bodyOnly: false
    };
  }
  const signatureChanged = before.signaturePrint !== after.signaturePrint;
  const changedValueNames: string[] = [];
  const addedValueNames: string[] = [];
  const removedValueNames: string[] = [];
  const valueNames = new Set([...Object.keys(before.valuePrints), ...Object.keys(after.valuePrints)]);
  for (const name of [...valueNames].toSorted(compareStrings)) {
    const beforePrint = before.valuePrints[name];
    const afterPrint = after.valuePrints[name];
    if (beforePrint === undefined) {
      addedValueNames.push(name);
    } else if (afterPrint === undefined) {
      removedValueNames.push(name);
    } else if (beforePrint !== afterPrint) {
      changedValueNames.push(name);
    }
  }
  const bodyChanged = before.bodyPrint !== after.bodyPrint;
  const valuesTouched = changedValueNames.length + addedValueNames.length + removedValueNames.length > 0;
  return {
    beforeHash,
    afterHash,
    signatureChanged,
    changedValueNames,
    addedValueNames,
    removedValueNames,
    bodyChanged,
    bodyOnly: bodyChanged && !signatureChanged && !valuesTouched
  };
};

export const diffFingerprints = (before: FingerprintedCodemap, after: FingerprintedCodemap): FingerprintDiff => {
  const beforePrints = new Map<string, SymbolFingerprint>(before.fingerprints.symbols.map((s) => [s.symbolHash, s]));
  const afterPrints = new Map<string, SymbolFingerprint>(after.fingerprints.symbols.map((s) => [s.symbolHash, s]));
  const beforeCodemapHashes = new Set(before.codemap.symbols.map((s) => s.hash));
  const afterCodemapHashes = new Set(after.codemap.symbols.map((s) => s.hash));

  const symbolDiff = diffSymbols(before.codemap, after.codemap);
  const changed = symbolDiff.changed.map((pair) =>
    facetChange(pair.before.hash, pair.after.hash, beforePrints.get(pair.before.hash), afterPrints.get(pair.after.hash))
  );

  let unchangedCount = symbolDiff.unchangedCount;
  const addedSymbols = symbolDiff.added.map((symbol) => symbol.hash);
  const removedSymbols = symbolDiff.removed.map((symbol) => symbol.hash);
  for (const hash of afterPrints.keys()) {
    if (afterCodemapHashes.has(hash)) {
      continue;
    }
    if (beforePrints.has(hash) || beforeCodemapHashes.has(hash)) {
      unchangedCount += 1;
    } else {
      addedSymbols.push(hash);
    }
  }
  for (const hash of beforePrints.keys()) {
    if (beforeCodemapHashes.has(hash)) {
      continue;
    }
    if (!afterPrints.has(hash) && !afterCodemapHashes.has(hash)) {
      removedSymbols.push(hash);
    }
  }

  const beforeFiles = new Map(before.fingerprints.unparsedFiles.map((record) => [record.file, record.contentHash]));
  const afterFiles = new Map(after.fingerprints.unparsedFiles.map((record) => [record.file, record.contentHash]));
  const files: FingerprintDiff['files'] = { added: [], changed: [], removed: [] };
  for (const [file, hash] of afterFiles) {
    const previous = beforeFiles.get(file);
    if (previous === undefined) {
      files.added.push(file);
    } else if (previous !== hash) {
      files.changed.push(file);
    }
  }
  for (const file of beforeFiles.keys()) {
    if (!afterFiles.has(file)) {
      files.removed.push(file);
    }
  }

  return {
    changed: changed.toSorted((a, b) => compareStrings(a.afterHash, b.afterHash)),
    addedSymbols: addedSymbols.toSorted(compareStrings),
    removedSymbols: removedSymbols.toSorted(compareStrings),
    unchangedCount,
    files: {
      added: files.added.toSorted(compareStrings),
      changed: files.changed.toSorted(compareStrings),
      removed: files.removed.toSorted(compareStrings)
    }
  };
};
