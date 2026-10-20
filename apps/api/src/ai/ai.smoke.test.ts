import assert from 'node:assert/strict';
import test from 'node:test';
import { VALID_ILLUSTRATIVE_NOTE } from './ai.fixtures';
import { runAiSmoke } from './ai.smoke';

test('live smoke is opt-in and does not contact a provider by default', async () => {
  const result = await runAiSmoke({
    env: { AI_LIVE_SMOKE: 'false', AI_ENABLED: 'true', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test-not-a-real-key' },
    create: async () => {
      throw new Error('provider must not be contacted');
    },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.contactedProvider, false);
  assert.equal(JSON.stringify(result.report).includes('sk-test'), false);
});

test('live smoke exits clearly when AI is disabled or the key is missing', async () => {
  const disabled = await runAiSmoke({
    env: { AI_LIVE_SMOKE: 'true', AI_ENABLED: 'false', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test-not-a-real-key' },
    create: async () => {
      throw new Error('provider must not be contacted');
    },
  });
  assert.equal(disabled.exitCode, 2);
  assert.equal(disabled.report.contactedProvider, false);

  const missingKey = await runAiSmoke({
    env: { AI_LIVE_SMOKE: 'true', AI_ENABLED: 'true', AI_PROVIDER: 'openai' },
    create: async () => {
      throw new Error('provider must not be contacted');
    },
  });
  assert.equal(missingKey.exitCode, 2);
  assert.equal(missingKey.report.contactedProvider, false);
});

test('live smoke can be exercised with an injected transport and synthetic data', async () => {
  let calls = 0;
  const result = await runAiSmoke({
    env: {
      AI_LIVE_SMOKE: 'true',
      AI_ENABLED: 'true',
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test-not-a-real-key',
      AI_MODEL: 'gpt-5.4-mini',
      AI_MAX_OUTPUT_TOKENS: '64',
    },
    create: async (body) => {
      calls += 1;
      assert.equal(body.store, false);
      assert.equal((body.text as { format: { strict: boolean } }).format.strict, true);
      return {
        status: 'completed',
        model: 'gpt-5.4-mini',
        output_text: JSON.stringify(VALID_ILLUSTRATIVE_NOTE),
        usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.ok, true);
  assert.equal(result.report.usageAvailable, true);
  assert.equal(result.report.inputTokens, 12);
  assert.equal(JSON.stringify(result.report).includes('sk-test-not-a-real-key'), false);
  assert.equal(result.report.contactedProvider, true);
});

test('live smoke records contact only after the transport runs, and never prints secrets on failure', async () => {
  const failed = await runAiSmoke({
    env: {
      AI_LIVE_SMOKE: 'true',
      AI_ENABLED: 'true',
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test-not-a-real-key',
    },
    create: async () => {
      throw { status: 401, message: 'Incorrect API key sk-test-not-a-real-key' };
    },
  });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.report.contactedProvider, true);
  assert.equal(JSON.stringify(failed.report).includes('sk-test-not-a-real-key'), false);
});
