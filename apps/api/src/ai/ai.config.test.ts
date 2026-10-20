import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAiConfig, loadAiConfig } from './ai.config';

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
  const keys = Object.keys(overrides);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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

test('AI is disabled by default and does not require provider keys', () => {
  withEnv(cleared, () => {
    const config = loadAiConfig();
    assert.equal(config.enabled, false);
    assert.equal(config.provider, 'mock');
    assert.equal(config.model, 'gpt-5.4-mini');
    assert.equal(config.openaiApiKey, '');
    assert.equal(config.maxRequestsPerUserDay, 20);
    assert.doesNotThrow(() => assertAiConfig());
  });
});

test('unsupported AI_PROVIDER is rejected', () => {
  withEnv({ ...cleared, AI_PROVIDER: 'anthropic' }, () => {
    assert.throws(() => loadAiConfig(), /Unsupported AI_PROVIDER/);
  });
});

test('invalid AI_ENABLED is rejected', () => {
  withEnv({ ...cleared, AI_ENABLED: 'yes' }, () => {
    assert.throws(() => loadAiConfig(), /AI_ENABLED must be true or false/);
  });
});

test('invalid input size limit is rejected', () => {
  withEnv({ ...cleared, AI_MAX_INPUT_CHARS: '0' }, () => {
    assert.throws(() => loadAiConfig(), /AI_MAX_INPUT_CHARS/);
  });
  withEnv({ ...cleared, AI_MAX_INPUT_CHARS: '100001' }, () => {
    assert.throws(() => loadAiConfig(), /AI_MAX_INPUT_CHARS/);
  });
});

test('invalid output token limit is rejected', () => {
  withEnv({ ...cleared, AI_MAX_OUTPUT_TOKENS: '-1' }, () => {
    assert.throws(() => loadAiConfig(), /AI_MAX_OUTPUT_TOKENS/);
  });
  withEnv({ ...cleared, AI_MAX_OUTPUT_TOKENS: '8193' }, () => {
    assert.throws(() => loadAiConfig(), /AI_MAX_OUTPUT_TOKENS/);
  });
});

test('mock provider is accepted when AI is enabled', () => {
  withEnv({ ...cleared, AI_ENABLED: 'true', AI_PROVIDER: 'mock', AI_MAX_OUTPUT_TOKENS: '256' }, () => {
    const config = loadAiConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.provider, 'mock');
    assert.equal(config.maxOutputTokens, 256);
  });
});

test('openai provider is accepted and requires a key only when enabled', () => {
  withEnv({ ...cleared, AI_ENABLED: 'false', AI_PROVIDER: 'openai' }, () => {
    assert.equal(loadAiConfig().provider, 'openai');
    assert.doesNotThrow(() => assertAiConfig());
  });
  withEnv({ ...cleared, AI_ENABLED: 'true', AI_PROVIDER: 'openai' }, () => {
    assert.throws(() => assertAiConfig(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /OPENAI_API_KEY is required/);
      assert.equal(error.message.includes('sk-'), false);
      return true;
    });
  });
  withEnv({
    ...cleared,
    AI_ENABLED: 'true',
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-test-not-a-real-key',
    AI_MODEL: 'gpt-5.4-mini',
  }, () => {
    const config = loadAiConfig();
    assert.equal(config.provider, 'openai');
    assert.equal(config.model, 'gpt-5.4-mini');
    assert.doesNotThrow(() => assertAiConfig());
  });
});
