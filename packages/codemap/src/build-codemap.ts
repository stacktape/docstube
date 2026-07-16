import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codemapSchema, symbolRecordSchema } from '@docstube/contracts';
import type { Codemap, SymbolRecord } from '@docstube/contracts';
import type { LanguagePackContext, LanguagePackDefinition, PluginLogger } from '@docstube/plugin-sdk';
import { z } from 'zod';
import { hashSymbol } from './symbol-hash.ts';
import { walkRepoFiles } from './walk.ts';

// A language pack returned a record that does not satisfy symbolRecordSchema. This is a pack
// bug, never user data — fail loudly with the pack id and the schema issues.
export class InvalidSymbolRecordError extends Error {
  readonly packId: string;
  readonly issues: string;

  constructor(packId: string, issues: string) {
    super(`language pack "${packId}" produced an invalid symbol record:\n${issues}`);
    this.name = 'InvalidSymbolRecordError';
    this.packId = packId;
    this.issues = issues;
  }
}

export type BuildCodemapOptions = {
  repoRoot: string;
  // Commit the codemap was built at (7–40 hex chars), stored for provenance.
  commit: string;
  packs: LanguagePackDefinition[];
  // Monorepo dimension; single-project repos omit it (records default to '.').
  project?: string;
  // Extra repo-relative paths to skip on top of the built-in walk exclusions.
  ignore?: string[];
  logger?: PluginLogger;
};

const consoleLogger: PluginLogger = {
  info: (message) => console.info(`[codemap] ${message}`),
  warn: (message) => console.warn(`[codemap] ${message}`)
};

const byLocation = (a: SymbolRecord, b: SymbolRecord): number =>
  a.file.localeCompare(b.file) || a.span[0] - b.span[0] || a.hash.localeCompare(b.hash);

// Walks the repo once per pack, hands each pack its matching files plus the kernel-owned
// hashSymbol, validates every returned record, and aggregates the result into a Codemap.
export const buildCodemap = async (options: BuildCodemapOptions): Promise<Codemap> => {
  const logger = options.logger ?? consoleLogger;
  const runPack = async (pack: LanguagePackDefinition): Promise<SymbolRecord[]> => {
    const files = await walkRepoFiles({
      repoRoot: options.repoRoot,
      extensions: pack.fileExtensions,
      ...(options.ignore ? { ignore: options.ignore } : {})
    });
    const context: LanguagePackContext = {
      repoRoot: options.repoRoot,
      files,
      readFile: (repoRelativePath) => readFile(join(options.repoRoot, repoRelativePath), 'utf8'),
      hashSymbol,
      logger
    };
    const records = await pack.extractSymbols(context);
    logger.info(`pack "${pack.id}": ${records.length} symbols from ${files.length} files`);
    return records.map((record) => {
      const candidate = options.project === undefined ? record : { ...record, project: options.project };
      const parsed = symbolRecordSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new InvalidSymbolRecordError(pack.id, z.prettifyError(parsed.error));
      }
      return parsed.data;
    });
  };
  const perPackSymbols = await Promise.all(options.packs.map(runPack));
  const symbols = perPackSymbols.flat().toSorted(byLocation);
  return codemapSchema.parse({ schemaVersion: 1, commit: options.commit, symbols });
};
