import { ValidationError } from '../http/validation-error';
import { parseCalendarDate } from './task-dates';

export const STATUSES = ['todo', 'in_progress', 'done'] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;
export const MAX_DESCRIPTION_LENGTH = 5000;

export type TaskStatus = (typeof STATUSES)[number];
export type TaskPriority = (typeof PRIORITIES)[number];

export interface Task {
  id: number;
  title: string;
  team: string;
  priority: TaskPriority;
  status: TaskStatus;
  ownerId: number;
  description: string | null;
  dueDate: string | null;
  completedAt: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewTask {
  title: string;
  team: string;
  priority: TaskPriority;
  description: string | null;
  dueDate: string | null;
}

export const MIN_BULK_TASKS = 1;
export const MAX_BULK_TASKS = 10;

export interface TaskPatch {
  title?: string;
  team?: string;
  priority?: TaskPriority;
  description?: string | null;
  dueDate?: string | null;
}

export interface TaskSummary {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  overdue: number;
  highPriorityOpen: number;
}

const PATCH_ALLOWED = new Set(['title', 'team', 'priority', 'description', 'dueDate']);
const BULK_ALLOWED = new Set(['team', 'tasks']);
const BULK_TASK_ALLOWED = new Set(['title', 'description', 'priority', 'dueDate']);
const FORBIDDEN = new Set(['ownerId', 'owner_id', 'completedAt', 'completed_at', 'status', 'id', 'isOverdue', 'role']);

export function isStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && STATUSES.some((status) => status === value);
}

export function isPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && PRIORITIES.some((priority) => priority === value);
}

export function parseCreateTask(input: unknown): NewTask {
  const raw = requireObject(input);
  rejectForbidden(raw);
  const title = parseTaskTitle(raw.title);
  const team = parseTaskTeam(raw.team);
  if (typeof raw.priority !== 'string' || !isPriority(raw.priority)) {
    throw new ValidationError('Priority must be low, medium or high.');
  }
  return {
    title,
    team,
    priority: raw.priority,
    description: raw.description === undefined ? null : parseDescription(raw.description),
    dueDate: raw.dueDate === undefined ? null : parseCalendarDate(raw.dueDate),
  };
}

export function parseBulkCreate(input: unknown): NewTask[] {
  const raw = requireObject(input);
  rejectForbidden(raw);
  for (const key of Object.keys(raw)) {
    if (!BULK_ALLOWED.has(key)) {
      throw new ValidationError(`Unsupported field: ${key}.`);
    }
  }
  const team = parseTaskTeam(raw.team);
  if (!Array.isArray(raw.tasks)) {
    throw new ValidationError('tasks must be an array.');
  }
  if (raw.tasks.length < MIN_BULK_TASKS || raw.tasks.length > MAX_BULK_TASKS) {
    throw new ValidationError(`tasks must contain between ${MIN_BULK_TASKS} and ${MAX_BULK_TASKS} items.`);
  }
  return raw.tasks.map((item) => parseBulkItem(item, team));
}

function parseBulkItem(input: unknown, team: string): NewTask {
  const raw = requireObject(input);
  rejectForbidden(raw);
  if (Object.prototype.hasOwnProperty.call(raw, 'team')) {
    throw new ValidationError('team cannot be set on individual bulk tasks.');
  }
  for (const key of Object.keys(raw)) {
    if (!BULK_TASK_ALLOWED.has(key)) {
      throw new ValidationError(`Unsupported field: ${key}.`);
    }
  }
  return parseCreateTask({
    title: raw.title,
    team,
    priority: raw.priority,
    description: raw.description,
    dueDate: raw.dueDate,
  });
}

export function parsePatchTask(input: unknown): TaskPatch {
  const raw = requireObject(input);
  rejectForbidden(raw);
  for (const key of Object.keys(raw)) {
    if (!PATCH_ALLOWED.has(key)) {
      throw new ValidationError(`Unsupported field: ${key}.`);
    }
  }
  const patch: TaskPatch = {};
  if (Object.prototype.hasOwnProperty.call(raw, 'title')) patch.title = parseTaskTitle(raw.title);
  if (Object.prototype.hasOwnProperty.call(raw, 'team')) patch.team = parseTaskTeam(raw.team);
  if (Object.prototype.hasOwnProperty.call(raw, 'priority')) {
    if (typeof raw.priority !== 'string' || !isPriority(raw.priority)) {
      throw new ValidationError('Priority must be low, medium or high.');
    }
    patch.priority = raw.priority;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'description')) {
    patch.description = parseDescription(raw.description);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'dueDate')) {
    patch.dueDate = parseCalendarDate(raw.dueDate);
  }
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('At least one of title, team, priority, description or dueDate is required.');
  }
  return patch;
}

function requireObject(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('Body must be a JSON object.');
  }
  return input as Record<string, unknown>;
}

function rejectForbidden(raw: Record<string, unknown>): void {
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN.has(key)) {
      throw new ValidationError(`${key} cannot be set by the client.`);
    }
  }
}

export function parseTaskTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title.length < 3 || title.length > 120) {
    throw new ValidationError('Title must be between 3 and 120 characters.');
  }
  return title;
}

export function parseTaskTeam(value: unknown): string {
  const team = typeof value === 'string' ? value.trim() : '';
  if (team.length < 2 || team.length > 60) {
    throw new ValidationError('Team must be between 2 and 60 characters.');
  }
  return team;
}

function parseDescription(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError('description must be a string or null.');
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  return trimmed.length === 0 ? null : trimmed;
}
