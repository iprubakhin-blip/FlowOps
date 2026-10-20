import assert from 'node:assert/strict';
import test from 'node:test';
import { currentAiCapabilities } from './ai.capabilities';

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('disabled AI reports a safe capabilities snapshot without secrets', () => {
  withEnv({
    AI_ENABLED: 'false',
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-must-not-appear',
  }, () => {
    const caps = currentAiCapabilities();
    assert.equal(caps.enabled, false);
    assert.equal(caps.provider, 'openai');
    assert.equal(caps.externalProcessingRequired, false);
    assert.equal(caps.maxDrafts, 10);
    assert.equal('openaiApiKey' in caps, false);
    assert.equal('model' in caps, false);
    assert.doesNotMatch(JSON.stringify(caps), /sk-/);
  });
});

test('enabled OpenAI requires external processing consent', () => {
  withEnv({
    AI_ENABLED: 'true',
    AI_PROVIDER: 'openai',
    AI_MAX_INPUT_CHARS: '4000',
    OPENAI_API_KEY: 'sk-must-not-appear',
  }, () => {
    const caps = currentAiCapabilities();
    assert.equal(caps.enabled, true);
    assert.equal(caps.provider, 'openai');
    assert.equal(caps.externalProcessingRequired, true);
    assert.equal(caps.maxRequirementsChars, 4000);
  });
});

test('enabled mock mode does not require external consent', () => {
  withEnv({ AI_ENABLED: 'true', AI_PROVIDER: 'mock' }, () => {
    const caps = currentAiCapabilities();
    assert.equal(caps.enabled, true);
    assert.equal(caps.provider, 'mock');
    assert.equal(caps.externalProcessingRequired, false);
  });
});
