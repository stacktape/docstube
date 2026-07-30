import { describe, expect, it } from 'vitest';
import type { IaNodeV2 } from '@docstube/contracts';
import { createMemoryAssessmentCache } from './assessment-cache.ts';
import { runStructurePass } from './structure-pass.ts';
import { structuralRepairLoad } from '../pipeline/refine.ts';
import { buildIaPageNode, buildStructurePageShard, scriptedAssessor } from './structure-test-support.ts';
import type { FixturePageInput } from './structure-test-support.ts';

// THE PLANTED EVAL (quality-ci-reader-v2 decision 20) — the founder's own example, made executable.
//
// A "Compute resources" nav group of EIGHT sibling pages. FIVE carry a Pricing section, three do
// not. Of those three, two genuinely should have it (they document billable compute) and ONE is
// legitimately exempt: the local emulator is a development tool that costs nothing, so "Pricing"
// on that page would be an invented section, not a fixed inconsistency.
//
// THE ASSERTION IS "EXACTLY TWO REPAIR TARGETS". That is the whole feature in one number: a system
// that emitted three targets would be doing the naive 5-of-8 arithmetic the founder rejected, and a
// system that emitted zero would be useless. The assessor's judgment — not the 62.5% prevalence —
// is what separates them.
//
// The assessor is SCRIPTED here (CI never calls a live model). What this eval proves is the
// PLUMBING: the matrix summons the question, the verdicts flow through per page, and only
// 'expected' pages survive into the finding and into refine's repair queue. Whether a real model
// returns these verdicts is a live-eval question, gated behind secrets, not a CI one.

const cohort: FixturePageInput[] = [
  // ── five siblings that carry the shared facet ──
  {
    slug: 'containers',
    title: 'Containers',
    brief: 'Long-running billable container workloads.',
    sections: ['Overview', 'Configuration', 'Pricing']
  },
  {
    slug: 'functions',
    title: 'Functions',
    brief: 'Per-invocation billable serverless functions.',
    sections: ['Overview', 'Configuration', 'Pricing']
  },
  {
    slug: 'batch-jobs',
    title: 'Batch jobs',
    brief: 'Scheduled billable batch compute.',
    sections: ['Overview', 'Configuration', 'Pricing']
  },
  {
    slug: 'web-services',
    title: 'Web services',
    brief: 'Always-on billable HTTP services.',
    sections: ['Overview', 'Configuration', 'Pricing']
  },
  {
    slug: 'private-services',
    title: 'Private services',
    brief: 'Internal-only billable services.',
    sections: ['Overview', 'Configuration', 'Pricing']
  },
  // ── three siblings that do not ──
  // Should have it: billable, exactly like its siblings.
  {
    slug: 'workers',
    title: 'Workers',
    brief: 'Background billable worker processes.',
    sections: ['Overview', 'Configuration']
  },
  // Should have it: billable, exactly like its siblings.
  {
    slug: 'gpu-instances',
    title: 'GPU instances',
    brief: 'Billable GPU-backed compute instances.',
    sections: ['Overview', 'Configuration']
  },
  // LEGITIMATELY EXEMPT: runs on the developer's own machine and is never billed.
  {
    slug: 'local-emulator',
    title: 'Local emulator',
    brief: 'Runs compute resources locally on your own machine at no cost.',
    sections: ['Overview', 'Configuration']
  }
];

