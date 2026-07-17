// Run-level cost accounting (PRODUCT §3.5): usage caps are approximate, so the run freezes WITH
// MARGIN — at 85% of agents.budgets.maxRunUsd, not at the cap itself. Cost is only observable
// after a task finishes, vendor-reported costs are themselves approximations, and the freeze is
// checked only between pages (never mid-page), so work already in flight still lands and bills.
// Stopping 15% early keeps the real spend under the cap; stopping at 100% would overshoot it.

export const FREEZE_MARGIN_RATIO = 0.85;

// Fallback pricing for transports that report tokens but no cost: deliberately HIGH flat rates so
// the estimate errs toward freezing early, never toward blowing past the cap.
export const ESTIMATE_USD_PER_1M_INPUT_TOKENS = 5;
export const ESTIMATE_USD_PER_1M_OUTPUT_TOKENS = 15;

export type RunCostTracker = {
  add: (usage: {
    costUsd?: number | undefined;
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    planUsedPercent?: number | undefined;
  }) => void;
  // Vendor-reported spend only; estimates are tracked separately.
  spentUsd: () => number;
  // Conservative token-derived estimate for usage that carried no costUsd.
  estimatedUsd: () => number;
  // True once (reported + estimated) spend reached maxRunUsd * FREEZE_MARGIN_RATIO; always false
  // when no cap is set.
  shouldFreeze: () => boolean;
  // True when at least one task reported a cost — spentUsd is only meaningful then.
  hasReportedCost: () => boolean;
  // True when at least one task's spend had to be estimated from tokens — callers should label
  // the displayed total "(partly estimated)".
  hasEstimates: () => boolean;
  // Latest subscription plan usage (0-100) seen this run; undefined when no transport reported one.
  planUsedPercent: () => number | undefined;
};

export const createRunCostTracker = (maxRunUsd?: number, maxPlanUsagePercent?: number): RunCostTracker => {
  let spent = 0;
  let estimated = 0;
  let reported = false;
  let hasEstimates = false;
  let planUsedPercent: number | undefined;
  return {
    add: (usage) => {
      // Plan usage is a level: keep the highest observation this run.
      if (usage.planUsedPercent !== undefined) {
        planUsedPercent = Math.max(planUsedPercent ?? 0, usage.planUsedPercent);
      }
      if (usage.costUsd !== undefined) {
        spent += usage.costUsd;
        reported = true;
        return;
      }
      // No reported cost: estimate from tokens so the cap never silently no-ops on transports
      // that report only token counts.
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      if (inputTokens > 0 || outputTokens > 0) {
        estimated +=
          (inputTokens / 1_000_000) * ESTIMATE_USD_PER_1M_INPUT_TOKENS +
          (outputTokens / 1_000_000) * ESTIMATE_USD_PER_1M_OUTPUT_TOKENS;
        hasEstimates = true;
      }
    },
    spentUsd: () => spent,
    estimatedUsd: () => estimated,
    // A plan-usage signal means subscription billing: the plan governor is the truth there, and
    // dollar ESTIMATES stop triggering the freeze (a flat-rate run was frozen at "$25 estimated"
    // in the first live regen — real money never moved). Vendor-REPORTED dollars still count.
    shouldFreeze: () => {
      if (planUsedPercent !== undefined) {
        return (
          (maxPlanUsagePercent !== undefined && planUsedPercent >= maxPlanUsagePercent) ||
          (maxRunUsd !== undefined && spent >= maxRunUsd * FREEZE_MARGIN_RATIO)
        );
      }
      return maxRunUsd !== undefined && spent + estimated >= maxRunUsd * FREEZE_MARGIN_RATIO;
    },
    hasReportedCost: () => reported,
    hasEstimates: () => hasEstimates,
    planUsedPercent: () => planUsedPercent
  };
};

export const freezeReason = (input: {
  maxRunUsd?: number | undefined;
  maxPlanUsagePercent?: number | undefined;
  planUsedPercent?: number | undefined;
}): string =>
  input.planUsedPercent !== undefined &&
  input.maxPlanUsagePercent !== undefined &&
  input.planUsedPercent >= input.maxPlanUsagePercent
    ? `subscription plan usage reached ${Math.round(input.planUsedPercent)}% (cap ${input.maxPlanUsagePercent}%) — frozen so the plan window is not exhausted`
    : `run spend reached ${Math.round(FREEZE_MARGIN_RATIO * 100)}% of the $${input.maxRunUsd ?? 0} cap — frozen with margin so in-flight work stays under the cap`;
