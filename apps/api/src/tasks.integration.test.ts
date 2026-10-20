import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { ACCESS_COOKIE, CSRF_HEADER_VALUE, JWT_AUDIENCE, JWT_ISSUER } from './auth/auth.constants';
import { hashPassword } from './auth/passwords';
import { signAccessToken } from './auth/tokens';
import { UserRole } from './auth/auth.types';
import { PaginatedTasks } from './domain/task-query';
import { Task, TaskSummary } from './domain/tasks';
import { TasksController } from './tasks.controller';
import { TasksRepository } from './tasks.repository';
import { configureApp } from './configure-app';
import { ensureIsolatedTestDatabase, resetPublicSchema } from './testing/test-database';

Reflect.defineMetadata('design:paramtypes', [TasksRepository], TasksController);

const PASSWORD = 'test-password-ok';
const CSRF_HEADERS = {
  'Content-Type': 'application/json',
  'X-Requested-With': CSRF_HEADER_VALUE,
  Origin: 'http://127.0.0.1:4300',
};

interface FixtureUser {
  id: number;
  email: string;
  role: UserRole;
}

let app: INestApplication;
let pool: Pool;
let baseUrl: string;
let admin: FixtureUser;
let memberA: FixtureUser;
let memberB: FixtureUser;

async function json(path: string, init?: RequestInit): Promise<{
  status: number;
  body: Record<string, unknown>;
  response: Response;
}> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() as Record<string, unknown>, response };
}

async function authed(
  user: FixtureUser,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = await signAccessToken(user.id, user.role);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (!headers.has('X-Requested-With')) headers.set('X-Requested-With', CSRF_HEADER_VALUE);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }
  return json(path, { ...init, headers });
}

