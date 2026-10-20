export type Status = 'todo' | 'in_progress' | 'done';
export type Priority = 'low' | 'medium' | 'high';

export const SORT_FIELDS = [
  'id',
  'title',
  'team',
  'priority',
  'status',
  'createdAt',
  'updatedAt',
  'dueDate',
] as const;

export const SORT_ORDERS = ['asc', 'desc'] as const;
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_TITLE_LENGTH = 120;
export const MIN_TITLE_LENGTH = 3;
export const MAX_TEAM_LENGTH = 60;
export const MIN_TEAM_LENGTH = 2;

export type TaskSortBy = (typeof SORT_FIELDS)[number];
export type TaskSortOrder = (typeof SORT_ORDERS)[number];

export interface Task {
  id: number;
  title: string;
  team: string;
  status: Status;
  priority: Priority;
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
  priority: Priority;
  description?: string;
  dueDate?: string;
}

export interface EditTask {
  title?: string;
  team?: string;
  priority?: Priority;
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

export const EMPTY_TASK_SUMMARY: TaskSummary = {
  total: 0,
  todo: 0,
  inProgress: 0,
  done: 0,
  overdue: 0,
  highPriorityOpen: 0,
};

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedTasks {
  items: Task[];
  pagination: PaginationMeta;
}

export interface TaskListQuery {
  page: number;
  limit: number;
  status?: Status;
  priority?: Priority;
  search?: string;
  sortBy: TaskSortBy;
  sortOrder: TaskSortOrder;
}

export const DEFAULT_TASK_QUERY: TaskListQuery = {
  page: 1,
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
};
