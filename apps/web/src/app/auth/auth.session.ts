import { HttpRequest } from '@angular/common/http';
import {
  AUTH_LOGIN_URL,
  AUTH_LOGOUT_URL,
  AUTH_REFRESH_URL,
} from './auth.constants';

const SKIP_REFRESH = [AUTH_LOGIN_URL, AUTH_REFRESH_URL, AUTH_LOGOUT_URL];

export function requestUrl(request: Pick<HttpRequest<unknown>, 'url'>): string {
  return request.url;
}

export function isAuthMutation(method: string, url: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  return url.includes(AUTH_LOGIN_URL) || url.includes(AUTH_REFRESH_URL) || url.includes(AUTH_LOGOUT_URL);
}

export function needsCsrfHeader(method: string, url: string): boolean {
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false;
  if (isAuthMutation(verb, url)) return true;
  return url.includes('/api/tasks');
}

export function shouldAttemptRefresh(url: string, retried: boolean): boolean {
  if (retried) return false;
  return !SKIP_REFRESH.some((path) => url.includes(path));
}

/** Only same-origin relative paths. Rejects scheme-relative and external URLs. */
export function safeReturnUrl(value: unknown): string {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  if (trimmed.includes('://') || trimmed.includes('\\')) return '/';
  if (trimmed === '/login' || trimmed.startsWith('/login?') || trimmed.startsWith('/login/')) return '/';
  return trimmed;
}