async function insertUser(email: string, role: UserRole): Promise<FixtureUser> {
  const passwordHash = await hashPassword(PASSWORD);
  const result = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id`,
    [email, passwordHash, role],
  );
  return { id: result.rows[0].id, email, role };
}

async function seed(rows: Array<{
  title: string;
  team: string;
  priority: 'low' | 'medium' | 'high';
  status?: 'todo' | 'in_progress' | 'done';
  createdAt: string;
  ownerId?: number;
}>): Promise<void> {
  for (const row of rows) {
    await pool.query(
      `INSERT INTO tasks (title, team, priority, status, created_at, updated_at, owner_id)
       VALUES ($1, $2, $3, $4, $5, $5, $6)`,
      [row.title, row.team, row.priority, row.status ?? 'todo', row.createdAt, row.ownerId ?? admin.id],
    );
  }
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
  const testUrl = await ensureIsolatedTestDatabase();
  process.env.DATABASE_URL = testUrl;
  const resetPool = new Pool({ connectionString: testUrl });
  await resetPublicSchema(resetPool, testUrl);
  await resetPool.end();
  const { AppModule } = await import('./app.module');
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  pool = new Pool({ connectionString: testUrl });
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE refresh_sessions, tasks, users RESTART IDENTITY CASCADE');
  admin = await insertUser('admin@example.com', 'ADMIN');
  memberA = await insertUser('member-a@example.com', 'MEMBER');
  memberB = await insertUser('member-b@example.com', 'MEMBER');
});

after(async () => {
  await pool?.end();
  await app?.close();
});

test('anonymous task requests return 401', async () => {
  assert.equal((await json('/api/tasks')).status, 401);
  assert.equal((await json('/api/tasks/summary')).status, 401);
  assert.equal((await json('/api/tasks', {
    method: 'POST',
    headers: CSRF_HEADERS,
    body: JSON.stringify({ title: 'Nope', team: 'QA', priority: 'low' }),
  })).status, 401);
  assert.equal((await json('/api/tasks/1/status', {
    method: 'PATCH',
    headers: CSRF_HEADERS,
    body: JSON.stringify({ status: 'done' }),
  })).status, 401);
  assert.equal((await json('/api/tasks/1', {
    method: 'PATCH',
    headers: CSRF_HEADERS,
    body: JSON.stringify({ title: 'Nope' }),
  })).status, 401);
});

test('invalid JWT is rejected with 401', async () => {
  const key = new TextEncoder().encode('different-secret-32-chars-minimum');
  const bad = await new SignJWT({ role: 'ADMIN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(admin.id))
    .setJti('bad')
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .sign(key);
  const result = await json('/api/tasks', { headers: { Authorization: `Bearer ${bad}` } });
  assert.equal(result.status, 401);
});

test('cookie and Bearer authentication both list tasks', async () => {
  await seed([{ title: 'Admin visible', team: 'QA', priority: 'low', createdAt: '2026-01-01T00:00:00.000Z' }]);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email: admin.email, password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  const access = login.headers.getSetCookie().find((header) => header.startsWith(`${ACCESS_COOKIE}=`))?.split(';', 1)[0];
  assert.ok(access);
  const viaCookie = await json('/api/tasks', { headers: { Cookie: access } });
  assert.equal(viaCookie.status, 200);
  assert.equal((viaCookie.body as unknown as PaginatedTasks).pagination.total, 1);

  const viaBearer = await authed(admin, '/api/tasks');
  assert.equal(viaBearer.status, 200);
  assert.equal((viaBearer.body as unknown as PaginatedTasks).pagination.total, 1);
  assert.equal(viaCookie.response.headers.get('cache-control'), 'no-store');
});

test('Bearer identity wins over a cookie and JWT role spoofing is rejected', async () => {
  await seed([
    { title: 'A only', team: 'QA', priority: 'low', createdAt: '2026-01-01T00:00:00.000Z', ownerId: memberA.id },
    { title: 'B only', team: 'QA', priority: 'low', createdAt: '2026-01-02T00:00:00.000Z', ownerId: memberB.id },
  ]);
  const tokenA = await signAccessToken(memberA.id, memberA.role);
  const tokenB = await signAccessToken(memberB.id, memberB.role);
  const mixed = await json('/api/tasks', {
    headers: { Authorization: `Bearer ${tokenB}`, Cookie: `${ACCESS_COOKIE}=${tokenA}` },
  });
  const mixedBody = mixed.body as unknown as PaginatedTasks;
  assert.equal(mixed.status, 200);
  assert.equal(mixedBody.pagination.total, 1);
  assert.equal(mixedBody.items[0].title, 'B only');

  const spoofedAdmin = await signAccessToken(memberA.id, 'ADMIN');
  assert.equal((await json('/api/tasks', { headers: { Authorization: `Bearer ${spoofedAdmin}` } })).status, 401);
});

test('defaults to page 1, limit 20, createdAt desc', async () => {
  await seed(Array.from({ length: 25 }, (_, index) => ({
    title: `Task ${String(index + 1).padStart(2, '0')}`,
    team: 'Backend',
    priority: 'medium',
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  })));
  const { status, body } = await authed(admin, '/api/tasks');
  assert.equal(status, 200);
  const result = body as unknown as PaginatedTasks;
  assert.equal(result.items.length, 20);
  assert.deepEqual(result.pagination, { page: 1, limit: 20, total: 25, totalPages: 2 });
  assert.equal(result.items[0].title, 'Task 25');
});

test('applies custom page and limit', async () => {
  await seed(Array.from({ length: 12 }, (_, index) => ({
    title: `Item ${index + 1}`,
    team: 'QA',
    priority: 'low',
    createdAt: new Date(Date.UTC(2026, 0, 2, 0, index)).toISOString(),
  })));
  const { body } = await authed(admin, '/api/tasks?page=2&limit=5');
  const result = body as unknown as PaginatedTasks;
  assert.equal(result.items.length, 5);
  assert.deepEqual(result.pagination, { page: 2, limit: 5, total: 12, totalPages: 3 });
  assert.equal(result.items[0].title, 'Item 7');
});

test('rejects limit above the maximum and invalid query values with 400', async () => {
  const cases = [
    '/api/tasks?limit=101',
    '/api/tasks?page=0',
    '/api/tasks?status=archived',
    '/api/tasks?priority=urgent',
    '/api/tasks?sortBy=secret',
    '/api/tasks?sortOrder=up',
  ];
  for (const path of cases) {
    const { status, body } = await authed(admin, path);
    assert.equal(status, 400, path);
    assert.equal(body.statusCode, 400);
  }
});

test('filters by status and priority', async () => {
  await seed([
    { title: 'A', team: 'Frontend', priority: 'high', status: 'todo', createdAt: '2026-01-01T00:00:00.000Z' },
    { title: 'B', team: 'Frontend', priority: 'high', status: 'done', createdAt: '2026-01-02T00:00:00.000Z' },
    { title: 'C', team: 'Backend', priority: 'low', status: 'todo', createdAt: '2026-01-03T00:00:00.000Z' },
  ]);
  const highTodo = await authed(admin, '/api/tasks?status=todo&priority=high');
  const result = highTodo.body as unknown as PaginatedTasks;
  assert.equal(result.pagination.total, 1);
  assert.equal(result.items[0].title, 'A');
});

test('search matches title or team and treats % and _ as literals', async () => {
  await seed([
    { title: '100% complete', team: 'Platform', priority: 'low', createdAt: '2026-01-01T00:00:00.000Z' },
    { title: '100 complete', team: 'Platform', priority: 'low', createdAt: '2026-01-02T00:00:00.000Z' },
    { title: 'a_b gateway', team: 'Ops', priority: 'low', createdAt: '2026-01-03T00:00:00.000Z' },
    { title: 'axb gateway', team: 'Ops', priority: 'low', createdAt: '2026-01-04T00:00:00.000Z' },
    { title: 'Unrelated', team: 'Frontend', priority: 'low', createdAt: '2026-01-05T00:00:00.000Z' },
  ]);
  const teamSearch = await authed(admin, '/api/tasks?search=Front');
  assert.equal((teamSearch.body as unknown as PaginatedTasks).pagination.total, 1);
  const percent = await authed(admin, `/api/tasks?search=${encodeURIComponent('100%')}`);
  assert.deepEqual((percent.body as unknown as PaginatedTasks).items.map((item) => item.title), ['100% complete']);
  const underscore = await authed(admin, '/api/tasks?search=a_b');
  assert.deepEqual((underscore.body as unknown as PaginatedTasks).items.map((item) => item.title), ['a_b gateway']);
});

test('sorts deterministically with an id tie-breaker', async () => {
  const stamp = '2026-02-01T12:00:00.000Z';
  await seed([
    { title: 'First insert', team: 'A', priority: 'low', createdAt: stamp },
    { title: 'Second insert', team: 'A', priority: 'low', createdAt: stamp },
  ]);
  const desc = await authed(admin, '/api/tasks?sortBy=createdAt&sortOrder=desc');
  assert.deepEqual((desc.body as unknown as PaginatedTasks).items.map((item) => item.title), ['Second insert', 'First insert']);
  const asc = await authed(admin, '/api/tasks?sortBy=title&sortOrder=asc');
  assert.deepEqual((asc.body as unknown as PaginatedTasks).items.map((item) => item.title), ['First insert', 'Second insert']);
});

test('returns empty items with accurate pagination metadata', async () => {
  await seed([{ title: 'Only one', team: 'QA', priority: 'medium', createdAt: '2026-01-01T00:00:00.000Z' }]);
  const { body } = await authed(admin, '/api/tasks?search=no-such-task');
  assert.deepEqual(body, {
    items: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
});

test('creates a task owned by the authenticated user and updates its status', async () => {
  const created = await authed(memberA, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Ship integration tests', team: 'Backend', priority: 'high' }),
  });
  assert.equal(created.status, 201);
  const task = created.body as unknown as Task;
  assert.equal(task.status, 'todo');
  assert.equal(task.ownerId, memberA.id);
  assert.equal(task.description, null);
  assert.equal(task.dueDate, null);
  assert.equal(task.completedAt, null);
  assert.equal(task.isOverdue, false);
  const patched = await authed(memberA, `/api/tasks/${task.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done' }),
  });
  assert.equal(patched.status, 200);
  assert.equal((patched.body as unknown as Task).status, 'done');
  const listed = await authed(memberA, '/api/tasks?status=done');
  assert.equal((listed.body as unknown as PaginatedTasks).pagination.total, 1);
});

