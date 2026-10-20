import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AuthService } from './auth/auth.service';
import { searchQuery$ } from './search-query';
import {
  MAX_DESCRIPTION_LENGTH,
  PAGE_SIZES,
  Priority,
  Status,
  Task,
  TaskSortBy,
  TaskSortOrder,
} from './models/task';
import {
  matchingCaption,
  scopeSubtitle,
  showingLabel,
  summaryCaption,
  tableScopeHint,
  tasksHeading,
} from './dashboard.context';
import { AiBacklogComponent } from './ai/ai-backlog.component';
import { TasksService } from './services/tasks.service';
import { UserRole } from './models/user';
import { completionLabel, formatCalendarDate } from './task-dates';
import { TaskDraft, buildCreateBody, buildEditPatch, taskToDraft } from './task-payloads';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, AiBacklogComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  readonly store = inject(TasksService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly search = signal('');
  readonly showForm = signal(false);
  readonly showAi = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly expandedId = signal<number | null>(null);
  readonly formError = signal<string | null>(null);
  readonly pageSizes = PAGE_SIZES;
  readonly maxDescription = MAX_DESCRIPTION_LENGTH;
  readonly formatDue = formatCalendarDate;
  readonly completionLabel = completionLabel;
  private readonly searchInput = new Subject<string>();

  createDraft: TaskDraft = emptyDraft();
  editDraft: TaskDraft = emptyDraft();

  readonly matchingTotal = computed(() => this.store.pagination().total);
  readonly pageItemCount = computed(() => this.store.tasks().length);
  readonly currentPage = computed(() => this.store.pagination().page);
  readonly totalPages = computed(() => this.store.pagination().totalPages);
  readonly canPrev = computed(() => this.currentPage() > 1 && !this.store.loading());
  readonly canNext = computed(() => {
    const pages = this.totalPages();
    return pages > 0 && this.currentPage() < pages && !this.store.loading();
  });
  readonly role = computed<UserRole>(() => this.auth.currentUser()?.role ?? 'MEMBER');
  readonly heading = computed(() => tasksHeading(this.role()));
  readonly subtitle = computed(() => scopeSubtitle(this.role()));
  readonly caption = computed(() => matchingCaption(this.role()));
  readonly statsCaption = computed(() => summaryCaption(this.role()));
  readonly tableHint = computed(() => tableScopeHint(this.role()));
  readonly footerLabel = computed(() => showingLabel(this.role(), this.pageItemCount(), this.matchingTotal()));
  readonly editingTask = computed(() => {
    const id = this.editingId();
    return id === null ? null : this.store.tasks().find((task) => task.id === id) ?? null;
  });

  readonly statuses: { id: Status; label: string }[] = [
    { id: 'todo', label: 'To do' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'done', label: 'Done' },
  ];

  readonly sortFields: { id: TaskSortBy; label: string }[] = [
    { id: 'createdAt', label: 'Created' },
    { id: 'updatedAt', label: 'Updated' },
    { id: 'dueDate', label: 'Due date' },
    { id: 'title', label: 'Title' },
    { id: 'team', label: 'Team' },
    { id: 'priority', label: 'Priority' },
    { id: 'status', label: 'Status' },
    { id: 'id', label: 'ID' },
  ];

  constructor() {
    searchQuery$(this.searchInput).pipe(takeUntilDestroyed()).subscribe((search) => {
      this.store.patchQuery({ search });
    });
    this.store.reload();
    this.store.reloadSummary();
  }

  onSearch(value: string): void {
    this.search.set(value);
    this.searchInput.next(value);
  }

  onStatusFilter(value: string): void {
    const status = this.statuses.some((entry) => entry.id === value) ? value as Status : undefined;
    this.store.patchQuery({ status });
  }

  onPriorityFilter(value: string): void {
    const allowed: Priority[] = ['low', 'medium', 'high'];
    const priority = allowed.includes(value as Priority) ? value as Priority : undefined;
    this.store.patchQuery({ priority });
  }

  onSortBy(value: string): void {
    const match = this.sortFields.find((field) => field.id === value);
    if (match) this.store.patchQuery({ sortBy: match.id });
  }

  onSortOrder(value: string): void {
    if (value === 'asc' || value === 'desc') {
      this.store.patchQuery({ sortOrder: value });
    }
  }

  onPageSize(value: string | number): void {
    const limit = Number(value);
    if (this.pageSizes.includes(limit as typeof PAGE_SIZES[number])) {
      this.store.patchQuery({ limit });
    }
  }

  sortIndicator(field: TaskSortBy): string {
    if (this.store.query().sortBy !== field) return '';
    return this.store.query().sortOrder === 'asc' ? ' ↑' : ' ↓';
  }

  toggleSort(field: TaskSortBy): void {
    const query = this.store.query();
    const sortOrder: TaskSortOrder = query.sortBy === field && query.sortOrder === 'desc' ? 'asc' : 'desc';
    this.store.patchQuery({ sortBy: field, sortOrder });
  }

  changeStatus(task: Task, status: string): void {
    if (status === 'todo' || status === 'in_progress' || status === 'done') {
      this.store.updateStatus(task, status);
    }
  }

  toggleDetails(id: number): void {
    this.expandedId.update((current) => (current === id ? null : id));
  }

  openEdit(task: Task): void {
    this.editingId.set(task.id);
    this.editDraft = taskToDraft(task);
    this.formError.set(null);
    this.showForm.set(false);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editDraft = emptyDraft();
  }

  saveTask(): void {
    if (this.store.saving()) return;
    const result = buildCreateBody(this.createDraft);
    if ('error' in result) {
      this.formError.set(result.error);
      return;
    }
    this.formError.set(null);
    this.store.create(result, () => {
      this.createDraft = emptyDraft();
      this.showForm.set(false);
    });
  }

  saveEdit(): void {
    if (this.store.saving()) return;
    const task = this.editingTask();
    if (!task) {
      this.formError.set('That task is no longer available.');
      return;
    }
    const result = buildEditPatch(task, this.editDraft);
    if ('error' in result) {
      this.formError.set(result.error);
      return;
    }
    if ('empty' in result) {
      this.cancelEdit();
      return;
    }
    this.formError.set(null);
    this.store.update(task.id, result, () => this.cancelEdit());
  }

  logout(): void {
    if (this.auth.loading()) return;
    this.auth.logout().subscribe({
      next: () => void this.router.navigateByUrl('/login'),
    });
  }
}

function emptyDraft(): TaskDraft {
  return { title: '', team: 'Frontend', priority: 'medium', description: '', dueDate: '' };
}
