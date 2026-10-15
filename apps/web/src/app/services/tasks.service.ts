import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, Subject, catchError, finalize, switchMap, take } from 'rxjs';
import {
  DEFAULT_TASK_QUERY,
  NewTask,
  PaginatedTasks,
  PaginationMeta,
  Status,
  Task,
  TaskListQuery,
} from '../models/task';

const RESET_PAGE_KEYS = ['limit', 'status', 'priority', 'search', 'sortBy', 'sortOrder'] as const;

export function toParams(query: TaskListQuery): HttpParams {
  let params = new HttpParams()
    .set('page', String(query.page))
    .set('limit', String(query.limit))
    .set('sortBy', query.sortBy)
    .set('sortOrder', query.sortOrder);
  if (query.status) params = params.set('status', query.status);
  if (query.priority) params = params.set('priority', query.priority);
  if (query.search) params = params.set('search', query.search);
  return params;
}

export function applyQueryPatch(current: TaskListQuery, patch: Partial<TaskListQuery>): TaskListQuery {
  const resetPage = RESET_PAGE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
  return {
    ...current,
    ...patch,
    page: resetPage ? 1 : (patch.page ?? current.page),
  };
}

export function canNavigateToPage(page: number, currentPage: number, totalPages: number): boolean {
  if (page < 1 || page === currentPage) return false;
  if (totalPages > 0 && page > totalPages) return false;
  return true;
}

@Injectable({ providedIn: 'root' })
export class TasksService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = '/api/tasks';
  private readonly requests = new Subject<TaskListQuery>();

  readonly query = signal<TaskListQuery>({ ...DEFAULT_TASK_QUERY });
  readonly tasks = signal<Task[]>([]);
  readonly pagination = signal<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.requests.pipe(
      switchMap((query) => {
        this.loading.set(true);
        this.error.set(null);
        return this.http.get<PaginatedTasks>(this.endpoint, { params: toParams(query) }).pipe(
          finalize(() => this.loading.set(false)),
          catchError(() => {
            this.error.set('Could not load tasks. Check that the API and database are running.');
            return EMPTY;
          }),
        );
      }),
    ).subscribe((result) => {
      this.tasks.set(result.items);
      this.pagination.set(result.pagination);
    });
    this.reload();
  }

  reload(): void {
    this.requests.next(this.query());
  }

  patchQuery(patch: Partial<TaskListQuery>): void {
    const next = applyQueryPatch(this.query(), patch);
    this.query.set(next);
    this.requests.next(next);
  }

  setPage(page: number): void {
    if (!canNavigateToPage(page, this.query().page, this.pagination().totalPages)) return;
    this.patchQuery({ page });
  }

  create(payload: NewTask, onSuccess: () => void): void {
    this.saving.set(true);
    this.error.set(null);
    this.http.post<Task>(this.endpoint, payload)
      .pipe(take(1), finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.query.set({ ...this.query(), page: 1 });
          this.reload();
          onSuccess();
        },
        error: () => this.error.set('Could not create this task. Please try again.'),
      });
  }

  updateStatus(task: Task, status: Status): void {
    if (task.status === status) return;
    this.error.set(null);
    this.http.patch<Task>(`${this.endpoint}/${task.id}/status`, { status })
      .pipe(take(1))
      .subscribe({
        next: () => this.reload(),
        error: () => this.error.set('Could not update status. Please try again.'),
      });
  }
}
