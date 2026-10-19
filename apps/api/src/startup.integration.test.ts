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
  ]);
  process.env.DATABASE_URL = await ensureIsolatedTestDatabase('flowops_test_startup');
  delete process.env.AUTH_ACCESS_TTL_SECONDS;
  delete process.env.AUTH_ARGON2_MEMORY;
  delete process.env.AUTH_ARGON2_TIME;
  delete process.env.AUTH_LOGIN_THROTTLE_LIMIT;
  delete process.env.AUTH_REFRESH_THROTTLE_LIMIT;
});

after(() => {
  restoreEnv();
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
