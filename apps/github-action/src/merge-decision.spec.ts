import { describe, expect, it } from 'vitest';
import { autoMergeBlockingFlagKinds, flagKindSchema } from '@docstube/contracts';
import { decideAutoMerge } from './merge-decision.ts';
import type { AutoMergeDecision } from './merge-decision.ts';
import { buildFixtureFlag } from './test-support.ts';

const blockingKinds = (decision: AutoMergeDecision): string[] =>
  decision.autoMerge ? [] : decision.blockingFlags.map((flag) => flag.kind);

describe('auto-merge decision (hardcoded v1 rules)', () => {
  it('auto-merges when there are no flags at all', () => {
    expect(decideAutoMerge([])).toEqual({ autoMerge: true, openFlags: [] });
  });

  // Truth table derived from THE rule table in @docstube/contracts, not a copy of it.
  it.each(autoMergeBlockingFlagKinds.map((kind) => [kind] as const))(
    'a single open %s flag blocks auto-merge',
    (kind) => {
      const decision = decideAutoMerge([buildFixtureFlag({ kind })]);
      expect(decision.autoMerge).toBe(false);
      expect(blockingKinds(decision)).toEqual([kind]);
    }
  );

  it('covers every non-blocking kind explicitly: only tribal-knowledge is non-blocking in v1', () => {
    // Open questions ship visibly and are answered on a future run (PRODUCT §4.1); they never
    // hold a merge.
    const nonBlocking = flagKindSchema.options.filter((kind) => !autoMergeBlockingFlagKinds.includes(kind));
    expect(nonBlocking).toEqual(['tribal-knowledge']);
  });

  it('an open tribal-knowledge flag alone does NOT block auto-merge but stays visible', () => {
    const decision = decideAutoMerge([buildFixtureFlag({ kind: 'tribal-knowledge' })]);
    expect(decision.autoMerge).toBe(true);
    expect(decision.openFlags).toHaveLength(1);
  });

  it('non-open flags of blocking kinds never block', () => {
    const decision = decideAutoMerge([
      buildFixtureFlag({ kind: 'guarantee-downgrade', status: 'resolved' }),
      buildFixtureFlag({ kind: 'tribal-knowledge', status: 'answered' }),
      buildFixtureFlag({ kind: 'system', status: 'dismissed' })
    ]);
    expect(decision.autoMerge).toBe(true);
    expect(decision.openFlags).toHaveLength(0);
  });

  it('one blocking flag among non-blocking ones blocks the whole PR', () => {
    const decision = decideAutoMerge([
      buildFixtureFlag({ kind: 'tribal-knowledge' }),
      buildFixtureFlag({ kind: 'structural-change' })
    ]);
    expect(decision.autoMerge).toBe(false);
    expect(blockingKinds(decision)).toEqual(['structural-change']);
    expect(decision.openFlags).toHaveLength(2);
  });
});
