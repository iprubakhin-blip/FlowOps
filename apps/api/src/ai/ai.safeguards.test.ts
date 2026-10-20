import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAiSafeguards, clampOutputTokens } from './ai.safeguards';

test('safeguards are conservative and do not claim a durable in-memory budget', () => {
  const described = describeAiSafeguards({
    enabled: true,
    provider: 'openai',
    model: 'gpt-5.4-mini',
    openaiApiKey: '',
    maxInputChars: 8000,
    maxOutputTokens: 1024,
    requestTimeoutMs: 15000,
    maxRequestsPerUserDay: 20,
  });
  assert.equal(described.retries, 0);
  assert.equal(described.fanOut, 0);
  assert.equal(described.dailyLimitStorage, 'config-only');
  assert.equal(clampOutputTokens(9999, 1024), 1024);
});
