import { describe, expect, it } from 'vitest';
import type { IaNodeV2, PageShard } from '@docstube/contracts';
import { createMemoryAssessmentCache } from './assessment-cache.ts';
import { runStructurePass, structuralSummaryLine } from './structure-pass.ts';
import { buildIaPageNode, buildStructurePageShard, scriptedAssessor } from './structure-test-support.ts';
import type { FixturePageInput } from './structure-test-support.ts';

const group = (children: IaNodeV2[]): IaNodeV2 => ({
  kind: 'group',
  groupId: 'compute-resources',
  title: 'Compute resources',
  children
});

const buildWorld = (pages: readonly FixturePageInput[]): { tree: IaNodeV2[]; shards: PageShard[] } => {
  const shards = pages.map((page) => buildStructurePageShard(page));
  return { tree: [group(pages.map(buildIaPageNode))], shards };
};

describe('structure pass', () => {
  it('emits deterministic outline-integrity findings with no model in the loop', async () => {
    const { tree, shards } = buildWorld([
      { slug: 'containers', sections: ['Overview', 'Pricing'], emptySections: ['Pricing'] }
    ]);
    const result = await runStructurePass({ tree, stagedShards: shards });
    const findings = result.pageFindings.get(shards[0]!.page.id) ?? [];
    expect(findings.map((finding) => finding.code)).toEqual(['structure.empty-section']);
    expect(result.assessmentsRequested).toBe(0);
    expect(result.openPageFindings).toBe(1);
  });

  it('never turns a sibling-convention candidate into a finding without AI adjudication', async () => {
    const { tree, shards } = buildWorld([
      { slug: 'containers', sections: ['Overview', 'Pricing'] },
      { slug: 'functions', sections: ['Overview', 'Pricing'] },
      { slug: 'batch-jobs', sections: ['Overview', 'Pricing'] },
      { slug: 'workers', sections: ['Overview'] }
    ]);
    // No runTask: the ladder says an inferred convention is a CANDIDATE ONLY.
    const result = await runStructurePass({ tree, stagedShards: shards });
    expect(result.openGroupFindings).toBe(0);
    expect(result.pendingScopes.map((scope) => scope.kind === 'nav-group' && scope.groupId)).toEqual([
      'compute-resources'
    ]);
  });

  it('emits ONE group finding naming only the pages judged expected', async () => {
    const { tree, shards } = buildWorld([
      { slug: 'containers', sections: ['Overview', 'Pricing'] },
      { slug: 'functions', sections: ['Overview', 'Pricing'] },
      { slug: 'batch-jobs', sections: ['Overview', 'Pricing'] },
      { slug: 'workers', sections: ['Overview'] },
      { slug: 'gpus', sections: ['Overview'] }
    ]);
    const workers = shards[3]!.page.id;
    const gpus = shards[4]!.page.id;
    const assessor = scriptedAssessor(
      new Map([
        [workers, 'expected' as const],
        [gpus, 'not-applicable' as const]
      ])
    );
    const result = await runStructurePass({
      tree,
      stagedShards: shards,
      runTask: assessor.runTask,
      model: 'scripted-architect',
      cache: createMemoryAssessmentCache()
    });
    const groupShard = result.groupShards.find((shard) => shard.groupId === 'compute-resources');
    expect(groupShard?.findings).toHaveLength(1);
    const finding = groupShard?.findings[0];
    expect(finding?.code).toBe('structure.sibling-facet-asymmetry');
    expect(finding?.detector).toEqual({
      kind: 'ai-assessed',
      id: 'sibling-facet-asymmetry',
      version: '1',
      model: 'scripted-architect'
    });
    expect(finding?.repairTargets).toEqual([workers]);
    // The cleared sibling is never named as work: it stays in the measured cohort (that IS the
    // scope) but appears in no repair target and in no evidence item.
    expect(finding?.repairTargets).not.toContain(gpus);
    expect(finding?.evidence.map((item) => item.pageId)).toEqual([workers]);
    // Never "verified defect".
    expect(finding?.message).toContain('AI-assessed structural inconsistency');
  });

  it('emits no finding at all when the assessor is uncertain', async () => {
    const { tree, shards } = buildWorld([
      { slug: 'containers', sections: ['Overview', 'Pricing'] },
      { slug: 'functions', sections: ['Overview', 'Pricing'] },
      { slug: 'batch-jobs', sections: ['Overview', 'Pricing'] },
      { slug: 'workers', sections: ['Overview'] }
    ]);
    const assessor = scriptedAssessor(new Map([[shards[3]!.page.id, 'uncertain' as const]]));
    const result = await runStructurePass({
      tree,
      stagedShards: shards,
      runTask: assessor.runTask,
      model: 'scripted-architect'
    });
    expect(result.openGroupFindings).toBe(0);
    expect(assessor.calls).toHaveLength(1);
  });

  it('reuses a cached assessment instead of re-billing an unchanged cohort', async () => {
    const { tree, shards } = buildWorld([
      { slug: 'containers', sections: ['Overview', 'Pricing'] },
      { slug: 'functions', sections: ['Overview', 'Pricing'] },
      { slug: 'batch-jobs', sections: ['Overview', 'Pricing'] },
      { slug: 'workers', sections: ['Overview'] }
    ]);
    const assessor = scriptedAssessor(new Map([[shards[3]!.page.id, 'expected' as const]]));
    const cache = createMemoryAssessmentCache();
    const options = {
      tree,
      stagedShards: shards,
      runTask: assessor.runTask,
      model: 'scripted-architect',
      cache
    };
    const first = await runStructurePass(options);
    const second = await runStructurePass(options);
    expect(first.assessmentsRequested).toBe(1);
    expect(second.assessmentsRequested).toBe(0);
    expect(second.assessmentsFromCache).toBe(1);
    expect(assessor.calls).toHaveLength(1);
    expect(second.openGroupFindings).toBe(1);
  });

  it('runs page checks only for changed pages and carries untouched findings forward', async () => {
    const { tree, shards } = buildWorld([
      { slug: 'containers', sections: ['Overview'], emptySections: ['Overview'] },
      { slug: 'functions', sections: ['Overview', 'Pricing'] }
    ]);
    const first = await runStructurePass({ tree, stagedShards: shards });
    const priorShards = new Map(
      shards.map((shard) => [
        shard.page.id,
        { ...shard, structuralFindings: first.pageFindings.get(shard.page.id) ?? [] }
      ])
    );
    // Nothing changed: no page is re-evaluated, and the records survive exactly as they were.
    const second = await runStructurePass({ tree, stagedShards: shards, priorShards });
    expect(second.snapshot.changedScopes).toEqual([]);
    expect(second.openPageFindings).toBe(1);
  });

  it('records a group scope pending instead of paying for it when the budget is exhausted', async () => {
    const { tree, shards } = buildWorld([
      { slug: 'containers', sections: ['Overview', 'Pricing'] },
      { slug: 'functions', sections: ['Overview', 'Pricing'] },
      { slug: 'batch-jobs', sections: ['Overview', 'Pricing'] },
      { slug: 'workers', sections: ['Overview'] }
    ]);
    const assessor = scriptedAssessor(new Map([[shards[3]!.page.id, 'expected' as const]]));
    const result = await runStructurePass({
      tree,
      stagedShards: shards,
      runTask: assessor.runTask,
      model: 'scripted-architect',
      costTracker: { shouldFreeze: () => true } as never
    });
    expect(assessor.calls).toHaveLength(0);
    expect(result.pendingScopes).toHaveLength(1);
    expect(result.openGroupFindings).toBe(0);
  });

  it('re-evaluates the group a changed page LEFT', async () => {
    const { tree, shards } = buildWorld([{ slug: 'containers', sections: ['Overview'] }]);
    const strandedPageId = 'pg_00000000000000000099';
    const result = await runStructurePass({
      tree,
      stagedShards: shards,
      priorGroupShards: [
        {
          schemaVersion: 1,
          groupId: 'compute-resources',
          generatedAt: '2026-07-12T00:00:00.000Z',
          // The page that used to live here is gone from the staged site entirely.
          pageIds: [shards[0]!.page.id, strandedPageId],
          findings: []
        }
      ]
    });
    expect(result.groupShards.map((shard) => shard.pageIds)).toEqual([[shards[0]!.page.id]]);
  });

  it('always says nonblocking', () => {
    expect(structuralSummaryLine({ openPageFindings: 2, openGroupFindings: 1 })).toBe(
      'Structural quality: 3 open · nonblocking'
    );
  });
});
