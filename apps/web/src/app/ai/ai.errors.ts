import { HttpErrorResponse } from '@angular/common/http';

function publicCode(error: unknown): string | undefined {
  if (!(error instanceof HttpErrorResponse)) return undefined;
  const payload = error.error as { error?: unknown } | null;
  return typeof payload?.error === 'string' ? payload.error : undefined;
}

function publicMessage(error: unknown): string | undefined {
  if (!(error instanceof HttpErrorResponse)) return undefined;
  const payload = error.error as { message?: unknown } | null;
  const message = payload?.message;
  if (typeof message === 'string' && message.length > 0 && message.length <= 240 && !message.includes('\n')) {
    return message;
  }
  return undefined;
}

export function aiGenerateErrorMessage(error: unknown): string {
  const code = publicCode(error);
  const status = error instanceof HttpErrorResponse ? error.status : undefined;
  if (code === 'AI_DISABLED' || status === 503 && code === 'AI_DISABLED') return 'AI generation is disabled on this server.';
  if (code === 'CONSENT_REQUIRED') return 'External AI processing requires an explicit consent check.';
  if (code === 'QUOTA_EXCEEDED') return 'Daily AI request quota reached. Try again after UTC midnight.';
  if (code === 'TIMEOUT') return 'The AI request timed out. Drafts were not saved.';
  if (code === 'RATE_LIMITED') return 'The AI provider rate limit was reached. This is not necessarily the daily quota.';
  if (code === 'REFUSAL') return 'The AI provider refused to generate drafts.';
  if (code === 'INVALID_PROVIDER_RESPONSE' || code === 'VALIDATION_FAILED' || code === 'INCOMPLETE') {
    return 'The AI response could not be used. No tasks were created.';
  }
  if (code === 'PROVIDER_UNAVAILABLE' || code === 'CREDENTIALS' || status === 503) {
    return 'The AI provider is unavailable.';
  }
  if (status === 401) return 'Your session expired. Please sign in again.';
  if (status === 403) return 'This request was blocked. Refresh the page and try again.';
  if (status === 400) return publicMessage(error) ?? 'Check the requirements and team, then try again.';
  if (status === 429) return publicMessage(error) ?? 'Too many AI requests. Wait before trying again.';
  if (status === 0) return 'Could not reach the API. Generation was not confirmed.';
  return 'Could not generate drafts. Please try again.';
}

export function bulkCreateErrorMessage(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : undefined;
  if (status === 401) return 'Your session expired. Please sign in again.';
  if (status === 403) return 'This request was blocked. Refresh the page and try again.';
  if (status === 400) return publicMessage(error) ?? 'Check the draft fields and try again.';
  if (status === 0) {
    return 'The connection dropped while creating tasks. Some or all may have been saved. Check the task list before retrying.';
  }
  return 'Could not create the tasks. Your drafts are still here to correct.';
}
