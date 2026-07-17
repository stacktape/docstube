import type { ManifestIndex } from '@docstube/contracts';
import { CoreError } from '../errors.ts';
import { createManifestStore } from './manifest-store.ts';

// Versioning model C (PRODUCT decision log): the current version is live from HEAD; past versions
// are frozen snapshots cut at release time. Cutting copies every current shard into
// versions/<label>/ and records the frozen version in the index. Manual re-cut of an existing
// label is allowed (fixing old defects), silently replacing that snapshot.

export type VersionCutResult = {
  label: string;
  pagesFrozen: number;
  locales: string[];
};

export const cutVersionSnapshot = async (input: {
  repoRoot: string;
  label: string;
  currentVersion: string;
}): Promise<VersionCutResult> => {
  const store = createManifestStore(input.repoRoot, input.currentVersion);
  const index = await store.readIndex();
  if (index === undefined) {
    throw new CoreError('state-corrupt', 'no manifest to cut a version from — run `docstube generate` first');
  }
  if (input.label === input.currentVersion) {
    throw new CoreError('config-invalid', `cannot freeze "${input.label}" — it is the current (live) version label`);
  }

  // Re-cutting an existing label REPLACES the snapshot: stale shards from the prior cut must not
  // survive next to the new ones (a page removed since the last cut would otherwise linger).
  await store.removeVersionShards(input.label);

  let pagesFrozen = 0;
  for (const entry of index.pages) {
    for (const locale of index.locales) {
      const shard = await store.readPageShard({ locale, pageId: entry.id });
      if (shard === undefined) {
        continue;
      }
      await store.writePageShard({ ...shard, version: input.label });
      pagesFrozen += 1;
    }
  }

  const withoutLabel = index.versions.filter((version) => version.label !== input.label);
  const updated: ManifestIndex = {
    ...index,
    versions: [...withoutLabel, { label: input.label, status: 'frozen', cutAt: new Date().toISOString() }]
  };
  await store.writeIndex(updated);
  return { label: input.label, pagesFrozen, locales: [...index.locales] };
};
