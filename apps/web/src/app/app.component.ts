import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Priority, Status, Task } from './models/task';
import { TasksService } from './services/tasks.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly store = inject(TasksService);
  readonly search = signal('');
  readonly statusFilter = signal('all');
  readonly priorityFilter = signal('all');
  readonly showForm = signal(false);

  draftTitle = '';
  draftTeam = 'Frontend';
  draftPriority: Priority = 'medium';

  readonly total = computed(() => this.store.tasks().length);
  readonly inProgress = computed(() => this.store.tasks().filter((t) => t.status === 'in_progress').length);
  readonly done = computed(() => this.store.tasks().filter((t) => t.status === 'done').length);
  readonly highPriority = computed(() => this.store.tasks().filter((t) => t.priority === 'high' && t.status !== 'done').length);
  readonly completionRate = computed(() => this.total() === 0 ? 0 : Math.round(this.done() / this.total() * 100));
  readonly filteredTasks = computed(() => {
    const query = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    const priority = this.priorityFilter();
    return this.store.tasks().filter((task) =>
      (!query || `${task.title} ${task.team}`.toLowerCase().includes(query)) &&
      (status === 'all' || task.status === status) &&
      (priority === 'all' || task.priority === priority));
  });

  readonly statuses: { id: Status; label: string }[] = [
    { id: 'todo', label: 'To do' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'done', label: 'Done' },
  ];

  constructor() { this.store.load(); }

  statusLabel(status: Status): string {
    return this.statuses.find((entry) => entry.id === status)?.label ?? status;
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
}