test('members only see and count their own tasks; admin sees all', async () => {
  await seed([
    { title: 'A secret', team: 'Backend', priority: 'high', createdAt: '2026-01-01T00:00:00.000Z', ownerId: memberA.id },
    { title: 'B secret', team: 'Backend', priority: 'high', createdAt: '2026-01-02T00:00:00.000Z', ownerId: memberB.id },
    { title: 'Admin task', team: 'Platform', priority: 'low', createdAt: '2026-01-03T00:00:00.000Z', ownerId: admin.id },
  ]);

  const aList = (await authed(memberA, '/api/tasks')).body as unknown as PaginatedTasks;
  assert.deepEqual(aList.items.map((item) => item.title), ['A secret']);
  assert.equal(aList.pagination.total, 1);

  const bList = (await authed(memberB, '/api/tasks')).body as unknown as PaginatedTasks;
  assert.deepEqual(bList.items.map((item) => item.title), ['B secret']);
  assert.equal(bList.pagination.total, 1);

  const adminList = (await authed(admin, '/api/tasks')).body as unknown as PaginatedTasks;
  assert.equal(adminList.pagination.total, 3);
  assert.deepEqual(adminList.items.map((item) => item.title), ['Admin task', 'B secret', 'A secret']);
});

test('search, filters, sort and pagination stay inside the member owner scope', async () => {
  await seed([
    { title: 'alpha gate', team: 'Frontend', priority: 'high', status: 'todo', createdAt: '2026-01-01T00:00:00.000Z', ownerId: memberA.id },
    { title: 'beta gate', team: 'Frontend', priority: 'high', status: 'todo', createdAt: '2026-01-02T00:00:00.000Z', ownerId: memberA.id },
    { title: 'gamma gate', team: 'Frontend', priority: 'high', status: 'todo', createdAt: '2026-01-03T00:00:00.000Z', ownerId: memberA.id },
    { title: 'other gate', team: 'Frontend', priority: 'high', status: 'todo', createdAt: '2026-01-04T00:00:00.000Z', ownerId: memberB.id },
    { title: 'A low', team: 'QA', priority: 'low', status: 'done', createdAt: '2026-01-05T00:00:00.000Z', ownerId: memberA.id },
  ]);

  const search = (await authed(memberA, '/api/tasks?search=gate')).body as unknown as PaginatedTasks;
  assert.equal(search.pagination.total, 3);
  assert.equal(search.items.some((item) => item.title === 'other gate'), false);

  const filtered = (await authed(memberA, '/api/tasks?status=todo&priority=high')).body as unknown as PaginatedTasks;
  assert.equal(filtered.pagination.total, 3);

  const sorted = (await authed(memberA, '/api/tasks?sortBy=title&sortOrder=asc')).body as unknown as PaginatedTasks;
  assert.deepEqual(sorted.items.map((item) => item.title), ['A low', 'alpha gate', 'beta gate', 'gamma gate']);

  const page = (await authed(memberA, '/api/tasks?page=2&limit=2&sortBy=createdAt&sortOrder=asc')).body as unknown as PaginatedTasks;
  assert.deepEqual(page.pagination, { page: 2, limit: 2, total: 4, totalPages: 2 });
  assert.equal(page.items.length, 2);
  assert.deepEqual(page.items.map((item) => item.title), ['gamma gate', 'A low']);

  const spoof = (await authed(memberA, `/api/tasks?ownerId=${memberB.id}&owner_id=${memberB.id}`)).body as unknown as PaginatedTasks;
  assert.equal(spoof.pagination.total, 4);
  assert.equal(spoof.items.some((item) => item.ownerId === memberB.id), false);
});

