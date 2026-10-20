import assert from 'node:assert/strict';
import test from 'node:test';
import { isTaskOverdue, parseCalendarDate, utcCalendarDate } from './task-dates';

test('utcCalendarDate uses the UTC calendar day, not the local timezone', () => {
  assert.equal(utcCalendarDate(new Date('2026-01-15T23:30:00.000Z')), '2026-01-15');
  assert.equal(utcCalendarDate(new Date('2026-01-16T00:00:00.000Z')), '2026-01-16');
  assert.equal(utcCalendarDate(new Date('2026-01-16T02:00:00.000+05:00')), '2026-01-15');
});

test('parseCalendarDate accepts YYYY-MM-DD or null and rejects invalid calendars', () => {
  assert.equal(parseCalendarDate(null), null);
  assert.equal(parseCalendarDate('2026-02-28'), '2026-02-28');
  assert.throws(() => parseCalendarDate('2026-02-30'), /real calendar/);
  assert.throws(() => parseCalendarDate('2026-13-01'), /real calendar/);
  assert.throws(() => parseCalendarDate('2026-1-1'), /YYYY-MM-DD/);
  assert.throws(() => parseCalendarDate('2026-01-01T00:00:00.000Z'), /YYYY-MM-DD/);
  assert.throws(() => parseCalendarDate(20260101), /YYYY-MM-DD/);
});

test('overdue is UTC-date-before-today and unfinished', () => {
  const now = new Date('2026-03-10T00:30:00.000Z');
  assert.equal(isTaskOverdue('2026-03-09', 'todo', now), true);
  assert.equal(isTaskOverdue('2026-03-09', 'in_progress', now), true);
  assert.equal(isTaskOverdue('2026-03-10', 'todo', now), false);
  assert.equal(isTaskOverdue('2026-03-11', 'todo', now), false);
  assert.equal(isTaskOverdue('2026-03-09', 'done', now), false);
  assert.equal(isTaskOverdue(null, 'todo', now), false);
});
