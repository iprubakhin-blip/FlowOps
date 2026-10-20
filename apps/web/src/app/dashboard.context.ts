import { UserRole } from './models/user';

export function tasksHeading(role: UserRole): string {
  return role === 'ADMIN' ? 'All tasks' : 'My tasks';
}

export function matchingCaption(role: UserRole): string {
  return role === 'ADMIN'
    ? 'Matching the current search and filters'
    : 'Your tasks matching current filters';
}

export function summaryCaption(role: UserRole): string {
  return role === 'ADMIN'
    ? 'All tasks you are authorized to see'
    : 'Your tasks only — not other users';
}

export function scopeSubtitle(role: UserRole): string {
  return role === 'ADMIN'
    ? "Stay on top of every team's work, priorities and progress."
    : 'Stay on top of your work, priorities and progress.';
}

export function tableScopeHint(role: UserRole): string {
  return role === 'ADMIN'
    ? 'Server-side search, filters, sort and pagination across all tasks'
    : 'Server-side search, filters, sort and pagination for your tasks';
}

export function showingLabel(role: UserRole, pageCount: number, total: number): string {
  return role === 'ADMIN'
    ? `Showing ${pageCount} of ${total} matching tasks`
    : `Showing ${pageCount} of ${total} of your matching tasks`;
}
