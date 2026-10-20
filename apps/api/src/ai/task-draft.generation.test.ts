import assert from 'node:assert/strict';
import test from 'node:test';
import { AiError } from './ai.errors';
import { AiService } from './ai.service';
import { MockAiProvider } from './mock-ai.provider';
import { OpenAiProvider } from './openai-ai.provider';
import { PORTAL_DRAFT_OUTPUT, PORTAL_REQUIREMENTS } from './task-draft.fixtures';
import { TaskDraftGenerationService } from './task-draft.generation';
import type { TaskDraftRequest } from './task-draft.types';
import type { AiQuotaRepository } from './ai-quota.repository';

function request(overrides: Partial<TaskDraftRequest> = {}): TaskDraftRequest {
  return {
    requirements: PORTAL_REQUIREMENTS,
    team: 'Platform',
    allowExternalProcessing: false,
    ...overrides,
  };
}

function quota(allowed = true): AiQuotaRepository {
  return {
    reserveDailyRequest: async () => ({ allowed, requestCount: allowed ? 1 : null, usageDate: '2026-10-20' }),
  } as unknown as AiQuotaRepository;
}

function withEnv(overrides: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const keys = Object.keys(overrides);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const enabledMock: Record<string, string> = {
  AI_ENABLED: 'true',
  AI_PROVIDER: 'mock',
};

test('mock generation returns stamped team, todo status, and no persistence fields', async () => {
  await withEnv(enabledMock, async () => {
    const provider = new MockAiProvider();
    const service = new TaskDraftGenerationService(new AiService(provider), quota());
    const result = await service.generate(7, request());
    assert.equal(result.persisted, false);
    assert.equal(result.team, 'Platform');
    assert.ok(result.tasks.length >= 1);
    assert.ok(result.tasks.every((task) => task.team === 'Platform' && task.status === 'todo'));
    assert.equal('ownerId' in result.tasks[0], false);
    assert.equal(result.usage.usageAvailable, false);
    assert.equal(provider.lastRequest?.userInput, PORTAL_REQUIREMENTS);
  });
});

test('disabled AI and quota exhaustion never call the provider', async () => {
  await withEnv({ AI_ENABLED: 'false' }, async () => {
    const provider = new MockAiProvider();
    const service = new TaskDraftGenerationService(new AiService(provider), quota());
    await assert.rejects(() => service.generate(1, request()), (error: unknown) => error instanceof AiError && error.code === 'AI_DISABLED');
    assert.equal(provider.callCount(), 0);
  });
  await withEnv(enabledMock, async () => {
    const provider = new MockAiProvider();
    const service = new TaskDraftGenerationService(new AiService(provider), quota(false));
    await assert.rejects(() => service.generate(1, request()), (error: unknown) => error instanceof AiError && error.code === 'QUOTA_EXCEEDED');
    assert.equal(provider.callCount(), 0);
  });
});

test('OpenAI mode requires consent before the transport is used', async () => {
  await withEnv({
    AI_ENABLED: 'true',
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-test-not-a-real-key',
  }, async () => {
    let calls = 0;
    const provider = new OpenAiProvider({
      apiKey: 'sk-test-not-a-real-key',
      model: 'gpt-5.4-mini',
      timeoutMs: 1000,
      create: async () => {
        calls += 1;
        return { status: 'completed', output_text: JSON.stringify(PORTAL_DRAFT_OUTPUT) };
      },
    });
    const service = new TaskDraftGenerationService(new AiService(provider), quota());
    await assert.rejects(
      () => service.generate(1, request({ allowExternalProcessing: false })),
      (error: unknown) => error instanceof AiError && error.code === 'CONSENT_REQUIRED',
    );
    assert.equal(calls, 0);
    const result = await service.generate(1, request({ allowExternalProcessing: true }));
    assert.equal(calls, 1);
    assert.equal(result.consent.required, true);
    assert.equal(result.consent.granted, true);
  });
});

test('malformed JSON, invalid dates, and extra-long arrays are rejected', async () => {
  await withEnv(enabledMock, async () => {
    const provider = new MockAiProvider();
    const service = new TaskDraftGenerationService(new AiService(provider), quota());
    provider.use({ type: 'text', body: '{not json' });
    await assert.rejects(() => service.generate(1, request()), (error: unknown) => error instanceof AiError && error.code === 'INVALID_PROVIDER_RESPONSE');

    provider.use({
      type: 'json',
      body: { tasks: [{ title: 'Valid title here', description: 'Desc', priority: 'high', dueDate: '2026-13-99' }], warnings: [] },
    });
    await assert.rejects(() => service.generate(1, request()), (error: unknown) => {
      assert.ok(error instanceof Error);
      return true;
    });

    provider.use({
      type: 'json',
      body: {
        tasks: Array.from({ length: 11 }, (_, index) => ({
          title: `Task title ${index + 1}xx`,
          description: 'A useful description.',
          priority: 'low',
          dueDate: null,
        })),
        warnings: [],
      },
    });
    await assert.rejects(() => service.generate(1, request()), (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED');
  });
});

test('provider refusal and rate limits stay typed and do not persist tasks', async () => {
  await withEnv(enabledMock, async () => {
    const provider = new MockAiProvider();
    const service = new TaskDraftGenerationService(new AiService(provider), quota());
    provider.use({ type: 'error', code: 'REFUSAL' });
    await assert.rejects(() => service.generate(1, request()), (error: unknown) => error instanceof AiError && error.code === 'REFUSAL');
    provider.use({ type: 'error', code: 'RATE_LIMITED' });
    await assert.rejects(() => service.generate(1, request()), (error: unknown) => error instanceof AiError && error.code === 'RATE_LIMITED');
  });
});
