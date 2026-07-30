import type {
  AgentTaskSpec,
  IaNodeV2,
  PageShard,
  StructuralFinding,
  StructuralGroupShard,
  StructuralScope,
  StructuralSnapshot,
  ToolDescriptor,
  Transcript
} from '@docstube/contracts';
import { structuralGroupShardSchema, structuralScopeKey } from '@docstube/contracts';
import type { RunJournal } from '../state/run-journal.ts';
import type { RunCostTracker } from '../pipeline/run-cost.ts';
import { runRecordedTask } from '../pipeline/agent-task-record.ts';
import { buildStructuralSnapshot } from './structural-snapshot.ts';
import { runExplicitConsistencyRules, runOutlineIntegrityDetectors } from './structure-detectors.ts';
import { siblingFacetCandidates } from './facet-matrix.ts';
import type { FacetCandidate } from './facet-matrix.ts';
import {
  assessmentsFromTranscript,
  buildAssessGroupStructureTask,
  buildSiblingAsymmetryFinding,
  groupAssessmentCacheKey
} from './group-assessor.ts';
import type { GroupAssessment } from './group-assessor.ts';
import { isOpenStructuralFinding, reconcileStructuralFindings } from './structural-lifecycle.ts';
import type { StructuralAssessmentCache } from './assessment-cache.ts';

// THE STRUCTURE PASS (quality-ci-reader-v2 decision 18). It runs over the STAGED canonical site,
// after every page has landed and BEFORE publish, because that is the only moment the whole shape
// of what the reader is about to get exists in one place.
//
// It is INCREMENTAL by construction:
//   - the outline index is rebuilt globally (cheap, no model, pure function of the staged shards);
//   - page checks run only for pages whose canonical content changed;
//   - group checks run only for the groups a changed page belongs to — or LEFT.
//
// It is NON-BLOCKING by construction: nothing it produces is a Finding, a Flag, or a claim. It
// returns committed work items and warnings. A pass that cannot run at all (no task runner, budget
// exhausted) records the affected scopes as PENDING and lets the run publish (decision 21).

// Structurally identical to the pipeline's TaskRunner, declared here rather than imported so the
// structure module never pulls in the per-page loop.
type StructureTaskTool = { descriptor: ToolDescriptor; handler: (args: unknown) => Promise<unknown> };

export type StructurePassTaskRunner = (spec: AgentTaskSpec, extraTools?: StructureTaskTool[]) => Promise<Transcript>;

export type StructurePassInput = {
  tree: readonly IaNodeV2[];
  // Staged source-locale shards — the pages this run is about to publish.
  stagedShards: readonly PageShard[];
  // Committed source-locale shards this run started from, by page id: the change signal AND the
  // prior page findings to reconcile against.
  priorShards?: ReadonlyMap<string, PageShard> | undefined;
  priorGroupShards?: readonly StructuralGroupShard[] | undefined;
  // Omitted → no AI adjudication happens at all and every candidate group is recorded pending.
  // Sibling-convention candidates NEVER become findings without it (decision 19's ladder).
  runTask?: StructurePassTaskRunner | undefined;
  // The model the architect role routes to — persisted on the finding's detector record and part
  // of the assessment cache key.
  model?: string | undefined;
  cache?: StructuralAssessmentCache | undefined;
  journal?: RunJournal | undefined;
  costTracker?: RunCostTracker | undefined;
  generatedAt?: string | undefined;
};

export type StructurePassResult = {
  snapshot: StructuralSnapshot;
  // Reconciled page-scoped findings by page id — what each staged page shard must carry.
  pageFindings: Map<string, StructuralFinding[]>;
  // One shard per nav group currently in the IA.
  groupShards: StructuralGroupShard[];
  warnings: string[];
  // Counts for the dashboard/NavTree and the PR summary. Open findings ONLY: resolved and
  // suppressed records stay committed but are not work.
  openPageFindings: number;
  openGroupFindings: number;
  // Groups the pass deliberately did not assess (no runner, or budget exhausted).
  pendingScopes: StructuralScope[];
  // Model calls this pass actually made — the cost-discipline assertion (decision 7).
  assessmentsRequested: number;
  assessmentsFromCache: number;
};

