import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { ACCESS_COOKIE, CSRF_HEADER_VALUE, JWT_AUDIENCE, JWT_ISSUER, REFRESH_COOKIE } from './auth/auth.constants';
import { bootstrapAdminIfConfigured } from './auth/bootstrap';
import { hashPassword } from './auth/passwords';
import { UsersRepository } from './auth/users.repository';
import { configureApp } from './configure-app';
import { DatabaseService } from './database/database.service';
import { ensureIsolatedTestDatabase } from './testing/test-database';

const EMAIL = 'member@example.com';
const PASSWORD = 'test-password-ok';
const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  'X-Requested-With': CSRF_HEADER_VALUE,
  Origin: 'http://127.0.0.1:4300',
};

let app: INestApplication;
let pool: Pool;
let baseUrl: string;
let testUrl: string;

function parseSetCookie(response: Response): { values: Record<string, string>; headers: string[] } {
  const headers = response.headers.getSetCookie();
  const values: Record<string, string> = {};
  for (const header of headers) {
    const pair = header.split(';', 1)[0];
    const index = pair.indexOf('=');
    values[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return { values, headers };
}

async function json(path: string, init?: RequestInit): Promise<{
  status: number;
  body: Record<string, unknown>;
  cookies: ReturnType<typeof parseSetCookie>;
  response: Response;
}> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json() as Record<string, unknown>;
  return { status: response.status, body, cookies: parseSetCookie(response), response };
}

async function login(email = EMAIL, password = PASSWORD, extraHeaders: Record<string, string> = {}) {
  return json('/api/auth/login', {
    method: 'POST',
    headers: { ...AUTH_HEADERS, ...extraHeaders },
    body: JSON.stringify({ email, password }),
  });
}

async function insertMember(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);
  await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'MEMBER')`,
    [EMAIL, passwordHash],
  );
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-only-jwt-secret-32-chars-min';
  process.env.AUTH_COOKIE_SECURE = 'false';
  process.env.AUTH_WEB_ORIGIN = 'http://127.0.0.1:4300';
  process.env.AUTH_ARGON2_MEMORY = '4096';
  process.env.AUTH_ARGON2_TIME = '1';
  process.env.AUTH_LOGIN_THROTTLE_LIMIT = '1000';
  process.env.AUTH_REFRESH_THROTTLE_LIMIT = '1000';
  delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  testUrl = await ensureIsolatedTestDatabase('flowops_test_auth');
  process.env.DATABASE_URL = testUrl;
  const { AppModule } = await import('./app.module');
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  pool = new Pool({ connectionString: testUrl });
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE refresh_sessions, users RESTART IDENTITY CASCADE');
});

after(async () => {
  await pool?.end();
  await app?.close();
});

test('logs in, sets HttpOnly cookies, and omits secrets from JSON', async () => {
  await insertMember();
  const result = await login();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.user, { id: 1, email: EMAIL, role: 'MEMBER' });
  assert.equal('accessToken' in result.body, false);
  assert.equal('refreshToken' in result.body, false);
  assert.equal('passwordHash' in (result.body.user as object), false);
  const payload = JSON.stringify(result.body);
  assert.equal(payload.includes('$argon2'), false);
  assert.equal(payload.includes(result.cookies.values[ACCESS_COOKIE] ?? 'MISSING'), false);

  const at = result.cookies.headers.find((header) => header.startsWith(`${ACCESS_COOKIE}=`));
  const rt = result.cookies.headers.find((header) => header.startsWith(`${REFRESH_COOKIE}=`));
  assert.match(at ?? '', /HttpOnly/i);
  assert.match(at ?? '', /SameSite=Lax/i);
  assert.match(at ?? '', /Path=\/api(?!\/)/i);
  assert.doesNotMatch(at ?? '', /Domain=/i);
  assert.doesNotMatch(at ?? '', /Secure/i);
  assert.match(rt ?? '', /HttpOnly/i);
  assert.match(rt ?? '', /Path=\/api\/auth/i);
});

test('unknown email and wrong password return the same generic 401', async () => {
  await insertMember();
  const unknown = await login('missing@example.com', PASSWORD);
  const wrong = await login(EMAIL, 'wrong-password-x');
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(unknown.body.message, wrong.body.message);
  assert.equal(unknown.body.message, 'Invalid email or password.');
});

test('rejects invalid login input with 400', async () => {
  const result = await login('bad', 'short');
  assert.equal(result.status, 400);
});

test('stores Argon2id hashes, not plaintext passwords', async () => {
  await insertMember();
  const stored = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users');
  assert.match(stored.rows[0].password_hash, /^\$argon2id\$/);
  assert.equal(stored.rows[0].password_hash.includes(PASSWORD), false);
});

test('GET /api/auth/me accepts the access cookie and a Bearer token', async () => {
  await insertMember();
  const session = await login();
  const access = session.cookies.values[ACCESS_COOKIE];
  const viaCookie = await json('/api/auth/me', { headers: { Cookie: `${ACCESS_COOKIE}=${access}` } });
  assert.equal(viaCookie.status, 200);
  assert.deepEqual(viaCookie.body.user, { id: 1, email: EMAIL, role: 'MEMBER' });

  const viaBearer = await json('/api/auth/me', { headers: { Authorization: `Bearer ${access}` } });
  assert.equal(viaBearer.status, 200);
  assert.equal(viaCookie.response.headers.get('cache-control'), 'no-store');
  assert.equal((await json('/api/auth/me')).status, 401);
});

test('rejects invalid, expired, and mis-issued access tokens', async () => {
  await insertMember();
  const key = new TextEncoder().encode(process.env.JWT_SECRET);
  const expired = await new SignJWT({ role: 'MEMBER' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('1')
    .setJti('expired')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) - 30)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .sign(key);
  const wrongAud = await new SignJWT({ role: 'MEMBER' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('1')
    .setJti('aud')
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(JWT_ISSUER)
    .setAudience('other-app')
    .sign(key);
  const otherKey = new TextEncoder().encode('different-secret-32-chars-minimum');
  const badSig = await new SignJWT({ role: 'MEMBER' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('1')
    .setJti('sig')
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .sign(otherKey);

  assert.equal((await json('/api/auth/me', { headers: { Authorization: `Bearer ${expired}` } })).status, 401);
  assert.equal((await json('/api/auth/me', { headers: { Authorization: `Bearer ${wrongAud}` } })).status, 401);
  assert.equal((await json('/api/auth/me', { headers: { Authorization: `Bearer ${badSig}` } })).status, 401);
});

test('refresh rotates the opaque token and stores only the hash', async () => {
  await insertMember();
  const session = await login();
  const oldRefresh = session.cookies.values[REFRESH_COOKIE];
  const rotated = await json('/api/auth/refresh', {
    method: 'POST',
    headers: { ...AUTH_HEADERS, Cookie: `${REFRESH_COOKIE}=${oldRefresh}` },
  });
  assert.equal(rotated.status, 200);
  const nextRefresh = rotated.cookies.values[REFRESH_COOKIE];
  assert.ok(nextRefresh);
  assert.notEqual(nextRefresh, oldRefresh);

  const rows = await pool.query<{ token_hash: string; replaced_at: Date | null }>(
    'SELECT token_hash, replaced_at FROM refresh_sessions ORDER BY id',
  );
  assert.equal(rows.rowCount, 2);
  assert.ok(rows.rows.every((row) => row.token_hash !== oldRefresh && row.token_hash !== nextRefresh));
  assert.ok(rows.rows[0].replaced_at);

  const reused = await json('/api/auth/refresh', {
    method: 'POST',
    headers: { ...AUTH_HEADERS, Cookie: `${REFRESH_COOKIE}=${oldRefresh}` },
  });
  assert.equal(reused.status, 401);
  const live = await pool.query(
    `SELECT id FROM refresh_sessions WHERE revoked_at IS NULL AND replaced_at IS NULL`,
  );
  assert.equal(live.rowCount, 0);
});

test('logout revokes the family, clears cookies, and is idempotent', async () => {
  await insertMember();
  const session = await login();
  const first = await json('/api/auth/logout', {
    method: 'POST',
    headers: { ...AUTH_HEADERS, Cookie: `${REFRESH_COOKIE}=${session.cookies.values[REFRESH_COOKIE]}` },
  });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { ok: true });
  assert.match(first.cookies.headers.join('\n'), new RegExp(`${ACCESS_COOKIE}=`));
  const refresh = await json('/api/auth/refresh', {
    method: 'POST',
    headers: { ...AUTH_HEADERS, Cookie: `${REFRESH_COOKIE}=${session.cookies.values[REFRESH_COOKIE]}` },
  });
  assert.equal(refresh.status, 401);
  const second = await json('/api/auth/logout', { method: 'POST', headers: AUTH_HEADERS });
  assert.equal(second.status, 200);
});

test('logout with a hostile Origin is rejected and leaves the refresh family live', async () => {
  await insertMember();
  const session = await login();
  const denied = await json('/api/auth/logout', {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      Origin: 'https://evil.example',
      Cookie: `${REFRESH_COOKIE}=${session.cookies.values[REFRESH_COOKIE]}`,
    },
  });
  assert.equal(denied.status, 403);
  const refresh = await json('/api/auth/refresh', {
    method: 'POST',
    headers: { ...AUTH_HEADERS, Cookie: `${REFRESH_COOKIE}=${session.cookies.values[REFRESH_COOKIE]}` },
  });
  assert.equal(refresh.status, 200);
});

test('expired and revoked refresh tokens are rejected', async () => {
  await insertMember();
  const session = await login();
  await pool.query(`UPDATE refresh_sessions SET expires_at = NOW() - INTERVAL '1 hour'`);
  const expired = await json('/api/auth/refresh', {
    method: 'POST',
    headers: { ...AUTH_HEADERS, Cookie: `${REFRESH_COOKIE}=${session.cookies.values[REFRESH_COOKIE]}` },
  });
  assert.equal(expired.status, 401);

  await pool.query('TRUNCATE TABLE refresh_sessions RESTART IDENTITY CASCADE');
  const fresh = await login();
  await pool.query(`UPDATE refresh_sessions SET revoked_at = NOW()`);
  const revoked = await json('/api/auth/refresh', {
    method: 'POST',
    headers: { ...AUTH_HEADERS, Cookie: `${REFRESH_COOKIE}=${fresh.cookies.values[REFRESH_COOKIE]}` },
  });
  assert.equal(revoked.status, 401);
});

test('concurrent refresh of the same token cannot create two live successors', async () => {
  await insertMember();
  const session = await login();
  const cookie = `${REFRESH_COOKIE}=${session.cookies.values[REFRESH_COOKIE]}`;
  const [first, second] = await Promise.all([
    json('/api/auth/refresh', { method: 'POST', headers: { ...AUTH_HEADERS, Cookie: cookie } }),
    json('/api/auth/refresh', { method: 'POST', headers: { ...AUTH_HEADERS, Cookie: cookie } }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 401]);
  const live = await pool.query(
    `SELECT id FROM refresh_sessions
     WHERE revoked_at IS NULL AND replaced_at IS NULL AND expires_at > NOW()`,
  );
  assert.equal(live.rowCount, 0);
});

test('CSRF protection rejects untrusted auth mutations and anonymous tasks stay unauthorized', async () => {
  await insertMember();
  const missingHeader = await json('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4300' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(missingHeader.status, 403);

  const evilOrigin = await login(EMAIL, PASSWORD, { Origin: 'https://evil.example' });
  assert.equal(evilOrigin.status, 403);

  const created = await json('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Anonymous create must fail', team: 'QA', priority: 'low' }),
  });
  assert.equal(created.status, 401);
  const listed = await json('/api/tasks?search=Preserve%20me');
  assert.equal(listed.status, 401);

  const wrongHeader = await json('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: 'http://127.0.0.1:4300',
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(wrongHeader.status, 403);

  const crossSite = await json('/api/auth/login', {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      'Sec-Fetch-Site': 'cross-site',
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(crossSite.status, 403);

  const noOrigin = await login(EMAIL, PASSWORD, { Origin: '' });
  assert.equal(noOrigin.status, 200);
});

test('stale JWT role claims and deleted users are rejected', async () => {
  await insertMember();
  const session = await login();
  const access = session.cookies.values[ACCESS_COOKIE];
  await pool.query(`UPDATE users SET role = 'ADMIN' WHERE email = $1`, [EMAIL]);
  assert.equal((await json('/api/auth/me', { headers: { Cookie: `${ACCESS_COOKIE}=${access}` } })).status, 401);
  await pool.query('TRUNCATE TABLE refresh_sessions, users RESTART IDENTITY CASCADE');
  assert.equal((await json('/api/auth/me', { headers: { Authorization: `Bearer ${access}` } })).status, 401);
});

test('bootstrap creates the first admin once and never resets the hash', async () => {
  process.env.BOOTSTRAP_ALLOW_TEST = 'true';
  process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com';
  process.env.BOOTSTRAP_ADMIN_PASSWORD = 'bootstrap-pass';
  assert.equal(await bootstrapAdminIfConfigured(pool), 'created');
  const users = new UsersRepository({ pool } as DatabaseService);
  const first = await users.findByEmail('admin@example.com');
  assert.equal(first?.role, 'ADMIN');
  assert.match(first?.passwordHash ?? '', /^\$argon2id\$/);
  assert.equal(await bootstrapAdminIfConfigured(pool), 'skipped');
  assert.equal((await users.findByEmail('admin@example.com'))?.passwordHash, first?.passwordHash);

  process.env.BOOTSTRAP_ADMIN_PASSWORD = '';
  await assert.rejects(() => bootstrapAdminIfConfigured(pool), /both BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD/);
  delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  delete process.env.BOOTSTRAP_ALLOW_TEST;

  await pool.query(
    `INSERT INTO tasks (title, team, priority, owner_id) VALUES ('Preserve me', 'QA', 'low', $1)`,
    [first?.id],
  );
  const preserved = await pool.query(`SELECT title FROM tasks WHERE title = 'Preserve me'`);
  assert.equal(preserved.rowCount, 1);
});
