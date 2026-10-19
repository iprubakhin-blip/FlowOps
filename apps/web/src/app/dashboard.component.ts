import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AuthService } from './auth/auth.service';
import { searchQuery$ } from './search-query';
import {
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
  tableScopeHint,
  tasksHeading,
} from './dashboard.context';
import { TasksService } from './services/tasks.service';
import { UserRole } from './models/user';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  readonly store = inject(TasksService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly search = signal('');
  readonly showForm = signal(false);
  readonly pageSizes = PAGE_SIZES;
  private readonly searchInput = new Subject<string>();

  draftTitle = '';
  draftTeam = 'Frontend';
  draftPriority: Priority = 'medium';

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
  readonly tableHint = computed(() => tableScopeHint(this.role()));
  readonly footerLabel = computed(() => showingLabel(this.role(), this.pageItemCount(), this.matchingTotal()));

  readonly statuses: { id: Status; label: string }[] = [
    { id: 'todo', label: 'To do' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'done', label: 'Done' },
  ];

  readonly sortFields: { id: TaskSortBy; label: string }[] = [
    { id: 'createdAt', label: 'Created' },
    { id: 'updatedAt', label: 'Updated' },
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

  saveTask(): void {
    const title = this.draftTitle.trim();
    const team = this.draftTeam.trim();
    if (title.length < 3 || team.length < 2) return;
    this.store.create({ title, team, priority: this.draftPriority }, () => {
      this.draftTitle = '';
      this.showForm.set(false);
    });
  }

  logout(): void {
    if (this.auth.loading()) return;
    this.auth.logout().subscribe({
      next: () => void this.router.navigateByUrl('/login'),
    });
  }
}
