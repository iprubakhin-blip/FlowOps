import assert from 'node:assert/strict';
import test from 'node:test';
import { AiError } from './ai.errors';
import { ILLUSTRATIVE_NOTE_SCHEMA, VALID_ILLUSTRATIVE_NOTE } from './ai.fixtures';
import { AiService } from './ai.service';
import type { AiConfig } from './ai.config';
import { OpenAiProvider } from './openai-ai.provider';

function config(): AiConfig {
  return {
    enabled: true,
    provider: 'openai',
    model: 'gpt-5.4-mini',
    openaiApiKey: 'sk-test-not-a-real-key',
    maxInputChars: 80,
    maxOutputTokens: 64,
    requestTimeoutMs: 1_000,
    maxRequestsPerUserDay: 20,
  };
}

function input() {
  return {
    systemInstruction: 'Return JSON only.',
    userInput: 'Draft a synthetic note.',
    schemaName: 'illustrative.note',
    schema: ILLUSTRATIVE_NOTE_SCHEMA,
  };
}

test('valid OpenAI structured JSON is re-validated locally', async () => {
  const provider = new OpenAiProvider({
    apiKey: 'sk-test-not-a-real-key',
    model: 'gpt-5.4-mini',
    timeoutMs: 1000,
    create: async () => ({
      status: 'completed',
      output_text: JSON.stringify(VALID_ILLUSTRATIVE_NOTE),
      usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
    }),
  });
  const result = await new AiService(provider).generateStructured(input(), {
    loadConfig: config,
    timeoutSignal: () => new AbortController().signal,
  });
  assert.deepEqual(result.output, VALID_ILLUSTRATIVE_NOTE);
  assert.equal(result.usage.usageAvailable, true);
  assert.equal(result.usage.cost.status, 'estimated');
});

test('invalid JSON and missing fields fail after the OpenAI transport', async () => {
  const invalidJson = new OpenAiProvider({
    apiKey: 'sk-test-not-a-real-key',
    model: 'gpt-5.4-mini',
    timeoutMs: 1000,
    create: async () => ({ status: 'completed', output_text: '{not json' }),
  });
  await assert.rejects(
    () => new AiService(invalidJson).generateStructured(input(), {
      loadConfig: config,
      timeoutSignal: () => new AbortController().signal,
    }),
    (error: unknown) => error instanceof AiError && error.code === 'INVALID_PROVIDER_RESPONSE',
  );

  const missing = new OpenAiProvider({
    apiKey: 'sk-test-not-a-real-key',
    model: 'gpt-5.4-mini',
    timeoutMs: 1000,
    create: async () => ({ status: 'completed', output_text: JSON.stringify({ title: 'Only title' }) }),
  });
  await assert.rejects(
    () => new AiService(missing).generateStructured(input(), {
      loadConfig: config,
      timeoutSignal: () => new AbortController().signal,
    }),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
});
