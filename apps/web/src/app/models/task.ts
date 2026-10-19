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
] as const;

export const SORT_ORDERS = ['asc', 'desc'] as const;
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export type TaskSortBy = (typeof SORT_FIELDS)[number];
export type TaskSortOrder = (typeof SORT_ORDERS)[number];

export interface Task {
  id: number;
  title: string;
  team: string;
  status: Status;
  priority: Priority;
  ownerId: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewTask {
  title: string;
  team: string;
  priority: Priority;
}

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
