import { HttpBackend, HttpClient } from '@angular/common/http';
import { Observable, defer, finalize, firstValueFrom, from, shareReplay } from 'rxjs';
import { AUTH_REFRESH_URL, CSRF_HEADER, CSRF_HEADER_VALUE } from './auth.constants';

export const REFRESH_LOCK_NAME = 'flowops-auth-refresh';

let inFlight: Observable<unknown> | null = null;

export function resetRefreshInFlight(): void {
  inFlight = null;
}

export function sharedRefresh(backend: HttpBackend): Observable<unknown> {
  if (!inFlight) {
    inFlight = defer(() => from(withRefreshLock(() => postRefresh(backend)))).pipe(
      finalize(() => {
        inFlight = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }
  return inFlight;
}

export function hasRefreshInFlight(): boolean {
  return inFlight !== null;
}

export async function withRefreshLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = navigatorLocks();
  if (!locks) return work();
  return locks.request(REFRESH_LOCK_NAME, () => work()) as Promise<T>;
}

function postRefresh(backend: HttpBackend): Promise<unknown> {
  const http = new HttpClient(backend);
  return firstValueFrom(http.post(AUTH_REFRESH_URL, {}, {
    withCredentials: true,
    headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
  }));
}

function navigatorLocks(): { request: (name: string, callback: () => Promise<unknown>) => Promise<unknown> } | undefined {
  const locks = (globalThis as { navigator?: { locks?: { request?: unknown } } }).navigator?.locks;
  if (!locks || typeof locks.request !== 'function') return undefined;
  return locks as { request: (name: string, callback: () => Promise<unknown>) => Promise<unknown> };
}
