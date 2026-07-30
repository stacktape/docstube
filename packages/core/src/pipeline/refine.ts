import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { IaPageNodeV2, PageShard, StructuralFinding, ToolDescriptor } from '@docstube/contracts';
import { convertIaToV2, hashValue, idPrefixes, mintId, walkIaV2Nodes } from '@docstube/contracts';
import { buildCodemap, buildFingerprintSnapshot } from '@docstube/codemap';
import { loadConfigFamily } from '../config/config-io.ts';
import { CoreError } from '../errors.ts';
import { createPluginHost } from '../plugins/plugin-host.ts';
import { loadConfiguredPlugins, registerBuiltinPlugins } from '../plugins/load-plugins.ts';
import { createManifestStore } from '../state/manifest-store.ts';
import { createRunJournal, journalRunFailure } from '../state/run-journal.ts';
import { loadContextFiles } from './context-files.ts';
import { openKnowledgeForRun } from '../knowledge/knowledge-lifecycle.ts';
import {
  dirtyTreeEndOfRunSweep,
  dirtyWorkingTreeWarning,
  docstubeOwnOutputPrefixes,
  prunedShardsFinding,
  readSourceFiles,
  resolveSourceRevision,
  unversionedReadSources
} from './generate.ts';
import { generatePage } from './page-runner.ts';
import type { PageRunContext, TaskRunner } from './page-runner.ts';
import { createRunCostTracker, freezeReason } from './run-cost.ts';
import { resolveRoleRouting } from './agent-role-routing.ts';
import { createRiskCriticCache } from './risk-critic-cache.ts';
import type { RoleSpend } from './run-cost.ts';

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
  // Keys of the open structural findings that named this page as a repair target — why refine
  // picked it. Empty when the page was selected on the older quality signals alone. The findings
  // themselves are NOT resolved here: auto-resolve requires the structure pass to re-evaluate the
  // scope (decision 17), which only `generate` does.
  structuralFindingKeys: string[];
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
  // Spend attributed to the routing role that incurred it (agents.roles) — the input to "where did
  // the money go?", and to deciding which role is worth moving to a cheaper model.
  spendByRole: RoleSpend[];
  // Latest subscription plan usage (0-100) reported by the transport this run, when available.
  planUsedPercent?: number;
};

// Rank on the canonical claim ledger (ClaimEvidence): checked claims over total claims. A page
// with no claims has no checking work for refine to chase.
const countClaims = (shard: PageShard): { total: number; checked: number } => {
  const records = shard.provenance?.claimEvidence ?? [];
  return { total: records.length, checked: records.filter((record) => record.correctness === 'checked').length };
};

// STRUCTURAL REPAIR TARGETS (quality-ci-reader-v2 decision 22). A group finding expands to its
// MINIMAL targets — the pages the assessor judged 'expected' — and never to the whole cohort:
// rerolling all eight siblings because three lack a section is precisely the waste the group
// assessor exists to prevent. "Auto-repairable" means the finding names pages a regeneration could
// plausibly fix; a finding with no repair targets is a work item for a human, not for refine.
export type StructuralRepairLoad = {
  // 0 = high, 1 = medium, 2 = low. The WORST open impact targeting this page.
  worstImpact: number;
  count: number;
  findingKeys: string[];
};

const impactRank = { high: 0, medium: 1, low: 2 } as const;

export const structuralRepairLoad = (findings: readonly StructuralFinding[]): Map<string, StructuralRepairLoad> => {
  const load = new Map<string, StructuralRepairLoad>();
  for (const finding of findings) {
    if (finding.status.state !== 'open' || finding.repairTargets.length === 0) {
      continue;
    }
    for (const pageId of finding.repairTargets) {
      const current = load.get(pageId) ?? { worstImpact: Number.MAX_SAFE_INTEGER, count: 0, findingKeys: [] };
      load.set(pageId, {
        worstImpact: Math.min(current.worstImpact, impactRank[finding.impact]),
        count: current.count + 1,
        findingKeys: [...current.findingKeys, finding.key].toSorted()
      });
    }
  }
  return load;
};

type RankedPage = {
  slug: string;
  shard: PageShard;
  openFlags: number;
  checkedRatio: number;
  // Undefined when no open auto-repairable structural finding names this page.
  structural?: StructuralRepairLoad | undefined;
};