test('member cannot update another user task; admin can; missing tasks are 404', async () => {
  await seed([
    { title: 'B only', team: 'QA', priority: 'low', createdAt: '2026-01-01T00:00:00.000Z', ownerId: memberB.id },
  ]);
  const bTask = (await authed(memberB, '/api/tasks')).body as unknown as PaginatedTasks;
  const bId = bTask.items[0].id;

  const denied = await authed(memberA, `/api/tasks/${bId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done', role: 'ADMIN', ownerId: memberB.id }),
  });
  assert.equal(denied.status, 404);
  assert.equal(typeof denied.body.message, 'string');
  assert.equal(JSON.stringify(denied.body).includes('B only'), false);

  const stillB = await pool.query<{ status: string }>('SELECT status FROM tasks WHERE id = $1', [bId]);
  assert.equal(stillB.rows[0].status, 'todo');

  const adminPatch = await authed(admin, `/api/tasks/${bId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'in_progress' }),
  });
  assert.equal(adminPatch.status, 200);
  assert.equal((adminPatch.body as unknown as Task).status, 'in_progress');

  const missing = await authed(admin, '/api/tasks/99999/status', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done' }),
  });
  assert.equal(missing.status, 404);
});

test('cookie-authenticated writes without the CSRF header are rejected', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email: memberA.email, password: PASSWORD }),
  });
  const access = login.headers.getSetCookie().find((header) => header.startsWith(`${ACCESS_COOKIE}=`))?.split(';', 1)[0];
  assert.ok(access);
  const created = await json('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: access, Origin: 'http://127.0.0.1:4300' },
    body: JSON.stringify({ title: 'CSRF blocked', team: 'QA', priority: 'low' }),
  });
  assert.equal(created.status, 403);
  const seeded = await authed(memberA, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'CSRF patch target', team: 'QA', priority: 'low' }),
  });
  assert.equal(seeded.status, 201);
  const patch = await json(`/api/tasks/${(seeded.body as { id: number }).id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: access, Origin: 'http://127.0.0.1:4300' },
    body: JSON.stringify({ status: 'done' }),
  });
  assert.equal(patch.status, 403);
  const count = await pool.query('SELECT COUNT(*)::int AS total FROM tasks');
  assert.equal(count.rows[0].total, 1);
  const editBlocked = await json(`/api/tasks/${(seeded.body as { id: number }).id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: access, Origin: 'http://127.0.0.1:4300' },
    body: JSON.stringify({ title: 'CSRF edit blocked' }),
  });
  assert.equal(editBlocked.status, 403);
});

