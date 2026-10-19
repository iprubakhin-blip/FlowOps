import { ValidationError } from '../http/validation-error';
import {
  isPriority,
  isStatus,
  Task,
  TaskPriority,
  TaskStatus,
} from './tasks';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const MAX_SEARCH_LENGTH = 120;

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

export type TaskSortBy = (typeof SORT_FIELDS)[number];
export type TaskSortOrder = (typeof SORT_ORDERS)[number];

export interface TaskListQuery {
  page: number;
  limit: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  search?: string;
  sortBy: TaskSortBy;
  sortOrder: TaskSortOrder;
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

const SORT_COLUMNS: Record<TaskSortBy, string> = {
  id: 'id',
  title: 'title',
  team: 'team',
  priority: 'priority',
  status: 'status',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

export function paginationMeta(total: number, page: number, limit: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

function isSortBy(value: unknown): value is TaskSortBy {
  return typeof value === 'string' && SORT_FIELDS.some((field) => field === value);
}

function isSortOrder(value: unknown): value is TaskSortOrder {
  return typeof value === 'string' && SORT_ORDERS.some((order) => order === value);
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ValidationError(`${name} must be a string.`);
  }
  return value;
}

function parsePositiveInt(value: unknown, name: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ValidationError(`${name} must be a positive integer.`);
  }
  const raw = String(value);
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new ValidationError(`${name} must be a positive integer.`);
  }
  return Number(raw);
}

export function parseListQuery(input: unknown): TaskListQuery {
  if (input === undefined || input === null) {
    return {
      page: DEFAULT_PAGE,
      limit: DEFAULT_LIMIT,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Query must be an object.');
  }
  const raw = input as Record<string, unknown>;
  for (const value of Object.values(raw)) {
    if (Array.isArray(value)) {
      throw new ValidationError('Repeated query parameters are not allowed.');
    }
  }

  const page = parsePositiveInt(raw.page, 'page', DEFAULT_PAGE);
  const limit = parsePositiveInt(raw.limit, 'limit', DEFAULT_LIMIT);
  if (limit > MAX_LIMIT) {
    throw new ValidationError(`limit must be at most ${MAX_LIMIT}.`);
  }

  const statusRaw = optionalString(raw.status, 'status');
  if (statusRaw !== undefined && !isStatus(statusRaw)) {
    throw new ValidationError('status must be todo, in_progress or done.');
  }

  const priorityRaw = optionalString(raw.priority, 'priority');
  if (priorityRaw !== undefined && !isPriority(priorityRaw)) {
    throw new ValidationError('priority must be low, medium or high.');
  }

  const searchRaw = optionalString(raw.search, 'search');
  const search = searchRaw?.trim();
  if (search !== undefined && search.length > MAX_SEARCH_LENGTH) {
    throw new ValidationError(`search must be at most ${MAX_SEARCH_LENGTH} characters.`);
  }

  const sortByRaw = optionalString(raw.sortBy, 'sortBy');
  if (sortByRaw !== undefined && !isSortBy(sortByRaw)) {
    throw new ValidationError(`sortBy must be one of: ${SORT_FIELDS.join(', ')}.`);
  }

  const sortOrderRaw = optionalString(raw.sortOrder, 'sortOrder');
  if (sortOrderRaw !== undefined && !isSortOrder(sortOrderRaw)) {
    throw new ValidationError('sortOrder must be asc or desc.');
  }

  return {
    page,
    limit,
    status: statusRaw,
    priority: priorityRaw,
    search: search || undefined,
    sortBy: sortByRaw ?? 'createdAt',
    sortOrder: sortOrderRaw ?? 'desc',
  };
}

function escapeIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export interface TaskListSql {
  whereSql: string;
  params: unknown[];
  orderSql: string;
  limit: number;
  offset: number;
}

export function buildTaskListSql(query: TaskListQuery, ownerId?: number): TaskListSql {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (ownerId !== undefined) {
    params.push(ownerId);
    conditions.push(`owner_id = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  if (query.priority) {
    params.push(query.priority);
    conditions.push(`priority = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${escapeIlike(query.search)}%`);
    conditions.push(
      `(title ILIKE $${params.length} ESCAPE '\\' OR team ILIKE $${params.length} ESCAPE '\\')`,
    );
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const direction = query.sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const column = SORT_COLUMNS[query.sortBy];
  const orderSql = `${column} ${direction}, id ${direction}`;

  return {
    whereSql,
    params,
    orderSql,
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  };
}
