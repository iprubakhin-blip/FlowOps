import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import { assertAiConfig, loadAiConfig } from './ai.config';
import { AiModule, createConfiguredProvider } from './ai.module';
import { AI_PROVIDER } from './ai.types';
import { MockAiProvider } from './mock-ai.provider';
import { OpenAiProvider } from './openai-ai.provider';

function withEnv(overrides: Record<string, string | undefined>, run: () => Promise<void> | void): Promise<void> | void {
  const keys = Object.keys(overrides);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const result = run();
    if (result && typeof (result as Promise<void>).then === 'function') {
      return (result as Promise<void>).finally(restore);
    }
    restore();
  } catch (error) {
    restore();
    throw error;
  }
}

const cleared = {
  AI_ENABLED: undefined,
  AI_PROVIDER: undefined,
  AI_MODEL: undefined,
  OPENAI_API_KEY: undefined,
  AI_MAX_INPUT_CHARS: undefined,
  AI_MAX_OUTPUT_TOKENS: undefined,
  AI_REQUEST_TIMEOUT_MS: undefined,
  AI_MAX_REQUESTS_PER_USER_DAY: undefined,
};

test('disabled AI selects MockAiProvider and does not require a key', () => {
  withEnv({ ...cleared, AI_ENABLED: 'false', AI_PROVIDER: 'openai' }, () => {
    const provider = createConfiguredProvider();
    assert.ok(provider instanceof MockAiProvider);
    assert.doesNotThrow(() => assertAiConfig());
  });
});

test('mock mode is unchanged when AI is enabled', () => {
  withEnv({ ...cleared, AI_ENABLED: 'true', AI_PROVIDER: 'mock' }, () => {
    const provider = createConfiguredProvider();
    assert.ok(provider instanceof MockAiProvider);
    assert.equal(loadAiConfig().provider, 'mock');
  });
});

test('OpenAI mode is selected only when enabled with a key', () => {
  withEnv({ ...cleared, AI_ENABLED: 'true', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test-not-a-real-key' }, () => {
    const provider = createConfiguredProvider();
    assert.ok(provider instanceof OpenAiProvider);
    assert.equal(provider.id, 'openai');
  });
});

test('enabled OpenAI without a key fails closed', () => {
  withEnv({ ...cleared, AI_ENABLED: 'true', AI_PROVIDER: 'openai' }, () => {
    assert.throws(() => assertAiConfig(), /OPENAI_API_KEY is required/);
    assert.throws(() => createConfiguredProvider(), /OPENAI_API_KEY is required/);
  });
});

test('AiModule injects OpenAI when configured', async () => {
  await withEnv({ ...cleared, AI_ENABLED: 'true', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test-not-a-real-key' }, async () => {
    const app = await NestFactory.create(AiModule, { logger: false });
    try {
      const provider = app.get(AI_PROVIDER);
      assert.ok(provider instanceof OpenAiProvider);
    } finally {
      await app.close();
    }
  });
});
