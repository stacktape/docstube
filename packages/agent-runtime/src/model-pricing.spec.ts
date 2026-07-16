import { describe, expect, it } from 'vitest';
import { estimateCostUsd, lookupModelPricing } from './model-pricing.ts';

describe('lookupModelPricing', () => {
  it('resolves exact model ids', () => {
    expect(lookupModelPricing('claude-sonnet-5')).toEqual({ inputUsdPerMTok: 3, outputUsdPerMTok: 15 });
    expect(lookupModelPricing('gpt-5.6-terra')).toEqual({ inputUsdPerMTok: 2.5, outputUsdPerMTok: 15 });
  });

  it('resolves date-suffixed ids by prefix on a dash boundary', () => {
    expect(lookupModelPricing('claude-sonnet-5-20260401')).toEqual({ inputUsdPerMTok: 3, outputUsdPerMTok: 15 });
    expect(lookupModelPricing('claude-haiku-4-5-20251001')).toEqual({ inputUsdPerMTok: 1, outputUsdPerMTok: 5 });
    // Not a dash boundary — must not match 'claude-sonnet-5'.
    expect(lookupModelPricing('claude-sonnet-55')).toBeUndefined();
  });

  it('returns undefined for unknown models — never guesses', () => {
    expect(lookupModelPricing('gemini-3-pro')).toBeUndefined();
    expect(lookupModelPricing('llama-4-70b')).toBeUndefined();
    expect(lookupModelPricing('')).toBeUndefined();
  });
});

describe('estimateCostUsd', () => {
  it('prices input and output tokens per MTok', () => {
    // 1M input at $3 + 1M output at $15.
    expect(estimateCostUsd('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(18);
    expect(estimateCostUsd('gpt-5.6-luna', { inputTokens: 500_000, outputTokens: 100_000 })).toBeCloseTo(1.1, 10);
    expect(estimateCostUsd('claude-opus-4-8-20260210', { inputTokens: 1000, outputTokens: 200 })).toBeCloseTo(0.01, 10);
  });

  it('returns undefined for unknown models', () => {
    expect(estimateCostUsd('mystery-model', { inputTokens: 10, outputTokens: 10 })).toBeUndefined();
  });
});
