import { HttpErrorResponse } from '@angular/common/http';

export function loginErrorMessage(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : undefined;
  if (status === 401) return 'Invalid email or password.';
  if (status === 429) return 'Too many login attempts. Try again in a minute.';
  if (status === 503) return 'Authentication is not available right now.';
  if (status === 400) return 'Check your email and password.';
  if (status === 0) return 'Could not reach the API.';
  return 'Could not sign in. Please try again.';
}

export function logoutErrorMessage(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : undefined;
  if (status === 403) return 'Logout was blocked. Refresh the page and try again.';
  if (status === 0) return 'Could not reach the API. You may still be signed in on the server.';
  return 'Could not sign out. Please try again.';
}

export function isHttpStatus(error: unknown, status: number): boolean {
  return error instanceof HttpErrorResponse && error.status === status;
}

export function taskLoadErrorMessage(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : undefined;
  if (status === 401) return 'Your session expired. Please sign in again.';
  if (status === 403) return 'This request was blocked. Refresh the page and try again.';
  if (status === 0) return 'Could not reach the API. Check that the API and database are running.';
  return 'Could not load tasks. Check that the API and database are running.';
}

function publicApiMessage(error: unknown): string | undefined {
  if (!(error instanceof HttpErrorResponse)) return undefined;
  const payload = error.error as { message?: unknown } | null;
  const message = payload?.message;
  if (typeof message === 'string' && message.length > 0 && message.length <= 240 && !message.includes('\n')) {
    return message;
  }
  return undefined;
}

export function taskWriteErrorMessage(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : undefined;
  if (status === 401) return 'Your session expired. Please sign in again.';
  if (status === 403) return 'This request was blocked. Refresh the page and try again.';
  if (status === 404) return 'That task is no longer available.';
  if (status === 400) return publicApiMessage(error) ?? 'Check the task details and try again.';
  if (status === 0) return 'Could not reach the API.';
  return 'Could not save this change. Please try again.';
}
