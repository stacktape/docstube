import type { ClaimCorrectness, Flag, ManifestIndex, PageShard } from '@docstube/contracts';
import { manifestIndexSchema, pageShardSchema } from '@docstube/contracts';

// The verified delta is the honest PR annotation (PRODUCT §3.3): what changed, what proves it.
// It is computed from the committed manifest (the docs lockfile, ARCHITECTURE §5.1) — since wave
// 2b-iii the counts come from the canonical ClaimEvidence records, one claim = one outcome.

export type ClaimCounts = {
  checked: number;
  unchecked: number;
  contradicted: number;
};

export type PageDelta = {
  pageId: string;
  slug: string;
  title: string;
  locale: string;
  shardPath: string;
  claims: ClaimCounts;
  openFlags: readonly Flag[];
};

export type VerifiedDelta = {
  changedPages: readonly PageDelta[];
  totals: ClaimCounts;
  // Every open flag across all readable shards plus manifest systemFlags — the merge gate input.
  openFlags: readonly Flag[];
};

export type WorkspaceFileReader = (relativePath: string) => Promise<string | undefined>;

export const manifestIndexRelativePath = '.docstube/manifest/manifest.json';

const shardPathPattern = /^\.docstube\/manifest\/(?:versions\/[^/]+\/)?pages\/[^/]+\/[^/]+\.json$/;

export const normalizeRepoPath = (path: string): string => path.replaceAll('\\', '/');

export const isPageShardPath = (path: string): boolean => shardPathPattern.test(normalizeRepoPath(path));

const emptyCounts = (): ClaimCounts => ({ checked: 0, unchecked: 0, contradicted: 0 });

const addCount = (target: ClaimCounts, correctness: ClaimCorrectness): void => {
  target[correctness] += 1;
};

// One claim = one outcome, from the ONLY reader-facing record (ClaimEvidence). A shard without a
// trust spine (rendition shards, pages that never anchored) counts zero claims — honest, never
// invented.
export const countShardClaims = (shard: PageShard): ClaimCounts => {
  const counts = emptyCounts();
  for (const record of shard.provenance?.claimEvidence ?? []) {
    addCount(counts, record.correctness);
  }
  return counts;
};

export const isOpenFlag = (flag: Flag): boolean => flag.status === 'open';

const parseJsonOrThrow = <T>(input: { path: string; text: string; parseValue: (raw: unknown) => T }): T => {
  try {
    return input.parseValue(JSON.parse(input.text));
  } catch (error) {
    throw new Error(`Failed to parse ${input.path}: ${(error as Error).message}`, { cause: error });
  }
};

const currentShardPaths = (index: ManifestIndex): string[] =>
  index.locales.flatMap((locale) => index.pages.map((page) => `.docstube/manifest/pages/${locale}/${page.id}.json`));

// Reads the committed manifest and computes the verified delta for this run's changed files.
// Returns undefined when no manifest index exists (the CLI run produced no manifest — the caller
// must then treat the run as unverified and never enable auto-merge).
export const loadVerifiedDelta = async (input: {
  changedFiles: readonly string[];
  readWorkspaceFile: WorkspaceFileReader;
}): Promise<VerifiedDelta | undefined> => {
  const indexText = await input.readWorkspaceFile(manifestIndexRelativePath);
  if (indexText === undefined) {
    return undefined;
  }
  const index = parseJsonOrThrow({
    path: manifestIndexRelativePath,
    text: indexText,
    parseValue: (raw) => manifestIndexSchema.parse(raw)
  });

  const changedPaths = new Set(input.changedFiles.map(normalizeRepoPath).filter(isPageShardPath));
  const shardPathsToRead = [...new Set([...currentShardPaths(index), ...changedPaths])].toSorted();

  const shards: { path: string; shard: PageShard }[] = [];
  for (const path of shardPathsToRead) {
    const text = await input.readWorkspaceFile(path);
    if (text === undefined) {
      continue;
    }
    shards.push({ path, shard: parseJsonOrThrow({ path, text, parseValue: (raw) => pageShardSchema.parse(raw) }) });
  }

  const changedPages = shards
    .filter(({ path }) => changedPaths.has(path))
    .map(({ path, shard }) => ({
      pageId: shard.page.id,
      slug: shard.page.slug,
      title: shard.page.title,
      locale: shard.locale,
      shardPath: path,
      claims: countShardClaims(shard),
      openFlags: shard.flags.filter(isOpenFlag)
    }))
    .toSorted((a, b) => (a.slug === b.slug ? a.locale.localeCompare(b.locale) : a.slug.localeCompare(b.slug)));

  const totals = emptyCounts();
  for (const page of changedPages) {
    totals.checked += page.claims.checked;
    totals.unchecked += page.claims.unchecked;
    totals.contradicted += page.claims.contradicted;
  }

  const openFlags = [
    ...shards.flatMap(({ shard }) => shard.flags.filter(isOpenFlag)),
    ...index.systemFlags.filter(isOpenFlag)
  ];

  return { changedPages, totals, openFlags };
};
