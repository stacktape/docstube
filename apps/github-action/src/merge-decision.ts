import type { Flag } from '@docstube/contracts';
import { autoMergeBlockingFlagKinds } from '@docstube/contracts';

// The hardcoded v1 auto-merge gate (PRODUCT §3.3): all deterministic gates green + no blocking
// flag → the PR merges without a human. `autoMergeBlockingFlagKinds` in @docstube/contracts is
// THE rule table; the v2 policy engine replaces the table, not this gate.

export type AutoMergeDecision =
  | { autoMerge: true; openFlags: readonly Flag[] }
  | { autoMerge: false; openFlags: readonly Flag[]; blockingFlags: readonly Flag[] };

export const decideAutoMerge = (flags: readonly Flag[]): AutoMergeDecision => {
  const openFlags = flags.filter((flag) => flag.status === 'open');
  const blockingFlags = openFlags.filter((flag) => autoMergeBlockingFlagKinds.includes(flag.kind));
  return blockingFlags.length === 0 ? { autoMerge: true, openFlags } : { autoMerge: false, openFlags, blockingFlags };
};
