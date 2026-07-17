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
};

export const createRunCostTracker = (maxRunUsd?: number): RunCostTracker => {
  let spent = 0;
  let estimated = 0;
  let reported = false;
  let hasEstimates = false;
  return {
    add: (usage) => {
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
    shouldFreeze: () => maxRunUsd !== undefined && spent + estimated >= maxRunUsd * FREEZE_MARGIN_RATIO,
    hasReportedCost: () => reported,
    hasEstimates: () => hasEstimates
  };
};

export const freezeReason = (maxRunUsd: number): string =>
  `run spend reached ${Math.round(FREEZE_MARGIN_RATIO * 100)}% of the $${maxRunUsd} cap — frozen with margin so in-flight work stays under the cap`;
