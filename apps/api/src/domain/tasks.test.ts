import assert from 'node:assert/strict';
import test from 'node:test';
import { isPriority, isStatus, MAX_DESCRIPTION_LENGTH, parseBulkCreate, parseCreateTask, parsePatchTask } from './tasks';

test('accepts a valid new task and trims its text fields', () => {
  assert.deepEqual(parseCreateTask({ title: '  Fix API errors  ', team: '  Platform ', priority: 'high' }), {
    title: 'Fix API errors',
    team: 'Platform',
    priority: 'high',
    description: null,
    dueDate: null,
  });
});

test('accepts optional description and dueDate on create', () => {
  assert.deepEqual(
    parseCreateTask({
      title: 'Ship dates',
      team: 'Backend',
      priority: 'low',
      description: '  notes  ',
      dueDate: '2026-04-01',
    }),
    {
      title: 'Ship dates',
      team: 'Backend',
      priority: 'low',
      description: 'notes',
      dueDate: '2026-04-01',
    },
  );
});

test('rejects client-supplied owner, completion and status fields', () => {
  const base = { title: 'Owned by server', team: 'Backend', priority: 'low' };
  assert.throws(() => parseCreateTask({ ...base, ownerId: 99 }), /ownerId/);
  assert.throws(() => parseCreateTask({ ...base, owner_id: 99 }), /owner_id/);
  assert.throws(() => parseCreateTask({ ...base, role: 'ADMIN' }), /role/);
  assert.throws(() => parseCreateTask({ ...base, completedAt: '2026-01-01T00:00:00.000Z' }), /completedAt/);
  assert.throws(() => parseCreateTask({ ...base, status: 'done' }), /status/);
});

test('rejects missing fields, unsupported priorities and invalid optional fields', () => {
  assert.throws(() => parseCreateTask({ title: 'x', team: 'IT', priority: 'high' }), /Title/);
  assert.throws(() => parseCreateTask({ title: 'Real task', team: 'IT', priority: 'urgent' }), /Priority/);
  assert.throws(() => parseCreateTask(null), /object/);
  assert.throws(
    () => parseCreateTask({ title: 'Real task', team: 'IT', priority: 'low', description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) }),
    /description/,
  );
  assert.throws(
    () => parseCreateTask({ title: 'Real task', team: 'IT', priority: 'low', dueDate: '2026-02-30' }),
    /calendar/,
  );
});

test('parseBulkCreate stamps the request team and rejects forged persistence fields', () => {
  const tasks = parseBulkCreate({
    team: 'Platform',
    tasks: [
      { title: 'First task here', description: 'notes', priority: 'high', dueDate: null },
      { title: 'Second task here', priority: 'low' },
    ],
  });
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].team, 'Platform');
  assert.equal(tasks[1].dueDate, null);
  assert.equal(tasks[1].description, null);
  assert.throws(() => parseBulkCreate({ team: 'Platform', tasks: [] }), /between/);
  assert.throws(
    () => parseBulkCreate({
      team: 'Platform',
      tasks: Array.from({ length: 11 }, (_, index) => ({ title: `Task title ${index + 1}xx`, priority: 'low' })),
    }),
    /between/,
  );
  assert.throws(
    () => parseBulkCreate({ team: 'Platform', ownerId: 9, tasks: [{ title: 'Valid title here', priority: 'low' }] }),
    /ownerId/,
  );
  assert.throws(
    () => parseBulkCreate({ team: 'Platform', tasks: [{ title: 'Valid title here', priority: 'low', status: 'done' }] }),
    /status/,
  );
  assert.throws(
    () => parseBulkCreate({ team: 'Platform', tasks: [{ title: 'Valid title here', priority: 'low', completedAt: null }] }),
    /completedAt/,
  );
  assert.throws(
    () => parseBulkCreate({ team: 'Platform', tasks: [{ title: 'Valid title here', priority: 'low', id: 4 }] }),
    /id/,
  );
  assert.throws(
    () => parseBulkCreate({ team: 'Platform', tasks: [{ title: 'Valid title here', priority: 'low', team: 'Other' }] }),
    /team/,
  );
});

test('parsePatchTask requires at least one editable field and rejects mass assignment', () => {
  assert.throws(() => parsePatchTask({}), /At least one/);
  assert.throws(() => parsePatchTask({ ownerId: 1, title: 'Nope' }), /ownerId/);
  assert.throws(() => parsePatchTask({ status: 'done' }), /status/);
  assert.throws(() => parsePatchTask({ completedAt: null }), /completedAt/);
  assert.throws(() => parsePatchTask({ secret: true }), /Unsupported/);
  assert.deepEqual(parsePatchTask({ description: null, dueDate: null }), { description: null, dueDate: null });
  assert.deepEqual(parsePatchTask({ title: '  Edited  ' }), { title: 'Edited' });
});

test('recognizes only allowed task statuses', () => {
  assert.equal(isStatus('in_progress'), true);
  assert.equal(isStatus('archived'), false);
});

test('recognizes only allowed task priorities', () => {
  assert.equal(isPriority('medium'), true);
  assert.equal(isPriority('urgent'), false);
});
