import assert from 'node:assert/strict';
import test from 'node:test';
import { isStatus, parseCreateTask } from './tasks';

test('accepts a valid new task and trims its text fields', () => {
  assert.deepEqual(parseCreateTask({ title: '  Fix API errors  ', team: '  Platform ', priority: 'high' }), {
    title: 'Fix API errors', team: 'Platform', priority: 'high',
  });
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
