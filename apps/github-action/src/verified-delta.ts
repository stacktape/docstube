import { parse } from 'yaml';
import type { Flag, GuaranteeLevel, ManifestIndex, PageEntity, PageShard } from '@docstube/contracts';
import { manifestIndexSchema, pageShardSchema } from '@docstube/contracts';

// The verified delta is the honest PR annotation (PRODUCT §3.3): what changed, what proves it.
// It is computed from the committed manifest (the docs lockfile, ARCHITECTURE §5.1), never from
// prose in CLI output.

export type GuaranteeCounts = {
  proven: number;
  scored: number;
  'out-of-domain': number;
};

export type PageDelta = {
  pageId: string;
  slug: string;
  title: string;
  locale: string;
  shardPath: string;
  guarantees: GuaranteeCounts;
  openFlags: readonly Flag[];
};

export type VerifiedDelta = {
  changedPages: readonly PageDelta[];
  totals: GuaranteeCounts;
  // Every open flag across all readable shards plus manifest systemFlags — the merge gate input.
  openFlags: readonly Flag[];
};

export type WorkspaceFileReader = (relativePath: string) => Promise<string | undefined>;

export const manifestIndexRelativePath = '.docstube/manifest/manifest.yml';

const shardPathPattern = /^\.docstube\/manifest\/(?:versions\/[^/]+\/)?pages\/[^/]+\/[^/]+\.yml$/;

export const normalizeRepoPath = (path: string): string => path.replaceAll('\\', '/');

export const isPageShardPath = (path: string): boolean => shardPathPattern.test(normalizeRepoPath(path));

const emptyCounts = (): GuaranteeCounts => ({ proven: 0, scored: 0, 'out-of-domain': 0 });

const addCounts = (target: GuaranteeCounts, level: GuaranteeLevel): void => {
  target[level] += 1;
};

// Counts content-bearing entities (blocks and claims); page/section levels are pessimistic
// roll-ups of these and would double-count.
export const countPageGuarantees = (page: PageEntity): GuaranteeCounts => {
  const counts = emptyCounts();
  const blocks = [...page.preamble, ...page.sections.flatMap((section) => section.blocks)];
  for (const block of blocks) {
    addCounts(counts, block.guarantee);
    for (const claim of block.claims) {
      addCounts(counts, claim.guarantee);
    }
  }
  return counts;
};

export const isOpenFlag = (flag: Flag): boolean => flag.status === 'open';

const parseYamlOrThrow = <T>(input: { path: string; text: string; parseValue: (raw: unknown) => T }): T => {
  try {
    return input.parseValue(parse(input.text));
  } catch (error) {
    throw new Error(`Failed to parse ${input.path}: ${(error as Error).message}`, { cause: error });
  }
};

const currentShardPaths = (index: ManifestIndex): string[] =>
  index.locales.flatMap((locale) => index.pages.map((page) => `.docstube/manifest/pages/${locale}/${page.id}.yml`));

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
  const index = parseYamlOrThrow({
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
    shards.push({ path, shard: parseYamlOrThrow({ path, text, parseValue: (raw) => pageShardSchema.parse(raw) }) });
  }

  const changedPages = shards
    .filter(({ path }) => changedPaths.has(path))
    .map(({ path, shard }) => ({
      pageId: shard.page.id,
      slug: shard.page.slug,
      title: shard.page.title,
      locale: shard.locale,
      shardPath: path,
      guarantees: countPageGuarantees(shard.page),
      openFlags: shard.flags.filter(isOpenFlag)
    }))
    .toSorted((a, b) => (a.slug === b.slug ? a.locale.localeCompare(b.locale) : a.slug.localeCompare(b.slug)));

  const totals = emptyCounts();
  for (const page of changedPages) {
    totals.proven += page.guarantees.proven;
    totals.scored += page.guarantees.scored;
    totals['out-of-domain'] += page.guarantees['out-of-domain'];
  }

  const openFlags = [
    ...shards.flatMap(({ shard }) => shard.flags.filter(isOpenFlag)),
    ...index.systemFlags.filter(isOpenFlag)
  ];

  return { changedPages, totals, openFlags };
};