describe('planted eval: sibling shared-facet asymmetry', () => {
  it('emits exactly two repair targets from 5-of-8 prevalence with one legitimate exemption', async () => {
    const shards = cohort.map((page) => buildStructurePageShard(page));
    const tree: IaNodeV2[] = [
      { kind: 'group', groupId: 'compute-resources', title: 'Compute resources', children: cohort.map(buildIaPageNode) }
    ];
    const pageIdOf = (slug: string): string => shards.find((shard) => shard.page.slug === slug)!.page.id;
    const workers = pageIdOf('workers');
    const gpuInstances = pageIdOf('gpu-instances');
    const localEmulator = pageIdOf('local-emulator');

    const assessor = scriptedAssessor(
      new Map([
        [workers, 'expected' as const],
        [gpuInstances, 'expected' as const],
        [localEmulator, 'not-applicable' as const]
      ])
    );

    const result = await runStructurePass({
      tree,
      stagedShards: shards,
      runTask: assessor.runTask,
      model: 'scripted-architect',
      cache: createMemoryAssessmentCache()
    });

    // ONE model call for the whole group — the cost-discipline rule.
    expect(assessor.calls).toHaveLength(1);
    // The prompt states the trigger without asserting the missing pages are wrong.
    expect(assessor.calls[0]?.userPrompt).toContain('Trigger: 5 of 8 comparable sibling pages have it.');

    const groupShard = result.groupShards.find((shard) => shard.groupId === 'compute-resources');
    // ONE finding for the whole cohort, not one per missing page.
    expect(groupShard?.findings).toHaveLength(1);
    const finding = groupShard!.findings[0]!;

    // THE ASSERTION.
    expect(finding.repairTargets).toHaveLength(2);
    expect(finding.repairTargets.toSorted()).toEqual([workers, gpuInstances].toSorted());
    expect(finding.repairTargets).not.toContain(localEmulator);

    // The scope still names the whole cohort (that is what was measured); only the TARGETS narrow.
    expect(finding.scope.kind === 'nav-group' && finding.scope.pageIds).toHaveLength(8);
    expect(finding.authority).toEqual({ kind: 'inferred-convention', cohortSize: 8, prevalence: 0.625 });
    expect(finding.detector.kind).toBe('ai-assessed');
    expect(finding.status).toEqual({ state: 'open' });

    // refine expands the group finding to its MINIMAL repair targets — never all eight siblings.
    const load = structuralRepairLoad(groupShard!.findings);
    expect([...load.keys()].toSorted()).toEqual([workers, gpuInstances].toSorted());
  });

  it('resolves the finding once the two targets gained the section and the group is re-evaluated', async () => {
    const repaired = cohort.map((page) =>
      page.slug === 'workers' || page.slug === 'gpu-instances'
        ? { ...page, sections: [...page.sections, 'Pricing'] }
        : page
    );
    const firstShards = cohort.map((page) => buildStructurePageShard(page));
    const tree: IaNodeV2[] = [
      { kind: 'group', groupId: 'compute-resources', title: 'Compute resources', children: cohort.map(buildIaPageNode) }
    ];
    const pageIdOf = (slug: string): string => firstShards.find((shard) => shard.page.slug === slug)!.page.id;
    const assessor = scriptedAssessor(
      new Map([
        [pageIdOf('workers'), 'expected' as const],
        [pageIdOf('gpu-instances'), 'expected' as const],
        [pageIdOf('local-emulator'), 'not-applicable' as const]
      ])
    );
    const first = await runStructurePass({
      tree,
      stagedShards: firstShards,
      runTask: assessor.runTask,
      model: 'scripted-architect'
    });

    // Second run: the two targets now carry Pricing, so the only page still lacking it is the
    // exempt one — 7 of 8, and the sole missing page is judged not-applicable again.
    const secondShards = repaired.map((page) =>
      buildStructurePageShard(page, firstShards.find((shard) => shard.page.slug === page.slug)!.page.id)
    );
    const secondAssessor = scriptedAssessor(new Map([[pageIdOf('local-emulator'), 'not-applicable' as const]]));
    const second = await runStructurePass({
      tree,
      stagedShards: secondShards,
      priorShards: new Map(firstShards.map((shard) => [shard.page.id, shard])),
      priorGroupShards: first.groupShards,
      runTask: secondAssessor.runTask,
      model: 'scripted-architect'
    });

    const groupShard = second.groupShards.find((shard) => shard.groupId === 'compute-resources');
    expect(groupShard?.findings).toHaveLength(1);
    // Auto-resolve fired because the SAME scope was re-evaluated — never because it was skipped.
    expect(groupShard?.findings[0]?.status).toEqual({ state: 'resolved' });
    expect(second.openGroupFindings).toBe(0);
  });
});
