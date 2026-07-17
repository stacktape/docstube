import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PageShard, ToolDescriptor } from '@docstube/contracts';
import { hashValue, idPrefixes, mintId, walkIaNodes } from '@docstube/contracts';
import { buildCodemap } from '@docstube/codemap';
import { loadConfigFamily } from '../config/config-io.ts';
import { CoreError } from '../errors.ts';
import { createPluginHost } from '../plugins/plugin-host.ts';
import { loadConfiguredPlugins, registerBuiltinPlugins } from '../plugins/load-plugins.ts';
import { createManifestStore } from '../state/manifest-store.ts';
import { createRunJournal } from '../state/run-journal.ts';
import { loadContextFiles } from './context-files.ts';
import { applyFlagAnswers, collectOpenQuestions, loadKnowledge } from './tribal-knowledge.ts';
import { resolveCommit } from './generate.ts';
import { generatePage } from './page-runner.ts';
import type { PageRunContext, TaskRunner } from './page-runner.ts';
import { createRunCostTracker, freezeReason } from './run-cost.ts';

// `docstube refine`: improve the lowest-quality pages first. Quality is read from the committed
// state, never an opaque score: pages with open (non-tribal) flags rank worst, then pages with
// the lowest proven-block ratio, then the stalest. Refinement is just the normal per-page loop —
// write ⇄ review∥verify → gate — with the existing shard as the id-stability baseline.

export type RefineOptions = {
  repoRoot: string;
  runTask: TaskRunner;
  toolDescriptors: ToolDescriptor[];
  // Refine only this slug.
  target?: string | undefined;
  // Consider only pages with open flags.
  failedOnly?: boolean | undefined;
  // Max pages refined in one invocation (default 3).
  maxPages?: number | undefined;
  // Max write⇄review∥verify rounds spent on a single page (default 3).
  maxRoundsPerPage?: number | undefined;
  // Global round budget across the whole invocation; refining stops when it is spent.
  totalRounds?: number | undefined;
  runId?: string | undefined;
};

export type RefinedPage = {
  slug: string;
  status: 'passed' | 'flagged';
  provenBlocksBefore: number;
  provenBlocksAfter: number;
  attempts: number;
};

export type RefineSummary = {
  runId: string;
  outcome: 'passed' | 'flagged' | 'frozen';
  refined: RefinedPage[];
  consideredCount: number;
  // Total task cost reported this run; present whenever any task carried a costUsd.
  spentUsd?: number;
};

// Rank on PROVABLE blocks only (code fences, claim-bearing prose): claimless narrative can never
// become proven, so counting it would make refine chase prose-heavy pages it cannot improve.
const countBlocks = (shard: PageShard): { total: number; proven: number } => {
  const blocks = [...shard.page.preamble, ...shard.page.sections.flatMap((section) => section.blocks)].filter(
    (block) => block.blockType === 'code-example' || block.claims.length > 0
  );
  return { total: blocks.length, proven: blocks.filter((block) => block.guarantee === 'proven').length };
};

type RankedPage = {
  slug: string;
  shard: PageShard;
  openFlags: number;
  provenRatio: number;
};

export const rankPagesForRefinement = (pages: RankedPage[]): RankedPage[] =>
  pages.toSorted((a, b) => {
    if (a.openFlags !== b.openFlags) {
      return b.openFlags - a.openFlags;
    }
    if (a.provenRatio !== b.provenRatio) {
      return a.provenRatio - b.provenRatio;
    }
    return a.shard.generatedAt < b.shard.generatedAt ? -1 : 1;
  });