test('invalid task input is 400 and repository failures are generic 500', async () => {
  const invalid = await authed(admin, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'x', team: 'QA', priority: 'low' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(JSON.stringify(invalid.body).includes('ECONNREFUSED'), false);

  const original = TasksRepository.prototype.findPage;
  TasksRepository.prototype.findPage = async () => {
    throw new Error('ECONNREFUSED secret-db-host');
  };
  try {
    const failed = await authed(admin, '/api/tasks');
    assert.equal(failed.status, 500);
    const payload = JSON.stringify(failed.body);
    assert.equal(payload.includes('ECONNREFUSED'), false);
    assert.equal(payload.includes('secret-db-host'), false);
  } finally {
    TasksRepository.prototype.findPage = original;
  }
});

test('create rejects forged owner and invalid optional fields; accepts description and dueDate', async () => {
  const forged = await authed(memberA, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Forge owner', team: 'Backend', priority: 'high', ownerId: admin.id }),
  });
  assert.equal(forged.status, 400);

  const tooLong = await authed(memberA, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Long notes', team: 'Backend', priority: 'low', description: 'x'.repeat(5001) }),
  });
  assert.equal(tooLong.status, 400);

  const badDate = await authed(memberA, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Bad date', team: 'Backend', priority: 'low', dueDate: '2026-02-30' }),
  });
  assert.equal(badDate.status, 400);

  const created = await authed(memberA, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Documented task',
      team: 'Backend',
      priority: 'medium',
      description: 'Ship M3.1-A',
      dueDate: '2099-12-31',
    }),
  });
  assert.equal(created.status, 201);
  const task = created.body as unknown as Task;
  assert.equal(task.ownerId, memberA.id);
  assert.equal(task.description, 'Ship M3.1-A');
  assert.equal(task.dueDate, '2099-12-31');
  assert.equal(task.completedAt, null);
  assert.equal(task.isOverdue, false);
  assert.equal(task.status, 'todo');
});

test('MEMBER edits own task; cannot edit another user; ADMIN can; missing is 404', async () => {
  const own = await authed(memberA, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Editable', team: 'QA', priority: 'low', description: 'keep me', dueDate: '2026-08-01' }),
  });
  const other = await authed(memberB, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'B only edit', team: 'QA', priority: 'low' }),
  });
  assert.equal(own.status, 201);
  const ownId = (own.body as unknown as Task).id;
  const otherId = (other.body as unknown as Task).id;

  const edited = await authed(memberA, `/api/tasks/${ownId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Edited title', priority: 'high' }),
  });
  assert.equal(edited.status, 200);
  const after = edited.body as unknown as Task;
  assert.equal(after.title, 'Edited title');
  assert.equal(after.team, 'QA');
  assert.equal(after.priority, 'high');
  assert.equal(after.description, 'keep me');
  assert.equal(after.dueDate, '2026-08-01');

  const cleared = await authed(memberA, `/api/tasks/${ownId}`, {
    method: 'PATCH',
    body: JSON.stringify({ description: null, dueDate: null }),
  });
  assert.equal(cleared.status, 200);
  assert.equal((cleared.body as unknown as Task).description, null);
  assert.equal((cleared.body as unknown as Task).dueDate, null);

  const denied = await authed(memberA, `/api/tasks/${otherId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Hijack' }),
  });
  assert.equal(denied.status, 404);
  const stillB = await pool.query<{ title: string }>('SELECT title FROM tasks WHERE id = $1', [otherId]);
  assert.equal(stillB.rows[0].title, 'B only edit');

  const adminEdit = await authed(admin, `/api/tasks/${otherId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Admin renamed' }),
  });
  assert.equal(adminEdit.status, 200);
  assert.equal((adminEdit.body as unknown as Task).title, 'Admin renamed');

  const mass = await authed(memberA, `/api/tasks/${ownId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Should not apply', ownerId: memberB.id, status: 'done', completedAt: '2020-01-01T00:00:00.000Z' }),
  });
  assert.equal(mass.status, 400);
  const unchanged = await pool.query<{ title: string; status: string; owner_id: number }>(
    'SELECT title, status, owner_id FROM tasks WHERE id = $1',
    [ownId],
  );
  assert.equal(unchanged.rows[0].title, 'Edited title');
  assert.equal(unchanged.rows[0].status, 'todo');
  assert.equal(unchanged.rows[0].owner_id, memberA.id);

  assert.equal((await authed(admin, '/api/tasks/99999', {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Missing' }),
  })).status, 404);
});