const pageChanged = (staged: PageShard, prior: PageShard | undefined): boolean => {
  if (prior === undefined) {
    return true;
  }
  // The MDX↔shard binding hash IS the canonical content identity. A shard without one (pre-hash
  // state) is treated as changed: unknown is never "unchanged".
  return (
    staged.mdxContentHash === undefined ||
    prior.mdxContentHash === undefined ||
    staged.mdxContentHash !== prior.mdxContentHash
  );
};

export const runStructurePass = async (input: StructurePassInput): Promise<StructurePassResult> => {
  const priorShards = input.priorShards ?? new Map<string, PageShard>();
  const priorGroupShards = input.priorGroupShards ?? [];
  const warnings: string[] = [];

  const shardsBySlug = new Map(input.stagedShards.map((shard) => [shard.page.slug, shard]));
  const changedPageIds = input.stagedShards
    .filter((shard) => pageChanged(shard, priorShards.get(shard.page.id)))
    .map((shard) => shard.page.id);

  const snapshot = buildStructuralSnapshot({
    tree: input.tree,
    shardsBySlug,
    changedPageIds,
    priorFindingKeys: [
      ...[...priorShards.values()].flatMap((shard) => shard.structuralFindings.map((finding) => finding.key)),
      ...priorGroupShards.flatMap((shard) => shard.findings.map((finding) => finding.key))
    ],
    ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt })
  });

  const changed = new Set(changedPageIds);
  // A group is re-evaluated when a changed page is in it NOW, or was in it at the last evaluation
  // (the "group the page LEFT" case — otherwise a page moving out would strand a finding that
  // names a cohort it is no longer part of).
  const groupsWithChange = new Set(
    snapshot.groups.filter((group) => group.pageIds.some((pageId) => changed.has(pageId))).map((group) => group.groupId)
  );
  for (const shard of priorGroupShards) {
    if (shard.pageIds.some((pageId) => changed.has(pageId))) {
      groupsWithChange.add(shard.groupId);
    }
  }

  // ── deterministic detectors ────────────────────────────────────────────────────────────────
  const freshPageFindings = new Map<string, StructuralFinding[]>();
  for (const page of snapshot.pages) {
    if (!changed.has(page.pageId)) {
      continue;
    }
    freshPageFindings.set(page.pageId, runOutlineIntegrityDetectors(page));
  }

  const freshGroupFindings = new Map<string, StructuralFinding[]>();
  const addGroupFinding = (finding: StructuralFinding): void => {
    if (finding.scope.kind !== 'nav-group') {
      return;
    }
    const groupId = finding.scope.groupId;
    freshGroupFindings.set(groupId, [...(freshGroupFindings.get(groupId) ?? []), finding]);
  };
  for (const finding of runExplicitConsistencyRules(snapshot)) {
    if (finding.scope.kind === 'nav-group' && groupsWithChange.has(finding.scope.groupId)) {
      addGroupFinding(finding);
    }
  }

  // ── the flagship: candidates, then per-page AI applicability ───────────────────────────────
  const candidates = siblingFacetCandidates(snapshot).filter((candidate) => groupsWithChange.has(candidate.groupId));
  // AT MOST ONE ASSESSMENT PER CHANGED GROUP (decision 7). When several facets in the same group
  // cross the threshold, the strongest convention is the one worth paying for; the rest wait for a
  // later run, and their group scope is NOT marked evaluated so nothing auto-resolves behind them.
  const bestByGroup = new Map<string, FacetCandidate>();
  const deferredCandidates: FacetCandidate[] = [];
  for (const candidate of candidates) {
    const incumbent = bestByGroup.get(candidate.groupId);
    if (incumbent === undefined) {
      bestByGroup.set(candidate.groupId, candidate);
      continue;
    }
    if (candidate.prevalence > incumbent.prevalence) {
      bestByGroup.set(candidate.groupId, candidate);
      deferredCandidates.push(incumbent);
      continue;
    }
    deferredCandidates.push(candidate);
  }

  const assessedGroups = new Set<string>();
  const pendingGroupIds = new Set<string>(deferredCandidates.map((candidate) => candidate.groupId));
  let assessmentsRequested = 0;
  let assessmentsFromCache = 0;

  for (const candidate of bestByGroup.values()) {
    const model = input.model;
    if (input.runTask === undefined || model === undefined) {
      pendingGroupIds.add(candidate.groupId);
      continue;
    }
    const cacheKey = groupAssessmentCacheKey({ candidate, model });
    let assessments: GroupAssessment[] | undefined = await input.cache?.read(cacheKey);
    if (assessments === undefined) {
      // Budget check, between candidates only — the same rule the page loop follows. A pass that
      // cannot afford the call records the scope pending; publishing is still allowed (decision 21).
      if (input.costTracker?.shouldFreeze() === true) {
        pendingGroupIds.add(candidate.groupId);
        continue;
      }
      const task = buildAssessGroupStructureTask(candidate);
      const transcript =
        input.journal === undefined
          ? await input.runTask(task)
          : await runRecordedTask({
              runTask: input.runTask as Parameters<typeof runRecordedTask>[0]['runTask'],
              journal: input.journal,
              task,
              ...(input.costTracker === undefined ? {} : { costTracker: input.costTracker })
            });
      assessmentsRequested += 1;
      const parsed = assessmentsFromTranscript(transcript, candidate);
      warnings.push(...parsed.warnings);
      assessments = parsed.assessments;
      await input.cache?.write({ key: cacheKey, model, assessments });
    } else {
      assessmentsFromCache += 1;
    }
    assessedGroups.add(candidate.groupId);
    const finding = buildSiblingAsymmetryFinding({ candidate, assessments, model });
    if (finding !== undefined) {
      addGroupFinding(finding);
    }
  }

  // ── lifecycle reconciliation ───────────────────────────────────────────────────────────────
  const pageFindings = new Map<string, StructuralFinding[]>();
  for (const shard of input.stagedShards) {
    const pageId = shard.page.id;
    const reconciled = reconcileStructuralFindings({
      prior: priorShards.get(pageId)?.structuralFindings ?? [],
      fresh: freshPageFindings.get(pageId) ?? [],
      evaluatedScopeKeys: changed.has(pageId) ? [structuralScopeKey({ kind: 'entity', pageId })] : []
    });
    pageFindings.set(pageId, reconciled);
  }

  const priorGroupById = new Map(priorGroupShards.map((shard) => [shard.groupId, shard]));
  const generatedAt = snapshot.generatedAt;
  const groupShards = snapshot.groups.map((group) => {
    // A group is only "evaluated" — and therefore only allowed to auto-resolve — when EVERY check
    // it owns actually ran. A group whose assessment was deferred or unaffordable is left alone.
    const evaluated = groupsWithChange.has(group.groupId) && !pendingGroupIds.has(group.groupId);
    return structuralGroupShardSchema.parse({
      schemaVersion: 1,
      groupId: group.groupId,
      generatedAt,
      pageIds: group.pageIds,
      findings: reconcileStructuralFindings({
        prior: priorGroupById.get(group.groupId)?.findings ?? [],
        fresh: freshGroupFindings.get(group.groupId) ?? [],
        evaluatedScopeKeys: evaluated
          ? [structuralScopeKey({ kind: 'nav-group', groupId: group.groupId, pageIds: group.pageIds })]
          : []
      })
    });
  });

  const pendingScopes: StructuralScope[] = snapshot.groups
    .filter((group) => pendingGroupIds.has(group.groupId) && group.pageIds.length > 0)
    .map((group) => ({ kind: 'nav-group', groupId: group.groupId, pageIds: group.pageIds }));

  return {
    snapshot: { ...snapshot, pendingScopes },
    pageFindings,
    groupShards,
    warnings,
    openPageFindings: [...pageFindings.values()].flat().filter(isOpenStructuralFinding).length,
    openGroupFindings: groupShards.flatMap((shard) => shard.findings).filter(isOpenStructuralFinding).length,
    pendingScopes,
    assessmentsRequested,
    assessmentsFromCache
  };
};

// The one sentence the PR summary and the dashboard both render (decision 21). It is a SEPARATE
// surface from the flag queue and it always says nonblocking — a structural finding is a work item,
// never a merge gate.
export const structuralSummaryLine = (input: { openPageFindings: number; openGroupFindings: number }): string => {
  const open = input.openPageFindings + input.openGroupFindings;
  return `Structural quality: ${open} open · nonblocking`;
};
