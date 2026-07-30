import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ManifestIndex, PageShard } from '@docstube/contracts';
import {
  canonicalStateJson,
  manifestIndexSchema,
  pageIdSchema,
  pageShardRelativePath,
  pageShardSchema
} from '@docstube/contracts';
import { CoreError } from '../errors.ts';

// The committed manifest — sharded one file per page per locale (ARCHITECTURE.md §5.1). Machine-
// owned committed state is canonical sorted-key JSON (harness-state-v2 decision 12): compact,
// byte-stable when content is unchanged, serialized from the PARSED schema output so defaults are
// always materialized identically. Human-owned files (docstube.yml, ia.yml, …) stay YAML. There is
// no YAML→JSON migration: manifests are pre-release state — regenerate.

export const committedManifestDir = (repoRoot: string): string => join(repoRoot, '.docstube', 'manifest');
const indexPath = (manifestRoot: string): string => join(manifestRoot, 'manifest.json');
const currentPagesDir = (manifestRoot: string): string => join(manifestRoot, 'pages');

// Every serialization the store has EVER owned at these paths. A `.yml` shard is not a foreign
// file to be preserved: it is this store's own superseded output, so reconciliation removes it.
const shardExtensions = ['.json', '.yml', '.yaml'] as const;

// Files the store owns are exactly `<pageId>.<known extension>` — a page id is a fixed-shape
// Crockford-base32 token, so nothing a human or another tool drops in this tree can match by
// accident. Anything else under the shard directories is left strictly alone.
const parseShardFileName = (name: string): { pageId: string; extension: string } | undefined => {
  const extension = shardExtensions.find((candidate) => name.endsWith(candidate));
  if (extension === undefined) {
    return undefined;
  }
  const pageId = name.slice(0, -extension.length);
  return pageIdSchema.safeParse(pageId).success ? { pageId, extension } : undefined;
};

