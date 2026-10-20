import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AiError } from './ai.errors';
import { ILLUSTRATIVE_NOTE_SCHEMA, VALID_ILLUSTRATIVE_NOTE } from './ai.fixtures';
import { AiModule } from './ai.module';
import { AiService } from './ai.service';
import { loadAiConfig, type AiConfig } from './ai.config';
import { AI_PROVIDER } from './ai.types';
import { MockAiProvider } from './mock-ai.provider';

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    enabled: true,
    provider: 'mock',
    model: 'flowops-mock',
    openaiApiKey: '',
    maxInputChars: 80,
    maxOutputTokens: 64,
    requestTimeoutMs: 1_000,
    maxRequestsPerUserDay: 20,
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<AiService['generateStructured']>[0]> = {}) {
  return {
    systemInstruction: 'Return JSON only.',
    userInput: 'Draft a note.',
    schemaName: 'illustrative.note',
    schema: ILLUSTRATIVE_NOTE_SCHEMA,
    ...overrides,
  };
}

test('valid structured mock output is validated and returned', async () => {
  const provider = new MockAiProvider();
  provider.use({ type: 'json', body: VALID_ILLUSTRATIVE_NOTE });
  const service = new AiService(provider);
  const result = await service.generateStructured(input(), {
    loadConfig: () => config(),
    timeoutSignal: () => new AbortController().signal,
  });
  assert.deepEqual(result.output, VALID_ILLUSTRATIVE_NOTE);
  assert.equal(result.schemaName, 'illustrative.note');
  assert.equal(result.usage.usageAvailable, false);
  assert.equal(provider.lastRequest?.maxOutputTokens, 64);
});

test('disabled AI never calls the provider', async () => {
  const provider = new MockAiProvider();
  provider.use({ type: 'json', body: VALID_ILLUSTRATIVE_NOTE });
  const service = new AiService(provider);
  await assert.rejects(
    () => service.generateStructured(input(), {
      loadConfig: () => config({ enabled: false }),
      timeoutSignal: () => new AbortController().signal,
    }),
    (error: unknown) => error instanceof AiError && error.code === 'AI_DISABLED',
  );
  assert.equal(provider.callCount(), 0);
});

test('provider errors stay typed and omit secrets', async () => {
  const provider = new MockAiProvider();
  provider.use({ type: 'error', code: 'PROVIDER_UNAVAILABLE' });
  const service = new AiService(provider);
  await assert.rejects(
    () => service.generateStructured(input(), {
      loadConfig: () => config(),
      timeoutSignal: () => new AbortController().signal,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AiError);
      const publicError = error.toPublic();
      assert.equal(publicError.error, 'PROVIDER_UNAVAILABLE');
      assert.equal(JSON.stringify(publicError).includes('sk-'), false);
      assert.equal(JSON.stringify(publicError).includes('Authorization'), false);
      return true;
    },
  );
});

test('timeout handling does not sleep', async () => {
  const provider = new MockAiProvider();
  provider.use({ type: 'wait-for-abort' });
  const service = new AiService(provider);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    () => service.generateStructured(input(), {
      loadConfig: () => config(),
      timeoutSignal: () => aborted.signal,
    }),
    (error: unknown) => error instanceof AiError && error.code === 'TIMEOUT',
  );
});

test('request cancellation does not sleep', async () => {
  const provider = new MockAiProvider();
  provider.use({ type: 'wait-for-abort' });
  const service = new AiService(provider);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => service.generateStructured(input({ signal: controller.signal }), {
      loadConfig: () => config(),
      timeoutSignal: () => new AbortController().signal,
    }),
    (error: unknown) => error instanceof AiError && error.code === 'CANCELLED',
  );
});

test('input that exceeds configured size is rejected before the provider', async () => {
  const provider = new MockAiProvider();
  const service = new AiService(provider);
  await assert.rejects(
    () => service.generateStructured(input({ userInput: 'x'.repeat(81) }), {
      loadConfig: () => config({ maxInputChars: 80 }),
      timeoutSignal: () => new AbortController().signal,
    }),
    (error: unknown) => error instanceof AiError && error.code === 'INPUT_TOO_LARGE',
  );
  assert.equal(provider.callCount(), 0);
});

test('caller output token requests cannot exceed the configured ceiling', async () => {
  const provider = new MockAiProvider();
  provider.use({ type: 'json', body: VALID_ILLUSTRATIVE_NOTE });
  const service = new AiService(provider);
  await service.generateStructured(input({ maxOutputTokens: 9_999 }), {
    loadConfig: () => config({ maxOutputTokens: 32 }),
    timeoutSignal: () => new AbortController().signal,
  });
  assert.equal(provider.lastRequest?.maxOutputTokens, 32);
});

test('unknown schema names are rejected before the provider', async () => {
  const provider = new MockAiProvider();
  const service = new AiService(provider);
  await assert.rejects(
    () => service.generateStructured(input({ schemaName: 'task.draft' }), {
      loadConfig: () => config(),
      timeoutSignal: () => new AbortController().signal,
    }),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
  assert.equal(provider.callCount(), 0);
});

test('schema mismatch from the mock is a validation failure', async () => {
  const provider = new MockAiProvider();
  provider.use({ type: 'json', body: { title: 'Missing priority' } });
  const service = new AiService(provider);
  await assert.rejects(
    () => service.generateStructured(input(), {
      loadConfig: () => config(),
      timeoutSignal: () => new AbortController().signal,
    }),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
});

test('malformed provider JSON is rejected without treating it as a task write', async () => {
  const provider = new MockAiProvider();
  provider.use({ type: 'text', body: 'not-json' });
  const service = new AiService(provider);
  await assert.rejects(
    () => service.generateStructured(input(), {
      loadConfig: () => config(),
      timeoutSignal: () => new AbortController().signal,
    }),
    (error: unknown) => error instanceof AiError && error.code === 'INVALID_PROVIDER_RESPONSE',
  );
});

test('AiService is injected from AiModule without task repositories', async () => {
  const previous = process.env.AI_ENABLED;
  process.env.AI_ENABLED = 'false';
  const app = await NestFactory.create(AiModule, { logger: false });
  try {
    const service = app.get(AiService);
    const provider = app.get(AI_PROVIDER);
    assert.ok(service instanceof AiService);
    assert.ok(provider instanceof MockAiProvider);
    assert.equal('tasks' in service, false);
    await assert.rejects(
      () => service.generateStructured(input(), {
        loadConfig: loadAiConfig,
        timeoutSignal: () => new AbortController().signal,
      }),
      (error: unknown) => error instanceof AiError && error.code === 'AI_DISABLED',
    );
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = previous;
  }
});
