import assert from 'node:assert/strict';
import test from 'node:test';
import { AiError } from './ai.errors';
import { VALID_ILLUSTRATIVE_NOTE } from './ai.fixtures';
import { MockAiProvider } from './mock-ai.provider';

function request(signal?: AbortSignal) {
  return {
    systemInstruction: 'Return JSON only.',
    userInput: 'Draft a note.',
    schemaName: 'illustrative.note',
    maxOutputTokens: 128,
    signal,
  };
}

test('mock provider performs no network calls', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('network must not be used');
  }) as typeof fetch;
  const provider = new MockAiProvider();
  provider.use({ type: 'json', body: VALID_ILLUSTRATIVE_NOTE });
  try {
    const result = await provider.complete(request());
    assert.equal(fetchCalls, 0);
    assert.equal(result.provider, 'mock');
    assert.equal(result.usage.usageAvailable, false);
    assert.equal(result.usage.cost.status, 'unavailable');
    assert.equal(result.usage.cost.amountUsd, null);
    assert.equal(result.usage.inputTokens, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mock provider usage metadata is simulated/unavailable, not billable', async () => {
  const provider = new MockAiProvider();
  provider.use({ type: 'json', body: VALID_ILLUSTRATIVE_NOTE });
  const result = await provider.complete(request());
  assert.equal(result.usage.usageAvailable, false);
  assert.equal(result.usage.cost.status, 'unavailable');
  assert.equal(result.model, 'flowops-mock');
});

test('mock provider can emit malformed text and provider errors', async () => {
  const provider = new MockAiProvider();
  provider.use({ type: 'text', body: '{broken' });
  assert.equal((await provider.complete(request())).rawText, '{broken');

  provider.use({ type: 'error', code: 'RATE_LIMITED' });
  await assert.rejects(
    () => provider.complete(request()),
    (error: unknown) => error instanceof AiError && error.code === 'RATE_LIMITED',
  );
});

test('mock provider cancellation waits for abort without sleeping', async () => {
  const provider = new MockAiProvider();
  provider.use({ type: 'wait-for-abort' });
  const controller = new AbortController();
  const pending = provider.complete(request(controller.signal));
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof AiError && error.code === 'CANCELLED',
  );
});
