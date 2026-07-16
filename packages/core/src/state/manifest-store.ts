import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { ManifestIndex, PageShard } from '@docstube/contracts';
import { manifestIndexSchema, pageShardRelativePath, pageShardSchema } from '@docstube/contracts';
import { CoreError } from '../errors.ts';

// The committed manifest — sharded one file per page per locale (ARCHITECTURE.md §5.1). All YAML,
// deterministic serialization (schemas define key order), merge-tolerant by construction.

const manifestDir = (repoRoot: string): string => join(repoRoot, '.docstube', 'manifest');
const indexPath = (repoRoot: string): string => join(manifestDir(repoRoot), 'manifest.yml');

const toYaml = (value: unknown): string => stringify(value, { lineWidth: 0 });

const readYamlFile = async <T>(path: string, parseValue: (raw: unknown) => T): Promise<T | undefined> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  try {
    return parseValue(parse(text));
  } catch (error) {
    throw new CoreError('state-corrupt', `failed to parse ${path}: ${(error as Error).message}`, { path });
  }
};

export type ManifestStore = {
  readIndex: () => Promise<ManifestIndex | undefined>;
  writeIndex: (index: ManifestIndex) => Promise<void>;
  readPageShard: (input: { locale: string; pageId: string; version?: string }) => Promise<PageShard | undefined>;
  writePageShard: (shard: PageShard) => Promise<void>;
  listShardPageIds: (locale: string) => Promise<string[]>;
};

export const createManifestStore = (repoRoot: string, currentVersion: string): ManifestStore => {
  const shardPath = (input: { locale: string; pageId: string; version?: string | undefined }): string =>
    join(manifestDir(repoRoot), pageShardRelativePath({ ...input, currentVersion }));

  return {
    readIndex: () => readYamlFile(indexPath(repoRoot), (raw) => manifestIndexSchema.parse(raw)),
    writeIndex: async (index) => {
      const validated = manifestIndexSchema.parse(index);
      await mkdir(manifestDir(repoRoot), { recursive: true });
      await writeFile(indexPath(repoRoot), toYaml(validated), 'utf8');
    },
    readPageShard: (input) => readYamlFile(shardPath(input), (raw) => pageShardSchema.parse(raw)),
    writePageShard: async (shard) => {
      const validated = pageShardSchema.parse(shard);
      const path = shardPath({ locale: validated.locale, pageId: validated.page.id, version: validated.version });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, toYaml(validated), 'utf8');
    },
    listShardPageIds: async (locale) => {
      const dir = join(manifestDir(repoRoot), 'pages', locale);
      try {
        const entries = await readdir(dir);
        return entries.filter((name) => name.endsWith('.yml')).map((name) => name.slice(0, -'.yml'.length));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }
        throw error;
      }
    }
  };
};
