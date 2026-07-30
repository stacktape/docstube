import type {
  ClaimCorrectness,
  Flag,
  ManifestIndex,
  PageShard,
  RiskCriticFinding,
  StructuralFinding
} from '@docstube/contracts';
import { manifestIndexSchema, pageShardSchema, structuralGroupShardSchema } from '@docstube/contracts';

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

// STRUCTURAL QUALITY IS REPORTED SEPARATELY AND NEVER GATES (quality-ci-reader-v2 decision 21).
// These counts live outside `openFlags` on purpose: `openFlags` is the merge-gate input, and a
// structural work item is not a merge condition — not even an explicit-ia-rule violation.
export type StructuralQualityDelta = {
  openPageFindings: number;
  openGroupFindings: number;
  // Enough of each to name in the PR, ordered by the stable finding key.
  open: readonly StructuralFinding[];
};

// THE RISK CRITIC'S SIDE OF ASSERTION COVERAGE, REPORTED WITH THE LINTER'S (harness-state-v2
// decision 4, PRODUCT §1.2). Like structural findings and for the same reason, these are committed
// work items and NOT merge-gate input: they stay out of `openFlags` so a model's editorial
// judgement can never withhold an auto-merge.
//
// `uncoveredAssertions` is the DETERMINISTIC FLOOR (the linter — it gates the complete badge);
// `semanticAssertionRisks` is what the critic found on top (advisory). The PR prints them together
// because either number alone tells a reader the wrong thing about how covered the page is.
export type RiskCriticDelta = {
  findings: readonly (RiskCriticFinding & { pageId: string; slug: string })[];
  semanticAssertionRisks: number;
  uncoveredAssertions: number;
  // Source-locale pages whose critic did not produce a verdict this run — never silently "clean".
  pendingPages: readonly string[];
};

export type VerifiedDelta = {
  changedPages: readonly PageDelta[];
  totals: ClaimCounts;
  // Every open flag across all readable shards plus manifest systemFlags — the merge gate input.
  openFlags: readonly Flag[];
  structural: StructuralQualityDelta;
  riskCritic: RiskCriticDelta;
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

  // Structural quality, read from the same committed state and reported entirely separately from
  // the flags above. Page findings come off the SOURCE-LOCALE shards only (renditions carry none);
  // group findings come from the shards the index declares.
  const openPageStructural = shards
    .filter(({ shard }) => shard.locale === index.sourceLocale)
    .flatMap(({ shard }) => shard.structuralFindings.filter((finding) => finding.status.state === 'open'));
  const openGroupStructural: StructuralFinding[] = [];
  for (const groupId of index.structuralGroups) {
    const path = `.docstube/manifest/structure/${groupId}.json`;
    const text = await input.readWorkspaceFile(path);
    if (text === undefined) {
      continue;
    }
    const groupShard = parseJsonOrThrow({ path, text, parseValue: (raw) => structuralGroupShardSchema.parse(raw) });
    openGroupStructural.push(...groupShard.findings.filter((finding) => finding.status.state === 'open'));
  }

  // Source-locale shards only: renditions inherit their canonical page's assessment, so counting
  // them would multiply one page's findings by its locale count.
  const sourceShards = shards.filter(({ shard }) => shard.locale === index.sourceLocale);
  const criticFindings = sourceShards.flatMap(({ shard }) =>
    (shard.provenance?.assessments.riskCritic?.completion === 'completed'
      ? shard.provenance.assessments.riskCritic.findings
      : []
    ).map((finding) => ({ ...finding, pageId: shard.page.id, slug: shard.page.slug }))
  );
  const riskCritic: RiskCriticDelta = {
    findings: criticFindings,
    semanticAssertionRisks: criticFindings.filter((finding) => finding.kind === 'unmarked-assertion').length,
    uncoveredAssertions: sourceShards.reduce(
      (total, { shard }) => total + (shard.ledger?.coverageLint.uncovered.length ?? 0),
      0
    ),
    pendingPages: sourceShards
      .filter(({ shard }) => (shard.provenance?.assessments.riskCritic?.completion ?? 'not-run') !== 'completed')
      .map(({ shard }) => shard.page.slug)
      .toSorted()
  };

  return {
    changedPages,
    totals,
    openFlags,
    riskCritic,
    structural: {
      openPageFindings: openPageStructural.length,
      openGroupFindings: openGroupStructural.length,
      open: [...openPageStructural, ...openGroupStructural].toSorted((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0
      )
    }
  };
};
