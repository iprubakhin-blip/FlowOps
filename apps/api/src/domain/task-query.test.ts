import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTaskListSql,
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
  paginationMeta,
  parseListQuery,
} from './task-query';

test('applies list query defaults', () => {
  assert.deepEqual(parseListQuery({}), {
    page: DEFAULT_PAGE,
    limit: DEFAULT_LIMIT,
    status: undefined,
    priority: undefined,
    search: undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
});

test('parses valid filters, search, sort and paging', () => {
  assert.deepEqual(parseListQuery({
    page: '2',
    limit: '10',
    status: 'todo',
    priority: 'high',
    search: '  gateway  ',
    sortBy: 'title',
    sortOrder: 'asc',
  }), {
    page: 2,
    limit: 10,
    status: 'todo',
    priority: 'high',
    search: 'gateway',
    sortBy: 'title',
    sortOrder: 'asc',
  });
});

test('rejects invalid list query values', () => {
  assert.throws(() => parseListQuery({ page: '0' }), /page/);
  assert.throws(() => parseListQuery({ page: '1.5' }), /page/);
  assert.throws(() => parseListQuery({ limit: 'abc' }), /limit/);
  assert.throws(() => parseListQuery({ limit: String(MAX_LIMIT + 1) }), /limit/);
  assert.throws(() => parseListQuery({ status: 'archived' }), /status/);
  assert.throws(() => parseListQuery({ priority: 'urgent' }), /priority/);
  assert.throws(() => parseListQuery({ sortBy: 'secret' }), /sortBy/);
  assert.throws(() => parseListQuery({ sortOrder: 'up' }), /sortOrder/);
  assert.throws(() => parseListQuery({ search: 'x'.repeat(121) }), /search/);
  assert.throws(() => parseListQuery({ status: ['todo', 'done'] }), /Repeated/);
});

test('builds parameterized filters and a deterministic whitelist order', () => {
  const sql = buildTaskListSql({
    page: 3,
    limit: 10,
    status: 'in_progress',
    priority: 'high',
    search: 'api%_\\',
    sortBy: 'title',
    sortOrder: 'asc',
  });

  assert.equal(sql.offset, 20);
  assert.equal(sql.limit, 10);
  assert.equal(sql.whereSql, 'WHERE status = $1 AND priority = $2 AND (title ILIKE $3 ESCAPE \'\\\' OR team ILIKE $3 ESCAPE \'\\\')');
  assert.deepEqual(sql.params, ['in_progress', 'high', '%api\\%\\_\\\\%']);
  assert.equal(sql.orderSql, 'title ASC, id ASC');
  assert.match(sql.orderSql, /^(id|title|team|priority|status|created_at|updated_at) (ASC|DESC), id (ASC|DESC)$/);
});

test('ignores untrusted sort identifiers by requiring a parsed query', () => {
  const sql = buildTaskListSql(parseListQuery({ sortBy: 'createdAt', sortOrder: 'desc' }));
  assert.equal(sql.orderSql, 'created_at DESC, id DESC');
  assert.equal(sql.whereSql, '');
  assert.deepEqual(sql.params, []);
});

test('computes pagination metadata including empty results', () => {
  assert.deepEqual(paginationMeta(47, 2, 20), { page: 2, limit: 20, total: 47, totalPages: 3 });
  assert.deepEqual(paginationMeta(0, 1, 20), { page: 1, limit: 20, total: 0, totalPages: 0 });
});
