import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_PRICE_CATALOG, AI_PRICE_CATALOG_VERSION, estimateUsageCost } from './ai.pricing';

test('known GPT-5.4 Mini catalog estimates cached and uncached tokens', () => {
  assert.equal(AI_PRICE_CATALOG['gpt-5.4-mini'].inputUsdPerMillion, 0.75);
  assert.equal(AI_PRICE_CATALOG['gpt-5.4-mini'].cachedInputUsdPerMillion, 0.075);
  assert.equal(AI_PRICE_CATALOG['gpt-5.4-mini'].outputUsdPerMillion, 4.5);
  const cost = estimateUsageCost({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    usageAvailable: true,
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cachedInputTokens: 200_000,
  });
  assert.equal(cost.status, 'estimated');
  assert.equal(cost.catalogVersion, AI_PRICE_CATALOG_VERSION);
  assert.equal(cost.amountUsd, 0.8 * 0.75 + 0.2 * 0.075 + 4.5);
  assert.match(cost.note ?? '', /not a provider invoice/i);
});

test('zero reported tokens estimate as zero without treating missing usage as free', () => {
  const zero = estimateUsageCost({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    usageAvailable: true,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  });
  assert.equal(zero.status, 'estimated');
  assert.equal(zero.amountUsd, 0);

  const missing = estimateUsageCost({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    usageAvailable: false,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
  });
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.amountUsd, null);
});

test('partial usage and cached tokens above input do not invent a cost', () => {
  const partial = estimateUsageCost({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    usageAvailable: true,
    inputTokens: 10,
    outputTokens: null,
    cachedInputTokens: 0,
  });
  assert.equal(partial.status, 'unavailable');
  assert.equal(partial.amountUsd, null);

  const overflow = estimateUsageCost({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    usageAvailable: true,
    inputTokens: 10,
    outputTokens: 2,
    cachedInputTokens: 11,
  });
  assert.equal(overflow.status, 'unavailable');
  assert.equal(overflow.amountUsd, null);
});

test('unknown models and mock usage do not invent prices', () => {
  const unknown = estimateUsageCost({
    provider: 'openai',
    model: 'not-a-catalog-model',
    usageAvailable: true,
    inputTokens: 10,
    outputTokens: 10,
    cachedInputTokens: 0,
  });
  assert.equal(unknown.status, 'unavailable');
  assert.equal(unknown.amountUsd, null);

  const mock = estimateUsageCost({
    provider: 'mock',
    model: 'flowops-mock',
    usageAvailable: false,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
  });
  assert.equal(mock.status, 'unavailable');
  assert.match(mock.note ?? '', /not real spending/i);
});
