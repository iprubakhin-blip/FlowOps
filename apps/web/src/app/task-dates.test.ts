import assert from 'node:assert/strict';
import test from 'node:test';
import { completionLabel, formatCalendarDate, isCalendarDate } from './task-dates';

test('due dates display as calendar days without timezone shifting', () => {
  assert.equal(formatCalendarDate('2026-01-02'), 'Jan 2, 2026');
  assert.equal(formatCalendarDate('2026-12-31'), 'Dec 31, 2026');
  assert.equal(formatCalendarDate(null), '');
  assert.equal(isCalendarDate('2026-02-30'), false);
  assert.equal(isCalendarDate('2026-02-28'), true);
});

test('overdue is not inferred from a due date string in the display helper', () => {
  assert.equal(formatCalendarDate('2020-01-01'), 'Jan 1, 2020');
});

test('done without completedAt is not fabricated', () => {
  assert.equal(completionLabel('done', null), 'Completion time unavailable');
  assert.equal(completionLabel('todo', null), null);
  assert.equal(completionLabel('done', '2026-03-10T12:00:00.000Z'), '2026-03-10T12:00:00.000Z');
});
