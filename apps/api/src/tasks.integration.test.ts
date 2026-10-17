import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { PaginatedTasks } from './domain/task-query';
import { Task } from './domain/tasks';
import { TasksController } from './tasks.controller';
import { TasksRepository } from './tasks.repository';
import { configureApp } from './configure-app';
import { ensureIsolatedTestDatabase } from './testing/test-database';

// tsx/esbuild does not emit design:paramtypes; Nest constructor injection needs it.
Reflect.defineMetadata('design:paramtypes', [TasksRepository], TasksController);

let app: INestApplication;
let pool: Pool;
let baseUrl: string;

async function json(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

async function seed(rows: Array<{
  title: string;
  team: string;
  priority: 'low' | 'medium' | 'high';
  status?: 'todo' | 'in_progress' | 'done';
  createdAt: string;
}>): Promise<void> {
  for (const row of rows) {
    await pool.query(
      `INSERT INTO tasks (title, team, priority, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [row.title, row.team, row.priority, row.status ?? 'todo', row.createdAt],
    );
  }
}

before(async () => {
  const testUrl = await ensureIsolatedTestDatabase();
  process.env.DATABASE_URL = testUrl;
  const { AppModule } = await import('./app.module');
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  pool = new Pool({ connectionString: testUrl });
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
});

after(async () => {
  await pool?.end();
  await app?.close();
});

test('defaults to page 1, limit 20, createdAt desc', async () => {
  await seed(Array.from({ length: 25 }, (_, index) => ({
    title: `Task ${String(index + 1).padStart(2, '0')}`,
    team: 'Backend',
    priority: 'medium',
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  })));
  const { status, body } = await json('/api/tasks');
  assert.equal(status, 200);
  const result = body as PaginatedTasks;
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
  const { body } = await json('/api/tasks?page=2&limit=5');
  const result = body as PaginatedTasks;
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
    const { status, body } = await json(path);
    assert.equal(status, 400, path);
    assert.equal((body as { statusCode: number }).statusCode, 400);
  }
});

test('filters by status and priority', async () => {
  await seed([
    { title: 'A', team: 'Frontend', priority: 'high', status: 'todo', createdAt: '2026-01-01T00:00:00.000Z' },
    { title: 'B', team: 'Frontend', priority: 'high', status: 'done', createdAt: '2026-01-02T00:00:00.000Z' },
    { title: 'C', team: 'Backend', priority: 'low', status: 'todo', createdAt: '2026-01-03T00:00:00.000Z' },
  ]);
  const highTodo = await json('/api/tasks?status=todo&priority=high');
  const result = highTodo.body as PaginatedTasks;
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
  const teamSearch = await json('/api/tasks?search=Front');
  assert.equal((teamSearch.body as PaginatedTasks).pagination.total, 1);
  const percent = await json(`/api/tasks?search=${encodeURIComponent('100%')}`);
  assert.deepEqual((percent.body as PaginatedTasks).items.map((item) => item.title), ['100% complete']);
  const underscore = await json('/api/tasks?search=a_b');
  assert.deepEqual((underscore.body as PaginatedTasks).items.map((item) => item.title), ['a_b gateway']);
});

test('sorts deterministically with an id tie-breaker', async () => {
  const stamp = '2026-02-01T12:00:00.000Z';
  await seed([
    { title: 'First insert', team: 'A', priority: 'low', createdAt: stamp },
    { title: 'Second insert', team: 'A', priority: 'low', createdAt: stamp },
  ]);
  const desc = await json('/api/tasks?sortBy=createdAt&sortOrder=desc');
  assert.deepEqual((desc.body as PaginatedTasks).items.map((item) => item.title), ['Second insert', 'First insert']);
  const asc = await json('/api/tasks?sortBy=title&sortOrder=asc');
  assert.deepEqual((asc.body as PaginatedTasks).items.map((item) => item.title), ['First insert', 'Second insert']);
});

test('returns empty items with accurate pagination metadata', async () => {
  await seed([{ title: 'Only one', team: 'QA', priority: 'medium', createdAt: '2026-01-01T00:00:00.000Z' }]);
  const { body } = await json('/api/tasks?search=no-such-task');
  assert.deepEqual(body, {
    items: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
});

test('creates a task and updates its status', async () => {
  const created = await json('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Ship integration tests', team: 'Backend', priority: 'high' }),
  });
  assert.equal(created.status, 201);
  const task = created.body as Task;
  assert.equal(task.status, 'todo');
  const patched = await json(`/api/tasks/${task.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done' }),
  });
  assert.equal(patched.status, 200);
  assert.equal((patched.body as Task).status, 'done');
  const listed = await json('/api/tasks?status=done');
  assert.equal((listed.body as PaginatedTasks).pagination.total, 1);
});
