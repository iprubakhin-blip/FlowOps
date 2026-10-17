import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { CSRF_HEADER_VALUE } from './auth/auth.constants';
import { hashPassword } from './auth/passwords';
import { configureApp } from './configure-app';
import { ensureIsolatedTestDatabase } from './testing/test-database';

let app: INestApplication;
let pool: Pool;
let baseUrl: string;

before(async () => {
  process.env.JWT_SECRET = 'test-only-jwt-secret-32-chars-min';
  process.env.AUTH_COOKIE_SECURE = 'false';
  process.env.AUTH_WEB_ORIGIN = 'http://127.0.0.1:4300';
  process.env.AUTH_ARGON2_MEMORY = '4096';
  process.env.AUTH_ARGON2_TIME = '1';
  process.env.AUTH_LOGIN_THROTTLE_LIMIT = '5';
  process.env.AUTH_REFRESH_THROTTLE_LIMIT = '3';
  delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const testUrl = await ensureIsolatedTestDatabase('flowops_test_auth_rl');
  process.env.DATABASE_URL = testUrl;
  const { AppModule } = await import('./app.module');
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  pool = new Pool({ connectionString: testUrl });
  await pool.query('TRUNCATE TABLE refresh_sessions, users RESTART IDENTITY CASCADE');
  await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'MEMBER')`,
    ['rate@example.com', await hashPassword('test-password-ok')],
  );
});

after(async () => {
  await pool?.end();
  await app?.close();
});

test('login returns 429 after five attempts in a minute', async () => {
  const statuses: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': CSRF_HEADER_VALUE,
        Origin: 'http://127.0.0.1:4300',
      },
      body: JSON.stringify({ email: 'rate@example.com', password: 'wrong-password-x' }),
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.equal(statuses[5], 429);
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
});

test('refresh returns 429 after the configured per-IP limit', async () => {
  const statuses: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const response = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'X-Requested-With': CSRF_HEADER_VALUE,
        Origin: 'http://127.0.0.1:4300',
        Cookie: 'flowops_rt=not-a-session',
      },
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses.slice(0, 3), [401, 401, 401]);
  assert.equal(statuses[3], 429);
});
