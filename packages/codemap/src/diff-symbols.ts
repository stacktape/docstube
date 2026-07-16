import { symbolDiffSchema } from '@docstube/contracts';
import type { Codemap, SymbolDiff, SymbolRecord } from '@docstube/contracts';

// Same (lang, kind, containerPath, name) — the display identity used ONLY to pair a before/after
// record as "changed" for regeneration scoping. It is never a provenance key (PRODUCT §3.2).
// NUL cannot appear in identifiers, so the join is unambiguous.
const identityKey = (symbol: SymbolRecord): string =>
  [symbol.lang, symbol.kind, ...symbol.containerPath, symbol.name].join('\u0000');

const byLocation = (a: SymbolRecord, b: SymbolRecord): number =>
  a.file.localeCompare(b.file) || a.span[0] - b.span[0] || a.hash.localeCompare(b.hash);

// Contract semantics (symbolDiffSchema in @docstube/contracts):
// - identical hash on both sides → unchanged (counted only);
// - same (lang, kind, containerPath, name) but different hash → changed;
// - everything else → removed / added. A pure rename changes the hash AND the identity, so it
//   surfaces as removed + added — intended: dependent entities must regenerate after a rename.
export const diffSymbols = (before: Codemap, after: Codemap): SymbolDiff => {
  const beforeByHash = new Map<string, SymbolRecord[]>();
  for (const symbol of before.symbols) {
    const bucket = beforeByHash.get(symbol.hash);
    if (bucket) {
      bucket.push(symbol);
    } else {
      beforeByHash.set(symbol.hash, [symbol]);
    }
  }

  let unchangedCount = 0;
  const afterUnmatched: SymbolRecord[] = [];
  for (const symbol of after.symbols) {
    const bucket = beforeByHash.get(symbol.hash);
    if (bucket !== undefined && bucket.length > 0) {
      bucket.pop();
      unchangedCount += 1;
    } else {
      afterUnmatched.push(symbol);
    }
  }

  const beforeByIdentity = new Map<string, SymbolRecord[]>();
  for (const symbol of [...beforeByHash.values()].flat()) {
    const key = identityKey(symbol);
    const bucket = beforeByIdentity.get(key);
    if (bucket) {
      bucket.push(symbol);
    } else {
      beforeByIdentity.set(key, [symbol]);
    }
  }

  const added: SymbolRecord[] = [];
  const changed: Array<{ before: SymbolRecord; after: SymbolRecord }> = [];
  for (const symbol of afterUnmatched) {
    const previous = beforeByIdentity.get(identityKey(symbol))?.shift();
    if (previous) {
      changed.push({ before: previous, after: symbol });
    } else {
      added.push(symbol);
    }
  }
  const removed = [...beforeByIdentity.values()].flat();

  return symbolDiffSchema.parse({
    added: added.toSorted(byLocation),
    removed: removed.toSorted(byLocation),
    changed: changed.toSorted((a, b) => byLocation(a.after, b.after)),
    unchangedCount
  });
};
