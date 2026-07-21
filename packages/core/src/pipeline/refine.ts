import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { IaPageNodeV2, PageShard, ToolDescriptor } from '@docstube/contracts';
import { convertIaToV2, hashValue, idPrefixes, mintId, walkIaV2Nodes } from '@docstube/contracts';
import { buildCodemap, buildFingerprintSnapshot } from '@docstube/codemap';
import { loadConfigFamily } from '../config/config-io.ts';
import { CoreError } from '../errors.ts';
import { createPluginHost } from '../plugins/plugin-host.ts';
import { loadConfiguredPlugins, registerBuiltinPlugins } from '../plugins/load-plugins.ts';
import { createManifestStore } from '../state/manifest-store.ts';
import { createRunJournal, journalRunFailure } from '../state/run-journal.ts';
import { loadContextFiles } from './context-files.ts';
import { applyFlagAnswers, collectOpenQuestions, loadKnowledge } from './tribal-knowledge.ts';
import { dirtyWorkingTreeWarning, resolveSourceRevision } from './generate.ts';
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
  checkedClaimsBefore: number;
  checkedClaimsAfter: number;
  attempts: number;
};

export type RefineSummary = {
  runId: string;
  outcome: 'passed' | 'flagged' | 'frozen';
  refined: RefinedPage[];
  consideredCount: number;
  // Total task cost reported this run; present whenever any task carried a costUsd.
  spentUsd?: number;
  // Conservative token-derived spend for tasks that carried no costUsd; present when any task's
  // spend had to be estimated. Display totals as "(partly estimated)" when set.
  estimatedUsd?: number;
  // Latest subscription plan usage (0-100) reported by the transport this run, when available.
  planUsedPercent?: number;
};

// Rank on the canonical claim ledger (ClaimEvidence): checked claims over total claims. A page
// with no claims has no checking work for refine to chase.
const countClaims = (shard: PageShard): { total: number; checked: number } => {
  const records = shard.provenance?.claimEvidence ?? [];
  return { total: records.length, checked: records.filter((record) => record.correctness === 'checked').length };
};

type RankedPage = {
  slug: string;
  shard: PageShard;
  openFlags: number;
  checkedRatio: number;
};

export const rankPagesForRefinement = (pages: RankedPage[]): RankedPage[] =>
  pages.toSorted((a, b) => {
    if (a.openFlags !== b.openFlags) {
      return b.openFlags - a.openFlags;
    }
    if (a.checkedRatio !== b.checkedRatio) {
      return a.checkedRatio - b.checkedRatio;
    }
    if (a.shard.generatedAt !== b.shard.generatedAt) {
      return a.shard.generatedAt < b.shard.generatedAt ? -1 : 1;
    }
    // Full ties break on slug so the comparator stays antisymmetric — a `return 1` on equal
    // inputs makes the final order engine-dependent.
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
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
  // Any escaping error journals a terminal 'failed' outcome first — a crashed run must never
  // read as still running (journalRunFailure rethrows).
  try {
    const { commit, dirtyWorkingTree } = await resolveSourceRevision(repoRoot);
    await journal.append({ type: 'run-started', mode: 'refine', commit });
    if (dirtyWorkingTree) {
      await journal.append({ type: 'findings', findings: [dirtyWorkingTreeWarning(commit)] });
    }

    const packs = host.languagePacks().map((entry) => entry.definition);
    const codemap = await buildCodemap({ repoRoot, commit, packs });
    // Claim subscriptions resolve against the typed-fingerprint snapshot during anchoring.
    const fingerprints = await buildFingerprintSnapshot({ repoRoot, commit, packs });

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
      const { total, checked } = countClaims(shard);
      ranked.push({
        slug: entry.slug,
        shard,
        // Tribal questions are not a quality defect — rewriting the page will not answer them.
        openFlags: shard.flags.filter((flag) => flag.status === 'open' && flag.kind !== 'tribal-knowledge').length,
        // No claims ⇒ ratio 1: refine has no checking work to chase on that page.
        checkedRatio: total === 0 ? 1 : checked / total
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

    // ia.yml v2 at pipeline entry (finding 6): page nodes carry the gating primary persona.
    const iaV2 = convertIaToV2(ia, { defaultPrimaryPersona: config.personas[0]?.id ?? 'reader' });
    const nodesBySlug = new Map(
      walkIaV2Nodes(iaV2.tree)
        .filter((node): node is IaPageNodeV2 => node.kind === 'page')
        .map((node) => [node.slug, node])
    );

    const maxRunUsd = config.agents.budgets.maxRunUsd;
    const costTracker = createRunCostTracker(maxRunUsd, config.agents.budgets.maxPlanUsagePercent);

    const ctx: PageRunContext = {
      repoRoot,
      host,
      codemap,
      fingerprints,
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
      dirtyWorkingTree,
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
      const before = countClaims(candidate.shard);
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
        checkedClaimsBefore: before.checked,
        checkedClaimsAfter: countClaims(shard).checked,
        attempts: outcome.attempts
      });
    }

    // The index survives (same pages, same ids); only its input hashes may drift.
    await store.writeIndex({ ...index, configHash: hashValue(family.raw.config), iaHash: hashValue(family.raw.ia) });

    // A plan-usage freeze can trip with no dollar cap configured, so the event is guarded on the
    // freeze alone — never on maxRunUsd being set. Spend includes token-derived estimates so an
    // estimate-triggered freeze never journals $0.
    if (frozen) {
      await journal.append({
        type: 'run-frozen',
        reason: freezeReason({
          maxRunUsd,
          maxPlanUsagePercent: config.agents.budgets.maxPlanUsagePercent,
          planUsedPercent: costTracker.planUsedPercent()
        }),
        spentUsd: costTracker.spentUsd() + costTracker.estimatedUsd()
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
      ...(costTracker.hasReportedCost() ? { spentUsd: costTracker.spentUsd() } : {}),
      ...(costTracker.hasEstimates() ? { estimatedUsd: costTracker.estimatedUsd() } : {}),
      ...(costTracker.planUsedPercent() !== undefined ? { planUsedPercent: costTracker.planUsedPercent() } : {})
    };
  } catch (error) {
    return journalRunFailure(journal, error);
  }
};