export const runRefine = async (options: RefineOptions): Promise<RefineSummary> => {
  const { repoRoot } = options;
  const family = await loadConfigFamily(repoRoot);
  const { config, ia, glossary } = family;
  const locale = config.locales.source;
  const version = config.versions.current;

  const store = createManifestStore(repoRoot, version);
  const index = await store.readIndex();
  if (index === undefined) {
    throw new CoreError(
      'state-corrupt',
      'no committed manifest found — run `docstube generate` before `docstube refine`',
      {
        repoRoot
      }
    );
  }

  const host = createPluginHost();
  await registerBuiltinPlugins(host);
  await loadConfiguredPlugins(host, config, repoRoot);
  const contextFiles = await loadContextFiles(repoRoot);

  const journal = await createRunJournal(repoRoot, options.runId ?? mintId(idPrefixes.run));
  const commit = await resolveCommit(repoRoot);
  await journal.append({ type: 'run-started', mode: 'refine', commit });

  const codemap = await buildCodemap({
    repoRoot,
    commit,
    packs: host.languagePacks().map((entry) => entry.definition)
  });

  const pageIds = index.pages.map((entry) => entry.id);
  const locales = [locale, ...config.locales.targets];
  await applyFlagAnswers({ repoRoot, store, locales, pageIds });
  const knowledge = await loadKnowledge(repoRoot);
  const openQuestions = await collectOpenQuestions({ store, locales, pageIds, knowledge });

  // Rank every indexed page from committed state.
  const ranked: RankedPage[] = [];
  for (const entry of index.pages) {
    const shard = await store.readPageShard({ locale, pageId: entry.id });
    if (shard === undefined) {
      continue;
    }
    const { total, proven } = countBlocks(shard);
    ranked.push({
      slug: entry.slug,
      shard,
      // Tribal questions are not a quality defect — rewriting the page will not answer them.
      openFlags: shard.flags.filter((flag) => flag.status === 'open' && flag.kind !== 'tribal-knowledge').length,
      // Nothing provable ⇒ ratio 1: refine has no proving work to chase on that page.
      provenRatio: total === 0 ? 1 : proven / total
    });
  }

  let candidates = rankPagesForRefinement(ranked);
  if (options.target !== undefined) {
    candidates = candidates.filter((candidate) => candidate.slug === options.target);
    if (candidates.length === 0) {
      throw new CoreError('config-invalid', `no generated page with slug "${options.target}"`, {
        target: options.target
      });
    }
  }
  if (options.failedOnly === true) {
    candidates = candidates.filter((candidate) => candidate.openFlags > 0);
  }
  const selected = candidates.slice(0, options.maxPages ?? 3);

  const nodesBySlug = new Map(
    walkIaNodes(ia.tree)
      .filter((node) => node.brief !== undefined)
      .map((node) => [node.slug, node])
  );

  const maxRunUsd = config.agents.budgets.maxRunUsd;
  const costTracker = createRunCostTracker(maxRunUsd, config.agents.budgets.maxPlanUsagePercent);

  const ctx: PageRunContext = {
    repoRoot,
    host,
    codemap,
    journal,
    options: {
      runTask: options.runTask,
      toolDescriptors: options.toolDescriptors
    },
    config,
    glossary,
    criteria: contextFiles.criteria,
    instructions: contextFiles.instructions,
    knowledge,
    openQuestions,
    costTracker,
    commit,
    locale,
    version
  };

  const refined: RefinedPage[] = [];
  let roundsSpent = 0;
  let frozen = false;
  for (const candidate of selected) {
    const node = nodesBySlug.get(candidate.slug);
    if (node === undefined) {
      // Structure changes are refresh's job; refine never invents pages.
      continue;
    }
    // Cap-freeze (PRODUCT §3.5): checked only before starting a candidate — never mid-page, so a
    // half-refined page can never ship. Sits next to the totalRounds budget: both stop refining
    // between candidates, but only the cost cap marks the run frozen.
    if (costTracker.shouldFreeze()) {
      frozen = true;
      break;
    }
    // The global budget caps how many write rounds this invocation may spend in total.
    const remainingRounds = options.totalRounds === undefined ? undefined : options.totalRounds - roundsSpent;
    if (remainingRounds !== undefined && remainingRounds <= 0) {
      break;
    }
    const perPageCap = Math.min(options.maxRoundsPerPage ?? 3, remainingRounds ?? Number.MAX_SAFE_INTEGER);
    const before = countBlocks(candidate.shard);
    const { outcome, artifact, shard } = await generatePage(
      { ...ctx, options: { ...ctx.options, maxAttemptsPerPage: perPageCap } },
      node,
      candidate.shard
    );
    roundsSpent += outcome.attempts;
    const mdxTarget = join(repoRoot, config.outDir, artifact.mdxPath);
    await mkdir(dirname(mdxTarget), { recursive: true });
    await writeFile(mdxTarget, artifact.mdx, 'utf8');
    await store.writePageShard(shard);
    for (const flag of shard.flags) {
      await journal.append({ type: 'flag-raised', flag });
    }
    await journal.append({ type: 'page-status', pageId: outcome.pageId, status: outcome.status });
    refined.push({
      slug: candidate.slug,
      status: outcome.status,
      provenBlocksBefore: before.proven,
      provenBlocksAfter: countBlocks(shard).proven,
      attempts: outcome.attempts
    });
  }

  // The index survives (same pages, same ids); only its input hashes may drift.
  await store.writeIndex({ ...index, configHash: hashValue(family.raw.config), iaHash: hashValue(family.raw.ia) });

  if (frozen && maxRunUsd !== undefined) {
    await journal.append({
      type: 'run-frozen',
      reason: freezeReason({
        maxRunUsd,
        maxPlanUsagePercent: config.agents.budgets.maxPlanUsagePercent,
        planUsedPercent: costTracker.planUsedPercent()
      }),
      spentUsd: costTracker.spentUsd()
    });
  }
  const flagged = refined.some((page) => page.status === 'flagged');
  const outcome = frozen ? 'frozen' : flagged ? 'flagged' : 'passed';
  await journal.append({ type: 'run-completed', outcome });
  return {
    runId: journal.runId,
    outcome,
    refined,
    consideredCount: ranked.length,
    ...(costTracker.hasReportedCost() ? { spentUsd: costTracker.spentUsd() } : {})
  };
};
