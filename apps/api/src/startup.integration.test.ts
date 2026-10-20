import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './configure-app';
import { ensureIsolatedTestDatabase } from './testing/test-database';

const previous: Record<string, string | undefined> = {};

function snapshotEnv(keys: string[]): void {
  for (const key of keys) previous[key] = process.env[key];
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

before(async () => {
  snapshotEnv([
    'NODE_ENV',
    'JWT_SECRET',
    'AUTH_COOKIE_SECURE',
    'AUTH_ACCESS_TTL_SECONDS',
    'AUTH_ARGON2_MEMORY',
    'AUTH_ARGON2_TIME',
    'AUTH_LOGIN_THROTTLE_LIMIT',
    'AUTH_REFRESH_THROTTLE_LIMIT',
    'DATABASE_URL',
    'AI_ENABLED',
    'AI_PROVIDER',
    'AI_MODEL',
    'OPENAI_API_KEY',
    'AI_MAX_INPUT_CHARS',
    'AI_MAX_OUTPUT_TOKENS',
    'AI_REQUEST_TIMEOUT_MS',
    'AI_MAX_REQUESTS_PER_USER_DAY',
  ]);
  process.env.DATABASE_URL = await ensureIsolatedTestDatabase('flowops_test_startup');
  delete process.env.AUTH_ACCESS_TTL_SECONDS;
  delete process.env.AUTH_ARGON2_MEMORY;
  delete process.env.AUTH_ARGON2_TIME;
  delete process.env.AUTH_LOGIN_THROTTLE_LIMIT;
  delete process.env.AUTH_REFRESH_THROTTLE_LIMIT;
  delete process.env.AI_ENABLED;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_MAX_INPUT_CHARS;
  delete process.env.AI_MAX_OUTPUT_TOKENS;
  delete process.env.AI_REQUEST_TIMEOUT_MS;
  delete process.env.AI_MAX_REQUESTS_PER_USER_DAY;
});

after(() => {
  restoreEnv();
});

test('Nest startup without AI keys leaves AI disabled', async () => {
  process.env.NODE_ENV = 'development';
  process.env.JWT_SECRET = 'development-jwt-secret-32-chars-min';
  process.env.AUTH_COOKIE_SECURE = 'false';
  delete process.env.AI_ENABLED;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_MAX_INPUT_CHARS;
  delete process.env.AI_MAX_OUTPUT_TOKENS;
  delete process.env.AI_REQUEST_TIMEOUT_MS;
  delete process.env.AI_MAX_REQUESTS_PER_USER_DAY;
  const { AppModule } = await import('./app.module');
  const { AiService } = await import('./ai/ai.service');
  const { AiError } = await import('./ai/ai.errors');
  const { ILLUSTRATIVE_NOTE_SCHEMA } = await import('./ai/ai.fixtures');
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    configureApp(app);
    const ai = app.get(AiService);
    await assert.rejects(
      () => ai.generateStructured({
        systemInstruction: 'Return JSON only.',
        userInput: 'Draft a note.',
        schemaName: 'illustrative.note',
        schema: ILLUSTRATIVE_NOTE_SCHEMA,
      }),
      (error: unknown) => error instanceof AiError && error.code === 'AI_DISABLED',
    );
  } finally {
    await app.close();
  }
});

test('enabled OpenAI without a key fails closed at Nest startup', async () => {
  process.env.NODE_ENV = 'development';
  process.env.JWT_SECRET = 'development-jwt-secret-32-chars-min';
  process.env.AUTH_COOKIE_SECURE = 'false';
  process.env.AI_ENABLED = 'true';
  process.env.AI_PROVIDER = 'openai';
  delete process.env.OPENAI_API_KEY;
  const { AppModule } = await import('./app.module');
  await assert.rejects(
    () => NestFactory.create(AppModule, { logger: false, abortOnError: false }),
    (error: unknown) => error instanceof Error && /OPENAI_API_KEY is required/.test(error.message) && !error.message.includes('sk-'),
  );
  delete process.env.AI_ENABLED;
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
});

test('production Nest startup refuses insecure cookies before listen', async () => {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'production-jwt-secret-32-chars-min';
  process.env.AUTH_COOKIE_SECURE = 'false';
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    assert.throws(() => configureApp(app), /AUTH_COOKIE_SECURE=false is not allowed/);
  } finally {
    await app.close();
  }
});

test('production Nest startup refuses a missing JWT secret', async () => {
  process.env.NODE_ENV = 'production';
  process.env.AUTH_COOKIE_SECURE = 'true';
  delete process.env.JWT_SECRET;
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    assert.throws(() => configureApp(app), /JWT_SECRET is required in production/);
  } finally {
    await app.close();
  }
});
