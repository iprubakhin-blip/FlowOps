import assert from 'node:assert/strict';
import test from 'node:test';
import { AiError } from './ai.errors';
import { VALID_ILLUSTRATIVE_NOTE } from './ai.fixtures';
import { getRegisteredSchema } from './ai.registry';
import { OpenAiProvider, type OpenAiCreateFn } from './openai-ai.provider';

const schema = getRegisteredSchema('illustrative.note')!;

function request() {
  return {
    systemInstruction: 'Return JSON only.',
    userInput: 'Draft a synthetic note.',
    schemaName: 'illustrative.note',
    jsonSchema: schema.providerJsonSchema,
    formatName: schema.providerFormatName,
    maxOutputTokens: 64,
  };
}

function provider(create: OpenAiCreateFn): OpenAiProvider {
  return new OpenAiProvider({
    apiKey: 'sk-test-not-a-real-key',
    model: 'gpt-5.4-mini',
    timeoutMs: 5_000,
    create,
  });
}

function completed(overrides: Record<string, unknown> = {}) {
  return {
    status: 'completed',
    model: 'gpt-5.4-mini',
    output_text: JSON.stringify(VALID_ILLUSTRATIVE_NOTE),
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: 10 },
    },
    ...overrides,
  };
}

test('OpenAI provider sends strict json_schema with store disabled and no tools', async () => {
  let calls = 0;
  const create: OpenAiCreateFn = async (body) => {
    calls += 1;
    assert.equal(body.model, 'gpt-5.4-mini');
    assert.equal(body.store, false);
    assert.equal(body.background, false);
    assert.equal('tools' in body, false);
    assert.equal('stream' in body, false);
    assert.equal(body.max_output_tokens, 64);
    const format = (body.text as { format: Record<string, unknown> }).format;
    assert.equal(format.type, 'json_schema');
    assert.equal(format.strict, true);
    assert.equal(format.name, 'illustrative_note');
    assert.deepEqual(format.schema, schema.providerJsonSchema);
    return completed();
  };
  const result = await provider(create).complete(request());
  assert.equal(calls, 1);
  assert.equal(result.provider, 'openai');
  assert.equal(result.rawText, JSON.stringify(VALID_ILLUSTRATIVE_NOTE));
  assert.equal(result.usage.usageAvailable, true);
  assert.equal(result.usage.inputTokens, 100);
  assert.equal(result.usage.outputTokens, 20);
  assert.equal(result.usage.cachedInputTokens, 10);
  assert.equal(result.usage.cost.status, 'estimated');
  assert.ok(result.usage.cost.amountUsd !== null);
});

test('OpenAI provider does not invent usage when the provider omits it', async () => {
  const result = await provider(async () => completed({ usage: undefined })).complete(request());
  assert.equal(result.usage.usageAvailable, false);
  assert.equal(result.usage.inputTokens, null);
  assert.equal(result.usage.cost.status, 'unavailable');
  assert.equal(result.usage.cost.amountUsd, null);
});

test('OpenAI provider maps partial, zero, invalid, and inconsistent usage without fabricating cost', async () => {
  const partial = await provider(async () => completed({
    usage: { input_tokens: 15 },
  })).complete(request());
  assert.equal(partial.usage.usageAvailable, true);
  assert.equal(partial.usage.inputTokens, 15);
  assert.equal(partial.usage.outputTokens, null);
  assert.equal(partial.usage.cost.status, 'unavailable');

  const zero = await provider(async () => completed({
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  })).complete(request());
  assert.equal(zero.usage.usageAvailable, true);
  assert.equal(zero.usage.inputTokens, 0);
  assert.equal(zero.usage.cost.status, 'estimated');
  assert.equal(zero.usage.cost.amountUsd, 0);

  const invalid = await provider(async () => completed({
    usage: { input_tokens: -3, output_tokens: 1.5, total_tokens: 'nope' },
  })).complete(request());
  assert.equal(invalid.usage.usageAvailable, false);
  assert.equal(invalid.usage.inputTokens, null);
  assert.equal(invalid.usage.outputTokens, null);
  assert.equal(invalid.usage.cost.status, 'unavailable');

  const overflow = await provider(async () => completed({
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 99 } },
  })).complete(request());
  assert.equal(overflow.usage.usageAvailable, true);
  assert.equal(overflow.usage.cachedInputTokens, 99);
  assert.equal(overflow.usage.cost.status, 'unavailable');
});

