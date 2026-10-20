import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_DESCRIPTION_LENGTH, Task } from './models/task';
import { buildCreateBody, buildEditPatch, taskToDraft } from './task-payloads';

const task: Task = {
  id: 4,
  title: 'Original',
  team: 'QA',
  priority: 'low',
  status: 'todo',
  ownerId: 7,
  description: 'Keep me',
  dueDate: '2026-08-01',
  completedAt: null,
  isOverdue: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

test('create with description and due date omits owner and completion fields', () => {
  const body = buildCreateBody({
    title: 'Ship UI',
    team: 'Frontend',
    priority: 'high',
    description: '  notes  ',
    dueDate: '2026-10-20',
  });
  assert.deepEqual(body, {
    title: 'Ship UI',
    team: 'Frontend',
    priority: 'high',
    description: 'notes',
    dueDate: '2026-10-20',
  });
  assert.equal('ownerId' in body, false);
  assert.equal('completedAt' in body, false);
  assert.equal('status' in body, false);
});

test('create without optional fields sends only title team priority', () => {
  const body = buildCreateBody({
    title: 'Bare',
    team: 'QA',
    priority: 'low',
    description: '  ',
    dueDate: '',
  });
  assert.deepEqual(body, { title: 'Bare', team: 'QA', priority: 'low' });
});

test('invalid description and calendar date are rejected before submit', () => {
  assert.equal(
    'error' in buildCreateBody({
      title: 'Valid title',
      team: 'QA',
      priority: 'low',
      description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1),
      dueDate: '',
    }),
    true,
  );
  assert.equal(
    'error' in buildCreateBody({
      title: 'Valid title',
      team: 'QA',
      priority: 'low',
      description: '',
      dueDate: '2026-02-30',
    }),
    true,
  );
});

test('edit form prepopulates existing values', () => {
  assert.deepEqual(taskToDraft(task), {
    title: 'Original',
    team: 'QA',
    priority: 'low',
    description: 'Keep me',
    dueDate: '2026-08-01',
  });
});

test('partial update payload includes only changed fields', () => {
  const patch = buildEditPatch(task, { ...taskToDraft(task), title: 'Renamed', priority: 'high' });
  assert.deepEqual(patch, { title: 'Renamed', priority: 'high' });
  assert.equal('status' in patch, false);
  assert.equal('ownerId' in patch, false);
  assert.equal('completedAt' in patch, false);
});

test('explicit empty strings clear description and due date with null', () => {
  const patch = buildEditPatch(task, { ...taskToDraft(task), description: '', dueDate: '' });
  assert.deepEqual(patch, { description: null, dueDate: null });
});

test('unchanged edit does not build a patch', () => {
  assert.deepEqual(buildEditPatch(task, taskToDraft(task)), { empty: true });
});
