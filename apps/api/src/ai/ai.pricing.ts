import { UNAVAILABLE_COST, type AiUsage } from './ai.types';

/** USD per 1,000,000 tokens. Versioned snapshot of documented list prices, not an invoice. */
export const AI_PRICE_CATALOG_VERSION = '2026-10-20';

export interface ModelTokenPrices {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
  source: string;
}

/**
 * Official OpenAI API pricing for GPT-5.4 Mini as documented on
 * https://developers.openai.com/api/docs/pricing (Standard tier, 2026-10-20):
 * $0.75 input / $0.075 cached input / $4.50 output per 1M tokens.
 */
export const AI_PRICE_CATALOG: Readonly<Record<string, ModelTokenPrices>> = {
  'gpt-5.4-mini': {
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 4.5,
    source: 'https://developers.openai.com/api/docs/pricing',
  },
};

export function estimateUsageCost(usage: Pick<AiUsage, 'model' | 'usageAvailable' | 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'provider'>): AiUsage['cost'] {
  if (!usage.usageAvailable) {
    return {
      ...UNAVAILABLE_COST,
      note: usage.provider === 'mock' ? 'Mock usage is not real spending.' : 'Provider did not report token usage.',
    };
  }
  const prices = AI_PRICE_CATALOG[usage.model];
  if (!prices) {
    return {
      ...UNAVAILABLE_COST,
      note: 'No catalog prices for this model.',
    };
  }
  if (
    usage.inputTokens === null ||
    usage.outputTokens === null ||
    !Number.isInteger(usage.inputTokens) ||
    !Number.isInteger(usage.outputTokens) ||
    usage.inputTokens < 0 ||
    usage.outputTokens < 0
  ) {
    return { ...UNAVAILABLE_COST, note: 'Token counts are incomplete or invalid.' };
  }
  const cached = usage.cachedInputTokens ?? 0;
  if (!Number.isInteger(cached) || cached < 0 || cached > usage.inputTokens) {
    return { ...UNAVAILABLE_COST, note: 'Cached token counts are inconsistent.' };
  }
  const uncachedInput = usage.inputTokens - cached;
  const amountUsd =
    (uncachedInput * prices.inputUsdPerMillion +
      cached * prices.cachedInputUsdPerMillion +
      usage.outputTokens * prices.outputUsdPerMillion) /
    1_000_000;
  return {
    status: 'estimated',
    amountUsd: Number(amountUsd.toFixed(8)),
    catalogVersion: AI_PRICE_CATALOG_VERSION,
    note: 'Estimated from a versioned price catalog. Not a provider invoice.',
  };
}
