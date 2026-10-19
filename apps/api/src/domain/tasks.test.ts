import assert from 'node:assert/strict';
import test from 'node:test';
import { isPriority, isStatus, parseCreateTask } from './tasks';

test('accepts a valid new task and trims its text fields', () => {
  assert.deepEqual(parseCreateTask({ title: '  Fix API errors  ', team: '  Platform ', priority: 'high' }), {
    title: 'Fix API errors', team: 'Platform', priority: 'high',
  });
});

test('ignores client-supplied owner and role fields', () => {
  assert.deepEqual(
    parseCreateTask({
      title: 'Owned by server',
      team: 'Backend',
      priority: 'low',
      ownerId: 99,
      owner_id: 99,
      role: 'ADMIN',
    }),
    { title: 'Owned by server', team: 'Backend', priority: 'low' },
  );
});

test('rejects missing fields and unsupported priorities', () => {
  assert.throws(() => parseCreateTask({ title: 'x', team: 'IT', priority: 'high' }), /Title/);
  assert.throws(() => parseCreateTask({ title: 'Real task', team: 'IT', priority: 'urgent' }), /Priority/);
  assert.throws(() => parseCreateTask(null), /object/);
});

test('recognizes only allowed task statuses', () => {
  assert.equal(isStatus('in_progress'), true);
  assert.equal(isStatus('archived'), false);
});

test('recognizes only allowed task priorities', () => {
  assert.equal(isPriority('medium'), true);
  assert.equal(isPriority('urgent'), false);
});