test('status transitions own completedAt; repeating done does not fabricate a timestamp', async () => {
  const created = await authed(memberA, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Complete me', team: 'QA', priority: 'low' }),
  });
  const id = (created.body as unknown as Task).id;

  const toProgress = await authed(memberA, `/api/tasks/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'in_progress' }),
  });
  assert.equal((toProgress.body as unknown as Task).completedAt, null);

  const doneFromProgress = await authed(memberA, `/api/tasks/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done' }),
  });
  const firstDone = doneFromProgress.body as unknown as Task;
  assert.equal(firstDone.status, 'done');
  assert.equal(typeof firstDone.completedAt, 'string');
  assert.match(firstDone.completedAt ?? '', /T/);

  const reopen = await authed(memberA, `/api/tasks/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'todo' }),
  });
  assert.equal((reopen.body as unknown as Task).completedAt, null);

  const doneFromTodo = await authed(memberA, `/api/tasks/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done' }),
  });
  const secondStamp = (doneFromTodo.body as unknown as Task).completedAt;
  assert.ok(secondStamp);

  await pool.query(`UPDATE tasks SET completed_at = '2020-01-01T00:00:00.000Z' WHERE id = $1`, [id]);
  const repeat = await authed(memberA, `/api/tasks/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done' }),
  });
  assert.equal((repeat.body as unknown as Task).completedAt, '2020-01-01T00:00:00.000Z');
});

test('isOverdue follows the UTC calendar policy for list and summary', async () => {
  await pool.query(
    `INSERT INTO tasks (title, team, priority, status, owner_id, due_at)
     VALUES
       ('yesterday open', 'QA', 'high', 'todo', $1, (timezone('utc', now()))::date - 1),
       ('today open', 'QA', 'low', 'todo', $1, (timezone('utc', now()))::date),
       ('tomorrow open', 'QA', 'low', 'todo', $1, (timezone('utc', now()))::date + 1),
       ('yesterday done', 'QA', 'high', 'done', $1, (timezone('utc', now()))::date - 1),
       ('no due', 'QA', 'high', 'todo', $1, NULL)`,
    [memberA.id],
  );

  const listed = (await authed(memberA, '/api/tasks?sortBy=title&sortOrder=asc')).body as unknown as PaginatedTasks;
  const byTitle = Object.fromEntries(listed.items.map((item) => [item.title, item]));
  assert.equal(byTitle['yesterday open']?.isOverdue, true);
  assert.equal(byTitle['today open']?.isOverdue, false);
  assert.equal(byTitle['tomorrow open']?.isOverdue, false);
  assert.equal(byTitle['yesterday done']?.isOverdue, false);
  assert.equal(byTitle['no due']?.isOverdue, false);

  const summary = (await authed(memberA, '/api/tasks/summary')).body as unknown as TaskSummary;
  assert.equal(summary.overdue, 1);
  assert.equal(summary.total, 5);
  assert.equal(summary.todo, 4);
  assert.equal(summary.done, 1);
  assert.equal(summary.highPriorityOpen, 2);
});

test('summary is scoped, aggregated in SQL, and independent of pagination', async () => {
  const empty = (await authed(memberA, '/api/tasks/summary')).body as unknown as TaskSummary;
  assert.deepEqual(empty, { total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0, highPriorityOpen: 0 });

  await pool.query(
    `INSERT INTO tasks (title, team, priority, status, owner_id, due_at)
     VALUES
       ('A todo', 'QA', 'high', 'todo', $1, (timezone('utc', now()))::date - 2),
       ('A progress', 'QA', 'low', 'in_progress', $1, NULL),
       ('A done', 'QA', 'high', 'done', $1, (timezone('utc', now()))::date - 2),
       ('B todo', 'QA', 'high', 'todo', $2, (timezone('utc', now()))::date - 2)`,
    [memberA.id, memberB.id],
  );
  for (let index = 0; index < 8; index += 1) {
    await pool.query(
      `INSERT INTO tasks (title, team, priority, owner_id) VALUES ($1, 'QA', 'low', $2)`,
      [`A extra ${index}`, memberA.id],
    );
  }

  const memberSummary = (await authed(memberA, '/api/tasks/summary')).body as unknown as TaskSummary;
  assert.equal(memberSummary.total, 11);
  assert.equal(memberSummary.todo, 9);
  assert.equal(memberSummary.inProgress, 1);
  assert.equal(memberSummary.done, 1);
  assert.equal(memberSummary.overdue, 1);
  assert.equal(memberSummary.highPriorityOpen, 1);

  const page = (await authed(memberA, '/api/tasks?page=1&limit=2')).body as unknown as PaginatedTasks;
  assert.equal(page.pagination.total, 11);
  assert.equal(page.items.length, 2);
  const afterPage = (await authed(memberA, '/api/tasks/summary')).body as unknown as TaskSummary;
  assert.deepEqual(afterPage, memberSummary);

  const spoof = await authed(memberA, `/api/tasks/summary?ownerId=${memberB.id}`);
  assert.equal(spoof.status, 200);
  assert.deepEqual(spoof.body, memberSummary);

  const adminSummary = (await authed(admin, '/api/tasks/summary')).body as unknown as TaskSummary;
  assert.equal(adminSummary.total, 12);
  assert.equal(adminSummary.overdue, 2);
  assert.equal(adminSummary.highPriorityOpen, 2);
});

function bulkBody(tasks: Array<Record<string, unknown>>, team = 'Platform'): string {
  return JSON.stringify({ team, tasks });
}

test('anonymous bulk create is unauthorized and missing CSRF is rejected', async () => {
  const anonymous = await json('/api/tasks/bulk', {
    method: 'POST',
    headers: CSRF_HEADERS,
    body: bulkBody([{ title: 'Bulk anonymous', priority: 'low' }]),
  });
  assert.equal(anonymous.status, 401);
  const token = await signAccessToken(memberA.id, memberA.role);
  const noCsrf = await json('/api/tasks/bulk', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4300' },
    body: bulkBody([{ title: 'Bulk no csrf', priority: 'low' }]),
  });
  assert.equal(noCsrf.status, 403);
});

test('MEMBER and ADMIN bulk-create own todo tasks; forged fields are rejected', async () => {
  const memberResult = await authed(memberA, '/api/tasks/bulk', {
    method: 'POST',
    body: bulkBody([
      { title: 'Member bulk one', description: 'first', priority: 'medium', dueDate: null },
      { title: 'Member bulk two', priority: 'high', dueDate: '2026-11-02' },
    ]),
  });
  assert.equal(memberResult.status, 201);
  assert.equal(memberResult.body.createdCount, 2);
  const items = memberResult.body.items as unknown as Task[];
  assert.ok(items.every((task) => task.ownerId === memberA.id && task.status === 'todo' && task.team === 'Platform'));
  assert.equal(items[0].dueDate, null);
  assert.equal(items[1].dueDate, '2026-11-02');

  const adminResult = await authed(admin, '/api/tasks/bulk', {
    method: 'POST',
    body: bulkBody([{ title: 'Admin bulk one', priority: 'low' }]),
  });
  assert.equal(adminResult.status, 201);
  const adminItems = adminResult.body.items as unknown as Task[];
  assert.equal(adminItems[0].ownerId, admin.id);

  assert.equal((await authed(memberA, '/api/tasks/bulk', {
    method: 'POST',
    body: JSON.stringify({ team: 'Platform', ownerId: admin.id, tasks: [{ title: 'Forge owner', priority: 'low' }] }),
  })).status, 400);
  assert.equal((await authed(memberA, '/api/tasks/bulk', {
    method: 'POST',
    body: bulkBody([{ title: 'Forge status', priority: 'low', status: 'done' }]),
  })).status, 400);
  assert.equal((await authed(memberA, '/api/tasks/bulk', {
    method: 'POST',
    body: bulkBody([{ title: 'Forge completed', priority: 'low', completedAt: '2026-01-01T00:00:00.000Z' }]),
  })).status, 400);
  assert.equal((await authed(memberA, '/api/tasks/bulk', {
    method: 'POST',
    body: JSON.stringify({ team: 'Platform', model: 'gpt', tasks: [{ title: 'Forge model', priority: 'low' }] }),
  })).status, 400);

  const listed = (await authed(memberA, '/api/tasks?search=Member%20bulk')).body as unknown as PaginatedTasks;
  assert.equal(listed.pagination.total, 2);
  assert.ok(listed.items.every((task) => task.ownerId === memberA.id));
  const summary = (await authed(memberA, '/api/tasks/summary')).body as unknown as TaskSummary;
  assert.equal(summary.total, 2);
  assert.equal(summary.todo, 2);

  const beforeQuota = await pool.query('SELECT count(*)::int AS count FROM ai_request_quotas');
  await authed(memberA, '/api/tasks/bulk', {
    method: 'POST',
    body: bulkBody([{ title: 'Quota untouched', priority: 'low' }]),
  });
  const afterQuota = await pool.query('SELECT count(*)::int AS count FROM ai_request_quotas');
  assert.equal(beforeQuota.rows[0].count, 0);
  assert.equal(afterQuota.rows[0].count, 0);
});

test('bulk create validates the whole batch and rolls back a mid-transaction database failure', async () => {
  assert.equal((await authed(memberA, '/api/tasks/bulk', {
    method: 'POST',
    body: bulkBody([]),
  })).status, 400);
  assert.equal((await authed(memberA, '/api/tasks/bulk', {
    method: 'POST',
    body: bulkBody(Array.from({ length: 11 }, (_, index) => ({ title: `Too many ${index} task`, priority: 'low' }))),
  })).status, 400);

  const invalid = await authed(memberA, '/api/tasks/bulk', {
    method: 'POST',
    body: bulkBody([
      { title: 'Valid title here', priority: 'low' },
      { title: 'x', priority: 'low' },
    ]),
  });
  assert.equal(invalid.status, 400);
  const afterInvalid = await pool.query('SELECT count(*)::int AS count FROM tasks');
  assert.equal(afterInvalid.rows[0].count, 0);

  const ten = await authed(memberA, '/api/tasks/bulk', {
    method: 'POST',
    body: bulkBody(Array.from({ length: 10 }, (_, index) => ({
      title: `Ten batch ${String(index + 1).padStart(2, '0')}`,
      priority: 'medium',
    }))),
  });
  assert.equal(ten.status, 201);
  assert.equal(ten.body.createdCount, 10);

  await pool.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
  await pool.query(`
    CREATE OR REPLACE FUNCTION flowops_fail_second_bulk() RETURNS trigger AS $$
    BEGIN
      IF (SELECT count(*) FROM tasks WHERE title LIKE 'BULK-FAIL-%') >= 1 THEN
        RAISE EXCEPTION 'simulated bulk failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS flowops_fail_second_bulk ON tasks;
    CREATE TRIGGER flowops_fail_second_bulk BEFORE INSERT ON tasks
    FOR EACH ROW EXECUTE FUNCTION flowops_fail_second_bulk();
  `);
  try {
    const failed = await authed(memberA, '/api/tasks/bulk', {
      method: 'POST',
      body: bulkBody([
        { title: 'BULK-FAIL-ONE', priority: 'low' },
        { title: 'BULK-FAIL-TWO', priority: 'low' },
      ]),
    });
    assert.equal(failed.status, 500);
    const leftover = await pool.query(`SELECT count(*)::int AS count FROM tasks WHERE title LIKE 'BULK-FAIL-%'`);
    assert.equal(leftover.rows[0].count, 0);
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS flowops_fail_second_bulk ON tasks');
    await pool.query('DROP FUNCTION IF EXISTS flowops_fail_second_bulk()');
  }

  const single = await authed(memberA, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Single still works', team: 'QA', priority: 'low' }),
  });
  assert.equal(single.status, 201);
});
