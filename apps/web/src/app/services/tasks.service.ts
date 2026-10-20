import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, Subject, catchError, finalize, switchMap, take } from 'rxjs';
import { bulkCreateErrorMessage } from '../ai/ai.errors';
import { taskLoadErrorMessage, taskWriteErrorMessage } from '../auth/auth.errors';
import {
  DEFAULT_TASK_QUERY,
  EMPTY_TASK_SUMMARY,
  EditTask,
  NewTask,
  PaginatedTasks,
  PaginationMeta,
  Status,
  Task,
  TaskListQuery,
  TaskSummary,
} from '../models/task';
import type { BulkCreateRequest, BulkCreateResponse } from '../ai/ai.models';

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
  readonly summary = signal<TaskSummary>({ ...EMPTY_TASK_SUMMARY });
  readonly loading = signal(false);
  readonly summaryLoading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly summaryError = signal<string | null>(null);

  constructor() {
    this.requests.pipe(
      switchMap((query) => {
        this.loading.set(true);
        this.error.set(null);
        return this.http.get<PaginatedTasks>(this.endpoint, { params: toParams(query) }).pipe(
          finalize(() => this.loading.set(false)),
          catchError((error: unknown) => {
            this.error.set(taskLoadErrorMessage(error));
            return EMPTY;
          }),
        );
      }),
    ).subscribe((result) => {
      this.tasks.set(result.items);
      this.pagination.set(result.pagination);
    });
  }

  reload(): void {
    this.requests.next(this.query());
  }

  reloadSummary(): void {
    this.summaryLoading.set(true);
    this.summaryError.set(null);
    this.http.get<TaskSummary>(`${this.endpoint}/summary`)
      .pipe(take(1), finalize(() => this.summaryLoading.set(false)))
      .subscribe({
        next: (summary) => this.summary.set(summary),
        error: (error: unknown) => this.summaryError.set(taskLoadErrorMessage(error)),
      });
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
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.http.post<Task>(this.endpoint, payload)
      .pipe(take(1), finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.query.set({ ...this.query(), page: 1 });
          this.reload();
          this.reloadSummary();
          onSuccess();
        },
        error: (error: unknown) => this.error.set(taskWriteErrorMessage(error)),
      });
  }

  createBulk(
    payload: BulkCreateRequest,
    onSuccess: (createdCount: number) => void,
    onError?: (error: unknown) => void,
  ): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.http.post<BulkCreateResponse>(`${this.endpoint}/bulk`, payload)
      .pipe(take(1), finalize(() => this.saving.set(false)))
      .subscribe({
        next: (result) => {
          this.query.set({ ...this.query(), page: 1 });
          this.reload();
          this.reloadSummary();
          onSuccess(result.createdCount);
        },
        error: (error: unknown) => {
          this.error.set(bulkCreateErrorMessage(error));
          onError?.(error);
        },
      });
  }

  update(id: number, payload: EditTask, onSuccess: () => void): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.http.patch<Task>(`${this.endpoint}/${id}`, payload)
      .pipe(take(1), finalize(() => this.saving.set(false)))
      .subscribe({
        next: (task) => {
          this.tasks.update((rows) => rows.map((row) => (row.id === task.id ? task : row)));
          this.reload();
          this.reloadSummary();
          onSuccess();
        },
        error: (error: unknown) => this.error.set(taskWriteErrorMessage(error)),
      });
  }

  updateStatus(task: Task, status: Status): void {
    if (task.status === status || this.saving()) return;
    this.error.set(null);
    this.http.patch<Task>(`${this.endpoint}/${task.id}/status`, { status })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.reload();
          this.reloadSummary();
        },
        error: (error: unknown) => this.error.set(taskWriteErrorMessage(error)),
      });
  }
}
