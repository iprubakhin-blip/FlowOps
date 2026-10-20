import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { CSRF_HEADER_VALUE } from './auth/auth.constants';
import { hashPassword } from './auth/passwords';
import { signAccessToken } from './auth/tokens';
import { UserRole } from './auth/auth.types';
import { configureApp } from './configure-app';
import { runMigrations } from './database/migrate';
import { AI_PROVIDER } from './ai/ai.types';
import { MockAiProvider } from './ai/mock-ai.provider';
import { PORTAL_REQUIREMENTS } from './ai/task-draft.fixtures';
import { ensureIsolatedTestDatabase, resetPublicSchema } from './testing/test-database';

const PASSWORD = 'test-password-ok';

interface FixtureUser {
  id: number;
  email: string;
  role: UserRole;
}

let app: INestApplication;
let pool: Pool;
let baseUrl: string;
let admin: FixtureUser;
let member: FixtureUser;

async function json(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function authed(user: FixtureUser, init: RequestInit = {}, csrf = true): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = await signAccessToken(user.id, user.role);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (csrf) headers.set('X-Requested-With', CSRF_HEADER_VALUE);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('Origin', 'http://127.0.0.1:4300');
  return json('/api/ai/task-drafts', { method: 'POST', ...init, headers });
}

async function insertUser(email: string, role: UserRole): Promise<FixtureUser> {
  const passwordHash = await hashPassword(PASSWORD);
  const result = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id`,
    [email, passwordHash, role],
  );
  return { id: result.rows[0].id, email, role };
}

const body = JSON.stringify({ requirements: PORTAL_REQUIREMENTS, team: 'Platform' });

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-only-jwt-secret-32-chars-min';
  process.env.AUTH_COOKIE_SECURE = 'false';
  process.env.AUTH_WEB_ORIGIN = 'http://127.0.0.1:4300';
  process.env.AUTH_ARGON2_MEMORY = '4096';
  process.env.AUTH_ARGON2_TIME = '1';
  process.env.AI_ENABLED = 'true';
  process.env.AI_PROVIDER = 'mock';
  process.env.AI_MAX_REQUESTS_PER_USER_DAY = '3';
  delete process.env.OPENAI_API_KEY;
  const testUrl = await ensureIsolatedTestDatabase('flowops_test_ai_drafts');
  process.env.DATABASE_URL = testUrl;
  const resetPool = new Pool({ connectionString: testUrl });
  await resetPublicSchema(resetPool, testUrl);
  await runMigrations(resetPool);
  await resetPool.end();
  const { AppModule } = await import('./app.module');
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  pool = new Pool({ connectionString: testUrl });
});

after(async () => {
  await app?.close();
  await pool?.end();
  delete process.env.AI_ENABLED;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MAX_REQUESTS_PER_USER_DAY;
  delete process.env.OPENAI_API_KEY;
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE ai_request_quotas, refresh_sessions, tasks, users RESTART IDENTITY CASCADE');
  admin = await insertUser('admin@example.com', 'ADMIN');
  member = await insertUser('member@example.com', 'MEMBER');
});

test('capabilities require auth, consume no quota, and omit secrets', async () => {
  const anonymous = await json('/api/ai/capabilities');
  assert.equal(anonymous.status, 401);
  const token = await signAccessToken(member.id, member.role);
  const result = await json('/api/ai/capabilities', {
    headers: { Authorization: `Bearer ${token}`, Origin: 'http://127.0.0.1:4300' },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.enabled, true);
  assert.equal(result.body.provider, 'mock');
  assert.equal(result.body.externalProcessingRequired, false);
  assert.equal(typeof result.body.maxRequirementsChars, 'number');
  assert.equal(result.body.maxDrafts, 10);
  assert.equal('openaiApiKey' in result.body, false);
  assert.doesNotMatch(JSON.stringify(result.body), /sk-/);
  const quota = await pool.query('SELECT count(*)::int AS count FROM ai_request_quotas');
  assert.equal(quota.rows[0].count, 0);
});

test('anonymous task-draft requests are unauthorized', async () => {
  const result = await json('/api/ai/task-drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': CSRF_HEADER_VALUE, Origin: 'http://127.0.0.1:4300' },
    body,
  });
  assert.equal(result.status, 401);
});

test('cookie/bearer CSRF is required and MEMBER/ADMIN can generate mock drafts', async () => {
  const noCsrf = await authed(member, { body }, false);
  assert.equal(noCsrf.status, 403);
  const memberResult = await authed(member, { body });
  assert.equal(memberResult.status, 200);
  assert.equal(memberResult.body.persisted, false);
  assert.equal(memberResult.body.team, 'Platform');
  assert.ok(Array.isArray(memberResult.body.tasks));
  const tasks = memberResult.body.tasks as Array<Record<string, unknown>>;
  assert.ok(tasks.length >= 1);
  assert.equal(tasks[0].status, 'todo');
  assert.equal('ownerId' in tasks[0], false);
  const before = await pool.query('SELECT count(*)::int AS count FROM tasks');
  assert.equal(before.rows[0].count, 0);
  const adminResult = await authed(admin, { body });
  assert.equal(adminResult.status, 200);
});

test('validation and quota are enforced without writing tasks', async () => {
  const empty = await authed(member, { body: JSON.stringify({ requirements: '', team: 'Platform' }) });
  assert.equal(empty.status, 400);
  const extra = await authed(member, { body: JSON.stringify({ requirements: PORTAL_REQUIREMENTS, team: 'Platform', ownerId: 99 }) });
  assert.equal(extra.status, 400);
  assert.equal((await authed(member, { body })).status, 200);
  assert.equal((await authed(member, { body })).status, 200);
  assert.equal((await authed(member, { body })).status, 200);
  const blocked = await authed(member, { body });
  assert.equal(blocked.status, 429);
  assert.equal((blocked.body as { error?: string }).error, 'QUOTA_EXCEEDED');
  const other = await authed(admin, { body });
  assert.equal(other.status, 200);
  const count = await pool.query('SELECT count(*)::int AS count FROM tasks');
  assert.equal(count.rows[0].count, 0);
});

test('failed mock generation still consumes quota and OpenAI consent is enforced from config', async () => {
  const provider = app.get(AI_PROVIDER);
  assert.ok(provider instanceof MockAiProvider);
  provider.use({ type: 'error', code: 'PROVIDER_UNAVAILABLE' });
  const failed = await authed(member, { body });
  assert.equal(failed.status, 503);
  provider.reset();
  assert.equal((await authed(member, { body })).status, 200);
  assert.equal((await authed(member, { body })).status, 200);
  const blocked = await authed(member, { body });
  assert.equal(blocked.status, 429);

  process.env.AI_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
  const denied = await authed(admin, {
    body: JSON.stringify({ requirements: PORTAL_REQUIREMENTS, team: 'Platform', allowExternalProcessing: false }),
  });
  assert.equal(denied.status, 400);
  assert.equal((denied.body as { error?: string }).error, 'CONSENT_REQUIRED');
  process.env.AI_PROVIDER = 'mock';
  delete process.env.OPENAI_API_KEY;
});