const readDirEntries = async (dir: string): Promise<string[]> => {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

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

// Paths are reported relative to `.docstube/manifest/`, in posix form — the same shape emit-site
// uses for pruned routes, so a run summary reads the same way for both reconcilers.
export type ManifestIndexWriteResult = {
  pruned: string[];
};

export type ManifestStore = {
  // Verifies by DEFAULT that every indexed page still has its source-locale shard: an index that
  // outruns the shards on disk is the "recorded state disagrees with reality" failure this project
  // exists to prevent, so reading it is fatal everywhere except the reconcilers that repair it.
  readIndex: (options?: { requireShards?: boolean }) => Promise<ManifestIndex | undefined>;
  // Writing the index RECONCILES the shard tree against it — there is no way to record an index
  // and leave contradicting shard files behind.
  writeIndex: (index: ManifestIndex) => Promise<ManifestIndexWriteResult>;
  readPageShard: (input: { locale: string; pageId: string; version?: string }) => Promise<PageShard | undefined>;
  writePageShard: (shard: PageShard) => Promise<void>;
  listShardPageIds: (locale: string) => Promise<string[]>;
  // Deletes every frozen shard of one version label (re-cutting replaces the whole snapshot).
  removeVersionShards: (label: string) => Promise<void>;
};

export type ManifestStoreOptions = {
  // Absolute path of the manifest root. Defaults to the COMMITTED manifest (`.docstube/manifest/`).
  // The staged-publish area (publish-staging.ts) opens a second store on its own root so a run can
  // accumulate shards with identical semantics — validation, canonical serialization, index
  // reconciliation — without touching published state.
  manifestDir?: string | undefined;
};

export const createManifestStore = (
  repoRoot: string,
  currentVersion: string,
  options: ManifestStoreOptions = {}
): ManifestStore => {
  const manifestRoot = options.manifestDir ?? committedManifestDir(repoRoot);
  const shardPath = (input: { locale: string; pageId: string; version?: string | undefined }): string =>
    join(manifestRoot, pageShardRelativePath({ ...input, currentVersion }));

  const readPageShard = (input: { locale: string; pageId: string; version?: string }): Promise<PageShard | undefined> =>
    readJsonFile(shardPath(input), (raw) => pageShardSchema.parse(raw));

  // Crashed or re-planned runs re-mint page ids and leave the old shard files behind; a format
  // change leaves the previous serialization behind. The manifest is committed, so either kind of
  // orphan would pollute the repo AND make the recorded state ambiguous. Scope: the CURRENT
  // page-shard directories plus the superseded root index only — frozen `versions/<label>/` shards
  // are immutable history, and nothing else under `.docstube/` is this store's to delete.
  const reconcileShardTree = async (index: ManifestIndex): Promise<string[]> => {
    const keepPageIds = new Set(index.pages.map((entry) => entry.id));
    const keepLocales = new Set([index.sourceLocale, ...index.locales]);
    const pruned: string[] = [];
    const pagesDir = currentPagesDir(manifestRoot);
    for (const locale of await readDirEntries(pagesDir)) {
      const localeDir = join(pagesDir, locale);
      const entries = await readDirEntries(localeDir);
      let removed = 0;
      for (const name of entries) {
        const shardFile = parseShardFileName(name);
        if (shardFile === undefined) {
          continue;
        }
        // The index resolves a page to its `.json` shard, so a same-id `.yml` sitting beside it is
        // referenced by nothing — the pre-JSON leftovers clean themselves up on the next write.
        const referenced =
          shardFile.extension === '.json' && keepLocales.has(locale) && keepPageIds.has(shardFile.pageId);
        if (referenced) {
          continue;
        }
        await rm(join(localeDir, name), { force: true });
        pruned.push(`pages/${locale}/${name}`);
        removed += 1;
      }
      if (removed === entries.length && removed > 0) {
        // rmdir without recursive fails on a non-empty directory, which is exactly the guard
        // wanted: a dropped locale leaves no hollow tree, a shared one is untouched.
        await rmdir(localeDir).catch(() => {});
      }
    }
    // The root index has exactly one owner and one current serialization, so a `manifest.yml` next
    // to `manifest.json` is unambiguously this store's superseded output.
    for (const name of ['manifest.yml', 'manifest.yaml']) {
      const candidate = join(manifestRoot, name);
      const isFile = await stat(candidate).then(
        (stats) => stats.isFile(),
        () => false
      );
      if (isFile) {
        await rm(candidate, { force: true });
        pruned.push(name);
      }
    }
    return pruned.toSorted((left, right) => left.localeCompare(right));
  };

  const assertShardsPresent = async (index: ManifestIndex): Promise<void> => {
    const missing: Array<{ id: string; slug: string }> = [];
    for (const entry of index.pages) {
      // Source-locale only: a translated rendition is legitimately absent until it is generated,
      // but the source shard IS the page — no shard, no page.
      const shard = await readPageShard({ locale: index.sourceLocale, pageId: entry.id });
      if (shard === undefined) {
        missing.push({ id: entry.id, slug: entry.slug });
      }
    }
    if (missing.length === 0) {
      return;
    }
    const named = missing.map((entry) => `${entry.id} ("${entry.slug}")`).join(', ');
    throw new CoreError(
      'state-corrupt',
      `the manifest index lists ${missing.length} page(s) whose ${index.sourceLocale} shard is missing: ${named} — ` +
        'the recorded manifest outruns the shards on disk, so nothing can be published or reasoned about from it ' +
        'without inventing state. Run `docstube generate` to rebuild the manifest from the codebase.',
      { repoRoot, sourceLocale: index.sourceLocale, pageIds: missing.map((entry) => entry.id) }
    );
  };

  return {
    readIndex: async (readOptions) => {
      const index = await readJsonFile(indexPath(manifestRoot), (raw) => manifestIndexSchema.parse(raw));
      // No manifest at all is the FIRST-RUN state, not a contradiction — only an index that claims
      // pages is held to its shards.
      if (index === undefined) {
        return undefined;
      }
      if (readOptions?.requireShards !== false) {
        await assertShardsPresent(index);
      }
      return index;
    },
    writeIndex: async (index) => {
      const validated = manifestIndexSchema.parse(index);
      await mkdir(manifestRoot, { recursive: true });
      // THE COMMIT POINT of a staged publish (publish-staging.ts) is this one write: it is the last
      // thing a publish does, and every page it names is already on disk. Written to a temp file and
      // RENAMED so the index itself is never observable half-written — a reader either sees the
      // previous index or the new one, never a truncated JSON document.
      const temporary = join(manifestRoot, 'manifest.json.tmp');
      await writeFile(temporary, canonicalStateJson(validated), 'utf8');
      await rename(temporary, indexPath(manifestRoot));
      // Reconcile AFTER the index is on disk: an interrupted write never leaves shards deleted for
      // an index that was never recorded.
      return { pruned: await reconcileShardTree(validated) };
    },
    readPageShard,
    writePageShard: async (shard) => {
      // Serialize the PARSED output: schema defaults materialize before hashing/serialization, so
      // a semantically-unchanged shard is byte-stable regardless of how the caller built it.
      const validated = pageShardSchema.parse(shard);
      const path = shardPath({ locale: validated.locale, pageId: validated.page.id, version: validated.version });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, canonicalStateJson(validated), 'utf8');
    },
    listShardPageIds: async (locale) => {
      const entries = await readDirEntries(join(currentPagesDir(manifestRoot), locale));
      return entries.flatMap((name) => {
        const shardFile = parseShardFileName(name);
        return shardFile?.extension === '.json' ? [shardFile.pageId] : [];
      });
    },
    removeVersionShards: async (label) => {
      await rm(join(manifestRoot, 'versions', label, 'pages'), { recursive: true, force: true });
    }
  };
};
