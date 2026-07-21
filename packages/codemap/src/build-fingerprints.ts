import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, contentHash, fingerprintSnapshotSchema, symbolFingerprintSchema } from '@docstube/contracts';
import type { FingerprintSnapshot, SymbolFingerprint } from '@docstube/contracts';
import type { LanguagePackContext, LanguagePackDefinition, PluginLogger } from '@docstube/plugin-sdk';
import { z } from 'zod';
import { hashSymbol } from './symbol-hash.ts';
import { walkRepoFiles } from './walk.ts';

// Typed fingerprint ladder host (ARCHITECTURE.md §7.2, pipeline-v2 decision 4). Packs emit
// per-symbol facet prints; every walked file no pack fingerprinted falls back to whole-file
// content hashing, so the snapshot is never less safe than hashing everything.

// What a pack's fingerprint extraction returns. `parsedFiles` are the files whose change surface
// is FULLY covered by the returned symbol fingerprints — every other walked file (unmatched
// extension, parse failure, zero exported declarations) gets the whole-file fallback.
export type PackFingerprints = {
  symbols: SymbolFingerprint[];
  parsedFiles: string[];
};

// Additive capability on top of the plugin-sdk pack shape: packs that support the typed ladder
// implement `extractFingerprints`; packs that do not stay on whole-file fallback for their files.
export type FingerprintCapablePack = LanguagePackDefinition & {
  extractFingerprints?: ((ctx: LanguagePackContext) => Promise<PackFingerprints>) | undefined;
};

// A language pack returned a fingerprint that does not satisfy symbolFingerprintSchema. This is a
// pack bug, never user data — fail loudly with the pack id and the schema issues.
export class InvalidSymbolFingerprintError extends Error {
  readonly packId: string;
  readonly issues: string;

  constructor(packId: string, issues: string) {
    super(`language pack "${packId}" produced an invalid symbol fingerprint:\n${issues}`);
    this.name = 'InvalidSymbolFingerprintError';
    this.packId = packId;
    this.issues = issues;
  }
}

export type BuildFingerprintSnapshotOptions = {
  repoRoot: string;
  // Commit the snapshot was built at, stored for provenance.
  commit: string;
  packs: FingerprintCapablePack[];
  // Extra repo-relative paths to skip on top of the built-in walk exclusions.
  ignore?: string[];
  logger?: PluginLogger;
};

const consoleLogger: PluginLogger = {
  info: (message) => console.info(`[codemap] ${message}`),
  warn: (message) => console.warn(`[codemap] ${message}`)
};

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Byte-stable valuePrints regardless of pack emission order.
const withSortedValuePrints = (fingerprint: SymbolFingerprint): SymbolFingerprint => ({
  ...fingerprint,
  valuePrints: Object.fromEntries(Object.entries(fingerprint.valuePrints).toSorted(([a], [b]) => compareStrings(a, b)))
});

// Walks the repo once, collects fingerprints from every fingerprint-capable pack, validates them,
// and content-hashes everything the packs did not cover. Deterministic: same tree → byte-identical
// snapshot (symbols sorted by hash, files and value names sorted lexicographically).
export const buildFingerprintSnapshot = async (
  options: BuildFingerprintSnapshotOptions
): Promise<FingerprintSnapshot> => {
  const logger = options.logger ?? consoleLogger;
  const allFiles = await walkRepoFiles({
    repoRoot: options.repoRoot,
    ...(options.ignore ? { ignore: options.ignore } : {})
  });

  const parsedFiles = new Set<string>();
  const runPack = async (pack: FingerprintCapablePack): Promise<SymbolFingerprint[]> => {
    if (pack.extractFingerprints === undefined) {
      return [];
    }
    const files = allFiles.filter((file) => pack.fileExtensions.some((extension) => file.endsWith(extension)));
    const context: LanguagePackContext = {
      repoRoot: options.repoRoot,
      files,
      readFile: (repoRelativePath) => readFile(join(options.repoRoot, repoRelativePath), 'utf8'),
      hashSymbol,
      logger
    };
    const result = await pack.extractFingerprints(context);
    for (const file of result.parsedFiles) {
      parsedFiles.add(file);
    }
    logger.info(
      `pack "${pack.id}": ${result.symbols.length} fingerprints from ${result.parsedFiles.length}/${files.length} files`
    );
    return result.symbols.map((symbol) => {
      const parsed = symbolFingerprintSchema.safeParse(symbol);
      if (!parsed.success) {
        throw new InvalidSymbolFingerprintError(pack.id, z.prettifyError(parsed.error));
      }
      return withSortedValuePrints(parsed.data);
    });
  };

  const perPackSymbols = await Promise.all(options.packs.map(runPack));
  const sorted = perPackSymbols
    .flat()
    .toSorted(
      (a, b) => compareStrings(a.symbolHash, b.symbolHash) || compareStrings(canonicalJson(a), canonicalJson(b))
    );
  const symbols: SymbolFingerprint[] = [];
  for (const symbol of sorted) {
    const previous = symbols.at(-1);
    if (previous !== undefined && previous.symbolHash === symbol.symbolHash) {
      if (canonicalJson(previous) !== canonicalJson(symbol)) {
        logger.warn(`conflicting fingerprints for ${symbol.symbolHash}; keeping the first`);
      }
      continue;
    }
    symbols.push(symbol);
  }

  const fallbackFiles = allFiles.filter((file) => !parsedFiles.has(file));
  const unparsedFiles = await Promise.all(
    fallbackFiles.map(async (file) => ({
      file,
      contentHash: contentHash(await readFile(join(options.repoRoot, file), 'utf8'))
    }))
  );

  return fingerprintSnapshotSchema.parse({
    schemaVersion: 1,
    commit: options.commit,
    symbols,
    unparsedFiles: unparsedFiles.toSorted((a, b) => compareStrings(a.file, b.file))
  });
};
