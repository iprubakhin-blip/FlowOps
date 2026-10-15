import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { NewTask, Status, Task } from '../models/task';

@Injectable({ providedIn: 'root' })
export class TasksService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = '/api/tasks';

  readonly tasks = signal<Task[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<Task[]>(this.endpoint)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (tasks) => this.tasks.set(tasks),
        error: () => this.error.set('Could not load tasks. Check that the API and database are running.'),
      });
  }

  create(payload: NewTask, onSuccess: () => void): void {
    this.saving.set(true);
    this.error.set(null);
    this.http.post<Task>(this.endpoint, payload)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (task) => {
          this.tasks.update((tasks) => [task, ...tasks]);
          onSuccess();
        },
        error: () => this.error.set('Could not create this task. Please try again.'),
      });
  }

  updateStatus(task: Task, status: Status): void {
    if (task.status === status) return;
    this.error.set(null);
    this.http.patch<Task>(`${this.endpoint}/${task.id}/status`, { status })
      .subscribe({
        next: (updated) => this.tasks.update((tasks) =>
          tasks.map((item) => item.id === updated.id ? updated : item)),
        error: () => this.error.set('Could not update status. Please try again.'),
      });
  }
}
