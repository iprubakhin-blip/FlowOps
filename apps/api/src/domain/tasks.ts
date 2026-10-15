export const STATUSES = ['todo', 'in_progress', 'done'] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;

export type TaskStatus = (typeof STATUSES)[number];
export type TaskPriority = (typeof PRIORITIES)[number];

export interface Task {
  id: number;
  title: string;
  team: string;
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NewTask {
  title: string;
  team: string;
  priority: TaskPriority;
}

export function isStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && STATUSES.some((status) => status === value);
}

export function isPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && PRIORITIES.some((priority) => priority === value);
}

export function parseCreateTask(input: unknown): NewTask {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Body must be a JSON object.');
  }
  const raw = input as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const team = typeof raw.team === 'string' ? raw.team.trim() : '';
  if (title.length < 3 || title.length > 120) {
    throw new Error('Title must be between 3 and 120 characters.');
  }
  if (team.length < 2 || team.length > 60) {
    throw new Error('Team must be between 2 and 60 characters.');
  }
  if (typeof raw.priority !== 'string' || !PRIORITIES.some((p) => p === raw.priority)) {
    throw new Error('Priority must be low, medium or high.');
  }
  return { title, team, priority: raw.priority as TaskPriority };
}
