import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ManifestIndex, PageShard } from '@docstube/contracts';
import { canonicalStateJson, manifestIndexSchema, pageShardRelativePath, pageShardSchema } from '@docstube/contracts';
import { CoreError } from '../errors.ts';

// The committed manifest — sharded one file per page per locale (ARCHITECTURE.md §5.1). Machine-
// owned committed state is canonical sorted-key JSON (harness-state-v2 decision 12): compact,
// byte-stable when content is unchanged, serialized from the PARSED schema output so defaults are
// always materialized identically. Human-owned files (docstube.yml, ia.yml, …) stay YAML. There is
// no YAML→JSON migration: manifests are pre-release state — regenerate.

const manifestDir = (repoRoot: string): string => join(repoRoot, '.docstube', 'manifest');
const indexPath = (repoRoot: string): string => join(manifestDir(repoRoot), 'manifest.json');

const readJsonFile = async <T>(path: string, parseValue: (raw: unknown) => T): Promise<T | undefined> => {
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
    return parseValue(JSON.parse(text));
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
  pruneOrphanShards: (input: { keepPageIds: string[]; locales: string[] }) => Promise<string[]>;
  // Deletes every frozen shard of one version label (re-cutting replaces the whole snapshot).
  removeVersionShards: (label: string) => Promise<void>;
};

export const createManifestStore = (repoRoot: string, currentVersion: string): ManifestStore => {
  const shardPath = (input: { locale: string; pageId: string; version?: string | undefined }): string =>
    join(manifestDir(repoRoot), pageShardRelativePath({ ...input, currentVersion }));

  return {
    readIndex: () => readJsonFile(indexPath(repoRoot), (raw) => manifestIndexSchema.parse(raw)),
    writeIndex: async (index) => {
      const validated = manifestIndexSchema.parse(index);
      await mkdir(manifestDir(repoRoot), { recursive: true });
      await writeFile(indexPath(repoRoot), canonicalStateJson(validated), 'utf8');
    },
    readPageShard: (input) => readJsonFile(shardPath(input), (raw) => pageShardSchema.parse(raw)),
    writePageShard: async (shard) => {
      // Serialize the PARSED output: schema defaults materialize before hashing/serialization, so
      // a semantically-unchanged shard is byte-stable regardless of how the caller built it.
      const validated = pageShardSchema.parse(shard);
      const path = shardPath({ locale: validated.locale, pageId: validated.page.id, version: validated.version });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, canonicalStateJson(validated), 'utf8');
    },
    listShardPageIds: async (locale) => {
      const dir = join(manifestDir(repoRoot), 'pages', locale);
      try {
        const entries = await readdir(dir);
        return entries.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }
        throw error;
      }
    },
    // Crashed or re-planned runs re-mint page ids and leave the old shard files behind; the
    // manifest is committed, so orphans would pollute the repo. Current-version shards only —
    // frozen-version shards are immutable history.
    pruneOrphanShards: async ({ keepPageIds, locales }) => {
      const keep = new Set(keepPageIds);
      const pruned: string[] = [];
      for (const locale of locales) {
        const dir = join(manifestDir(repoRoot), 'pages', locale);
        let entries: string[];
        try {
          entries = await readdir(dir);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            continue;
          }
          throw error;
        }
        for (const name of entries) {
          const pageId = name.endsWith('.json') ? name.slice(0, -'.json'.length) : undefined;
          if (pageId !== undefined && !keep.has(pageId)) {
            await rm(join(dir, name), { force: true });
            pruned.push(`${locale}/${pageId}`);
          }
        }
      }
      return pruned;
    },
    removeVersionShards: async (label) => {
      await rm(join(manifestDir(repoRoot), 'versions', label, 'pages'), { recursive: true, force: true });
    }
  };
};
