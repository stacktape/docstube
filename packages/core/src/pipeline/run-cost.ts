// Run-level cost accounting (PRODUCT §3.5): usage caps are approximate, so the run freezes WITH
// MARGIN — at 85% of agents.budgets.maxRunUsd, not at the cap itself. Cost is only observable
// after a task finishes, vendor-reported costs are themselves approximations, and the freeze is
// checked only between pages (never mid-page), so work already in flight still lands and bills.
// Stopping 15% early keeps the real spend under the cap; stopping at 100% would overshoot it.

export const FREEZE_MARGIN_RATIO = 0.85;

export type RunCostTracker = {
  add: (usage: { costUsd?: number | undefined }) => void;
  spentUsd: () => number;
  // True once spend reached maxRunUsd * FREEZE_MARGIN_RATIO; always false when no cap is set.
  shouldFreeze: () => boolean;
  // True when at least one task reported a cost — spentUsd is only meaningful then.
  hasReportedCost: () => boolean;
};

export const createRunCostTracker = (maxRunUsd?: number): RunCostTracker => {
  let spent = 0;
  let reported = false;
  return {
    add: (usage) => {
      if (usage.costUsd !== undefined) {
        spent += usage.costUsd;
        reported = true;
      }
    },
    spentUsd: () => spent,
    shouldFreeze: () => maxRunUsd !== undefined && spent >= maxRunUsd * FREEZE_MARGIN_RATIO,
    hasReportedCost: () => reported
  };
};

export const freezeReason = (maxRunUsd: number): string =>
  `run spend reached ${Math.round(FREEZE_MARGIN_RATIO * 100)}% of the $${maxRunUsd} cap — frozen with margin so in-flight work stays under the cap`;
