// Published per-MTok pricing for the current recommended models, taken from the vendors'
// public pricing pages as of 2026-07-16. Only the API-billed transports need this table —
// vendor CLIs either report an authoritative cost themselves (claude CLI's total_cost_usd)
// or bill through a subscription where per-run USD is not meaningful.
//
// Unknown models get NO estimate: estimateCostUsd returns undefined rather than guessing,
// because a fabricated cost would silently corrupt run-cap accounting (PRODUCT §3.5).

export type ModelPricing = {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
};

const pricingTable: Record<string, ModelPricing> = {
  'claude-opus-4-8': { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
  'claude-sonnet-5': { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
  'claude-haiku-4-5': { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  'gpt-5.6-sol': { inputUsdPerMTok: 5, outputUsdPerMTok: 30 },
  'gpt-5.6-terra': { inputUsdPerMTok: 2.5, outputUsdPerMTok: 15 },
  'gpt-5.6-luna': { inputUsdPerMTok: 1, outputUsdPerMTok: 6 }
};

// Longest matching entry wins, and a prefix only matches on a '-' boundary:
// 'claude-sonnet-5-20260401' resolves to 'claude-sonnet-5'; 'claude-sonnet-55' resolves to nothing.
export const lookupModelPricing = (model: string): ModelPricing | undefined => {
  const keys = Object.keys(pricingTable).toSorted((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model === key || model.startsWith(`${key}-`)) {
      return pricingTable[key];
    }
  }
  return undefined;
};

export const estimateCostUsd = (
  model: string,
  usage: { inputTokens: number; outputTokens: number }
): number | undefined => {
  const pricing = lookupModelPricing(model);
  if (pricing === undefined) {
    return undefined;
  }
  return (usage.inputTokens * pricing.inputUsdPerMTok + usage.outputTokens * pricing.outputUsdPerMTok) / 1_000_000;
};