test('OpenAI provider keeps result.model aligned with usage.model', async () => {
  const result = await provider(async () => completed({ model: 'gpt-5.4-mini' })).complete(request());
  assert.equal(result.model, result.usage.model);
});

test('OpenAI provider extracts output_text from the output array when the convenience field is missing', async () => {
  const result = await provider(async () => ({
    status: 'completed',
    model: 'gpt-5.4-mini',
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify(VALID_ILLUSTRATIVE_NOTE) }],
    }],
    usage: { input_tokens: 4, output_tokens: 4, total_tokens: 8 },
  })).complete(request());
  assert.equal(result.rawText, JSON.stringify(VALID_ILLUSTRATIVE_NOTE));
});

test('OpenAI provider forwards AbortSignal to the transport', async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  await provider(async (_body, options) => {
    seen = options?.signal;
    return completed();
  }).complete({ ...request(), signal: controller.signal });
  assert.equal(seen, controller.signal);
});

test('OpenAI provider maps refusals, incomplete output, and empty text', async () => {
  await assert.rejects(
    () => provider(async () => ({
      status: 'completed',
      output_text: JSON.stringify(VALID_ILLUSTRATIVE_NOTE),
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'nope' }] }],
    })).complete(request()),
    (error: unknown) => error instanceof AiError && error.code === 'REFUSAL',
  );
  await assert.rejects(
    () => provider(async () => ({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_text: '{',
    })).complete(request()),
    (error: unknown) => error instanceof AiError && error.code === 'INCOMPLETE',
  );
  await assert.rejects(
    () => provider(async () => ({ status: 'completed', output: [], output_text: '' })).complete(request()),
    (error: unknown) => error instanceof AiError && error.code === 'INVALID_PROVIDER_RESPONSE',
  );
});

test('OpenAI provider maps HTTP credential, rate-limit, and 5xx errors without leaking secrets', async () => {
  const cases: Array<{ status: number; code: string }> = [
    { status: 401, code: 'CREDENTIALS' },
    { status: 403, code: 'CREDENTIALS' },
    { status: 429, code: 'RATE_LIMITED' },
    { status: 500, code: 'PROVIDER_UNAVAILABLE' },
    { status: 503, code: 'PROVIDER_UNAVAILABLE' },
  ];
  for (const item of cases) {
    await assert.rejects(
      () => provider(async () => {
        throw { status: item.status, message: 'Incorrect API key sk-secret-value Authorization: Bearer sk-secret-value' };
      }).complete(request()),
      (error: unknown) => {
        assert.ok(error instanceof AiError);
        assert.equal(error.code, item.code);
        assert.equal(error.message.includes('sk-secret'), false);
        assert.equal(error.toPublic().message.includes('Authorization'), false);
        return true;
      },
    );
  }
});

test('OpenAI provider maps timeout and abort without retries', async () => {
  let timeoutCalls = 0;
  await assert.rejects(
    () => provider(async () => {
      timeoutCalls += 1;
      throw { name: 'APIConnectionTimeoutError' };
    }).complete(request()),
    (error: unknown) => error instanceof AiError && error.code === 'TIMEOUT',
  );
  assert.equal(timeoutCalls, 1);

  let unavailableCalls = 0;
  await assert.rejects(
    () => provider(async () => {
      unavailableCalls += 1;
      throw { status: 503 };
    }).complete(request()),
    (error: unknown) => error instanceof AiError && error.code === 'PROVIDER_UNAVAILABLE',
  );
  assert.equal(unavailableCalls, 1);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => provider(async () => {
      throw new Error('should not be called after abort');
    }).complete({ ...request(), signal: controller.signal }),
    (error: unknown) => error instanceof AiError && error.code === 'CANCELLED',
  );
});

test('OpenAI provider injected transport performs no fetch', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('network must not be used');
  }) as typeof fetch;
  try {
    await provider(async () => completed()).complete(request());
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI provider refuses unconstrained generation when schema is missing', async () => {
  await assert.rejects(
    () => provider(async () => completed()).complete({
      systemInstruction: 'x',
      userInput: 'y',
      schemaName: 'illustrative.note',
      maxOutputTokens: 16,
    }),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
});
