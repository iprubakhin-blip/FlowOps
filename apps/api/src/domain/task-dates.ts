import { ValidationError } from '../http/validation-error';
import { TaskStatus } from './tasks';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** UTC calendar date YYYY-MM-DD. Due dates are dates, not instants. */
export function utcCalendarDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function parseCalendarDate(value: unknown, field = 'dueDate'): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be YYYY-MM-DD or null.`);
  }
  const match = DATE_ONLY.exec(value);
  if (!match) {
    throw new ValidationError(`${field} must be YYYY-MM-DD or null.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new ValidationError(`${field} must be a real calendar date.`);
  }
  return value;
}

/**
 * Overdue = has a due date before the current UTC calendar date and status is not done.
 * Due today is not overdue. Missing due dates are not overdue.
 */
export function isTaskOverdue(
  dueDate: string | null,
  status: TaskStatus,
  now = new Date(),
): boolean {
  if (!dueDate || status === 'done') return false;
  return dueDate < utcCalendarDate(now);
}

export const UTC_OVERDUE_SQL = `(due_at IS NOT NULL AND due_at < (timezone('utc', now()))::date AND status <> 'done')`;