export const rankPagesForRefinement = (pages: RankedPage[]): RankedPage[] =>
  pages.toSorted((a, b) => {
    // OPEN AUTO-REPAIRABLE STRUCTURAL FINDINGS RANK FIRST, impact-ordered (decision 22). They are
    // the concrete, named, already-adjudicated work — a page with a high-impact structural target
    // is a better use of a reroll than a page that merely looks stale.
    const aImpact = a.structural?.worstImpact ?? Number.MAX_SAFE_INTEGER;
    const bImpact = b.structural?.worstImpact ?? Number.MAX_SAFE_INTEGER;
    if (aImpact !== bImpact) {
      return aImpact - bImpact;
    }
    const aCount = a.structural?.count ?? 0;
    const bCount = b.structural?.count ?? 0;
    if (aCount !== bCount) {
      return bCount - aCount;
    }
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
    const ownOutputs = docstubeOwnOutputPrefixes(config);
    const { commit, dirtyWorkingTree: treeDirtyAtStart, treeState } = await resolveSourceRevision(repoRoot, ownOutputs);
    await journal.append({ type: 'run-started', mode: 'refine', commit });
    if (treeDirtyAtStart) {
      await journal.append({ type: 'findings', findings: [dirtyWorkingTreeWarning(commit, [], treeState)] });
    }

    const packs = host.languagePacks().map((entry) => entry.definition);
    const codemap = await buildCodemap({ repoRoot, commit, packs });
    // Claim subscriptions resolve against the typed-fingerprint snapshot during anchoring.
    const fingerprints = await buildFingerprintSnapshot({ repoRoot, commit, packs });

    // Unversioned sources count as uncommitted (wave 2b close): `git status` never reports ignored
    // files, so a clean-reporting tree can still have been read for bytes no commit contains. The
    // diff runs even on an already-dirty tree so the warning can NAME the offending paths instead
    // of degrading to the generic line (wave 2b close, run-diagnostics finding).
    const unversionedSources = await unversionedReadSources({
      repoRoot,
      files: readSourceFiles({ codemap, fingerprints }),
      ownOutputPrefixes: ownOutputs
    });
    if (unversionedSources.length > 0) {
      await journal.append({
        type: 'findings',
        findings: [dirtyWorkingTreeWarning(commit, unversionedSources, treeState)]
      });
    }
    const dirtyWorkingTree = treeDirtyAtStart || unversionedSources.length > 0;

    const pageIds = index.pages.map((entry) => entry.id);
    const locales = [locale, ...config.locales.targets];
    const knowledge = await openKnowledgeForRun({
      repoRoot,
      store,
      locales,
      pageIds,
      fingerprints,
      runId: journal.runId
    });

    // Structural work items the refine ranking consumes: page findings live on the page shards,
    // group findings in the per-group structural shards. Both are read BEFORE ranking so a group
    // finding can pull its named pages up the queue.
    const structuralFindings: StructuralFinding[] = [];
    for (const groupId of await store.listStructuralGroupIds()) {
      const groupShard = await store.readStructuralShard(groupId);
      structuralFindings.push(...(groupShard?.findings ?? []));
    }

    // Rank every indexed page from committed state.
    const ranked: RankedPage[] = [];
    const shardsById = new Map<string, PageShard>();
    for (const entry of index.pages) {
      const shard = await store.readPageShard({ locale, pageId: entry.id });
      if (shard === undefined) {
        continue;
      }
      shardsById.set(entry.id, shard);
      structuralFindings.push(...shard.structuralFindings);
    }
    const repairLoad = structuralRepairLoad(structuralFindings);
    for (const entry of index.pages) {
      const shard = shardsById.get(entry.id);
      if (shard === undefined) {
        continue;
      }
      const load = repairLoad.get(entry.id);
      const { total, checked } = countClaims(shard);
      ranked.push({
        slug: entry.slug,
        shard,
        ...(load === undefined ? {} : { structural: load }),
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
        toolDescriptors: options.toolDescriptors,
        // `refine` regenerates pages, so it re-assesses them too — and shares the same cache, so a
        // refine that did not actually change a page's prose or ledger never re-bills the critic.
        riskCriticModel: resolveRoleRouting(config, 'risk-critic').model,
        riskCriticCache: createRiskCriticCache(repoRoot)
      },
      config,
      glossary,
      criteria: contextFiles.criteria,
      instructions: contextFiles.instructions,
      knowledge: knowledge.session,
      costTracker,
      commit,
      dirtyWorkingTree,
      locale,
      version
    };

    const refined: RefinedPage[] = [];
    // Shards persisted this run — the end-of-run dirty-tree sweep re-marks exactly these.
    const persistedShards: Array<{ locale: string; pageId: string }> = [];
    let roundsSpent = 0;
    let frozen = false;
    for (const candidate of selected) {
      const node = nodesBySlug.get(candidate.slug);
      if (node === undefined) {
        // Structure changes are maintain's job; refine never invents pages.
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
      persistedShards.push({ locale: shard.locale, pageId: shard.page.id });
      for (const flag of shard.flags) {
        await journal.append({ type: 'flag-raised', flag });
      }
      await journal.append({ type: 'page-status', pageId: outcome.pageId, status: outcome.status });
      refined.push({
        slug: candidate.slug,
        status: outcome.status,
        checkedClaimsBefore: before.checked,
        checkedClaimsAfter: countClaims(shard).checked,
        attempts: outcome.attempts,
        structuralFindingKeys: candidate.structural?.findingKeys ?? []
      });
    }

    // The index survives (same pages, same ids); only its input hashes may drift.
    const { pruned } = await store.writeIndex({
      ...index,
      configHash: hashValue(family.raw.config),
      iaHash: hashValue(family.raw.ia)
    });
    if (pruned.length > 0) {
      await journal.append({ type: 'findings', findings: [prunedShardsFinding(pruned)] });
    }

    // Dirty-tree honesty, end-of-run recheck (impl-09 finding 3): refine writes evidence-bearing
    // shards exactly like generate/maintain, so a tree that mutated mid-run marks every shard this
    // run persisted with the dirtyWorkingTree lineage marker and journals a warning. Own outputs
    // (manifest + site) are excluded — the run's expected writes are not dirt (impl-10 finding 4).
    await dirtyTreeEndOfRunSweep({
      repoRoot,
      store,
      journal,
      commit,
      dirtyAtStart: dirtyWorkingTree,
      treeStateAtStart: treeState,
      ownOutputPrefixes: ownOutputs,
      persistedShards
    });

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
      spendByRole: costTracker.spendByRole(),
      ...(costTracker.hasReportedCost() ? { spentUsd: costTracker.spentUsd() } : {}),
      ...(costTracker.hasEstimates() ? { estimatedUsd: costTracker.estimatedUsd() } : {}),
      ...(costTracker.planUsedPercent() !== undefined ? { planUsedPercent: costTracker.planUsedPercent() } : {})
    };
  } catch (error) {
    return journalRunFailure(journal, error);
  }
};
