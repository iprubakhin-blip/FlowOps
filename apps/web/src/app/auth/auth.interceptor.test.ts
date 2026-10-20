import '@angular/compiler';
import {
  HttpBackend,
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Observable, ReplaySubject, firstValueFrom, of, throwError } from 'rxjs';
import { AUTH_RETRIED, authInterceptor } from './auth.interceptor';
import { resetRefreshInFlight } from './auth.refresh';
import { AuthService } from './auth.service';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from './auth.constants';

const user = { id: 1, email: 'admin@example.com', role: 'ADMIN' as const };

function runInterceptor(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
  backend: HttpBackend,
  auth?: Pick<AuthService, 'initialized' | 'clearSession'>,
): Observable<HttpEvent<unknown>> {
  const injector = Injector.create({
    providers: [
      { provide: HttpBackend, useValue: backend },
      ...(auth ? [{ provide: AuthService, useValue: auth }] : []),
    ],
  });
  return runInInjectionContext(injector, () => authInterceptor(request, next));
}

function sessionSpy(): { auth: Pick<AuthService, 'initialized' | 'clearSession'>; cleared: () => number } {
  let cleared = 0;
  return {
    cleared: () => cleared,
    auth: {
      initialized: () => true,
      clearSession: () => { cleared += 1; },
    },
  };
}

function backendHandle(handler: (req: HttpRequest<unknown>) => Observable<HttpEvent<unknown>>): HttpBackend {
  return { handle: handler } as HttpBackend;
}

test('adds credentials and the CSRF header on auth mutations', () => {
  const seen: HttpRequest<unknown>[] = [];
  const next: HttpHandlerFn = (req) => {
    seen.push(req);
    return of(new HttpResponse({ status: 200, body: { user } }));
  };
  runInterceptor(new HttpRequest('POST', '/api/auth/login', { email: 'a@b.co' }), next, backendHandle(() => of(new HttpResponse({ status: 200 })))).subscribe();
  assert.equal(seen[0].withCredentials, true);
  assert.equal(seen[0].headers.get(CSRF_HEADER), CSRF_HEADER_VALUE);
});

test('adds the CSRF header to task writes and keeps credentials', () => {
  const seen: HttpRequest<unknown>[] = [];
  const next: HttpHandlerFn = (req) => {
    seen.push(req);
    return of(new HttpResponse({ status: 201, body: {} }));
  };
  runInterceptor(new HttpRequest('POST', '/api/tasks', { title: 'Owned by server' }), next, backendHandle(() => of(new HttpResponse({ status: 200 })))).subscribe();
  runInterceptor(new HttpRequest('PATCH', '/api/tasks/12/status', { status: 'done' }), next, backendHandle(() => of(new HttpResponse({ status: 200 })))).subscribe();
  runInterceptor(new HttpRequest('PATCH', '/api/tasks/12', { title: 'Edited' }), next, backendHandle(() => of(new HttpResponse({ status: 200 })))).subscribe();
  runInterceptor(new HttpRequest('POST', '/api/tasks/bulk', { team: 'QA', tasks: [] }), next, backendHandle(() => of(new HttpResponse({ status: 200 })))).subscribe();
  runInterceptor(new HttpRequest('POST', '/api/ai/task-drafts', { requirements: 'Build a portal with login.', team: 'QA' }), next, backendHandle(() => of(new HttpResponse({ status: 200 })))).subscribe();
  assert.equal(seen[0].withCredentials, true);
  assert.equal(seen[0].headers.get(CSRF_HEADER), CSRF_HEADER_VALUE);
  assert.equal(seen[1].headers.get(CSRF_HEADER), CSRF_HEADER_VALUE);
  assert.equal(seen[2].headers.get(CSRF_HEADER), CSRF_HEADER_VALUE);
  assert.equal(seen[3].headers.get(CSRF_HEADER), CSRF_HEADER_VALUE);
  assert.equal(seen[4].headers.get(CSRF_HEADER), CSRF_HEADER_VALUE);
});

test('does not add the CSRF header to GET /api/tasks or AI capabilities', () => {
  const seen: HttpRequest<unknown>[] = [];
  const next: HttpHandlerFn = (req) => {
    seen.push(req);
    return of(new HttpResponse({ status: 200, body: { items: [], pagination: {} } }));
  };
  runInterceptor(new HttpRequest('GET', '/api/tasks'), next, backendHandle(() => of(new HttpResponse({ status: 200 })))).subscribe();
  runInterceptor(new HttpRequest('GET', '/api/ai/capabilities'), next, backendHandle(() => of(new HttpResponse({ status: 200 })))).subscribe();
  assert.equal(seen[0].withCredentials, true);
  assert.equal(seen[0].headers.has(CSRF_HEADER), false);
  assert.equal(seen[1].headers.has(CSRF_HEADER), false);
});

test('expired access on /me refreshes once then retries', async () => {
  resetRefreshInFlight();
  let meCalls = 0;
  let refreshCalls = 0;
  const next: HttpHandlerFn = (req) => {
    if (req.url.includes('/api/auth/me')) {
      meCalls += 1;
      if (meCalls === 1) {
        return throwError(() => new HttpErrorResponse({ status: 401, url: req.url }));
      }
      assert.equal(req.context.get(AUTH_RETRIED), true);
      return of(new HttpResponse({ status: 200, body: { user } }));
    }
    return of(new HttpResponse({ status: 200 }));
  };
  const backend = backendHandle((req) => {
    assert.equal(req.url.includes('/api/auth/refresh'), true);
    assert.equal(req.headers.get(CSRF_HEADER), CSRF_HEADER_VALUE);
    refreshCalls += 1;
    return of(new HttpResponse({ status: 200, body: { user } }));
  });
  const event = await firstValueFrom(runInterceptor(new HttpRequest('GET', '/api/auth/me'), next, backend));
  assert.ok(event instanceof HttpResponse);
  assert.deepEqual((event as HttpResponse<{ user: typeof user }>).body, { user });
  assert.equal(meCalls, 2);
  assert.equal(refreshCalls, 1);
});

test('refresh failure leaves the caller unauthenticated', async () => {
  resetRefreshInFlight();
  const next: HttpHandlerFn = (req) => throwError(() => new HttpErrorResponse({ status: 401, url: req.url }));
  const backend = backendHandle(() => throwError(() => new HttpErrorResponse({ status: 401, url: '/api/auth/refresh' })));
  await assert.rejects(
    () => firstValueFrom(runInterceptor(new HttpRequest('GET', '/api/auth/me'), next, backend)),
    (error: unknown) => error instanceof HttpErrorResponse && error.status === 401,
  );
});

test('concurrent 401s share one refresh and retry original requests once', async () => {
  resetRefreshInFlight();
  let refreshCalls = 0;
  const refresh$ = new ReplaySubject<HttpResponse<unknown>>(1);
  const retried: string[] = [];
  const next: HttpHandlerFn = (req) => {
    if (req.context.get(AUTH_RETRIED)) {
      retried.push(req.url);
      return of(new HttpResponse({ status: 200, body: { ok: true } }));
    }
    return throwError(() => new HttpErrorResponse({ status: 401, url: req.url }));
  };
  const backend = backendHandle(() => {
    refreshCalls += 1;
    return refresh$.asObservable();
  });
  const first = firstValueFrom(runInterceptor(new HttpRequest('GET', '/api/tasks?page=1'), next, backend));
  const second = firstValueFrom(runInterceptor(new HttpRequest('GET', '/api/tasks?page=2'), next, backend));
  refresh$.next(new HttpResponse({ status: 200, body: { user } }));
  refresh$.complete();
  await Promise.all([first, second]);
  assert.equal(refreshCalls, 1);
  assert.equal(retried.length, 2);
});

test('retries a 401 at most once', async () => {
  resetRefreshInFlight();
  let nextCalls = 0;
  let refreshCalls = 0;
  const next: HttpHandlerFn = (req) => {
    nextCalls += 1;
    return throwError(() => new HttpErrorResponse({ status: 401, url: req.url }));
  };
  const backend = backendHandle(() => {
    refreshCalls += 1;
    return of(new HttpResponse({ status: 200, body: { user } }));
  });
  await assert.rejects(
    () => firstValueFrom(runInterceptor(new HttpRequest('GET', '/api/tasks'), next, backend)),
    (error: unknown) => error instanceof HttpErrorResponse && error.status === 401,
  );
  assert.equal(nextCalls, 2);
  assert.equal(refreshCalls, 1);
});

test('403 does not trigger a refresh', () => {
  resetRefreshInFlight();
  let refreshCalls = 0;
  const backend = backendHandle(() => {
    refreshCalls += 1;
    return of(new HttpResponse({ status: 200 }));
  });
  let status = 0;
  runInterceptor(
    new HttpRequest('POST', '/api/tasks', { title: 'Blocked' }),
    () => throwError(() => new HttpErrorResponse({ status: 403, url: '/api/tasks' })),
    backend,
  ).subscribe({
    error: (error: HttpErrorResponse) => {
      status = error.status;
    },
  });
  assert.equal(status, 403);
  assert.equal(refreshCalls, 0);
});

test('does not refresh after a failed login or failed refresh', () => {
  resetRefreshInFlight();
  let refreshCalls = 0;
  const backend = backendHandle(() => {
    refreshCalls += 1;
    return of(new HttpResponse({ status: 200 }));
  });
  const fail: HttpHandlerFn = (req) => throwError(() => new HttpErrorResponse({ status: 401, url: req.url }));
  runInterceptor(new HttpRequest('POST', '/api/auth/login', {}), fail, backend).subscribe({ error: () => undefined });
  runInterceptor(new HttpRequest('POST', '/api/auth/refresh', {}), fail, backend).subscribe({ error: () => undefined });
  assert.equal(refreshCalls, 0);
});

test('refresh 401 expires the session', async () => {
  resetRefreshInFlight();
  const session = sessionSpy();
  const backend = backendHandle(() => throwError(() => new HttpErrorResponse({ status: 401, url: '/api/auth/refresh' })));
  await assert.rejects(
    () => firstValueFrom(runInterceptor(
      new HttpRequest('GET', '/api/tasks'),
      () => throwError(() => new HttpErrorResponse({ status: 401, url: '/api/tasks' })),
      backend,
      session.auth,
    )),
    (error: unknown) => error instanceof HttpErrorResponse && error.status === 401,
  );
  assert.equal(session.cleared(), 1);
});

test('refresh 429 and 5xx keep the session and propagate the refresh error', async () => {
  resetRefreshInFlight();
  const session = sessionSpy();
  await assert.rejects(
    () => firstValueFrom(runInterceptor(
      new HttpRequest('GET', '/api/tasks'),
      () => throwError(() => new HttpErrorResponse({ status: 401, url: '/api/tasks' })),
      backendHandle(() => throwError(() => new HttpErrorResponse({ status: 429, url: '/api/auth/refresh' }))),
      session.auth,
    )),
    (error: unknown) => error instanceof HttpErrorResponse && error.status === 429,
  );
  assert.equal(session.cleared(), 0);

  resetRefreshInFlight();
  await assert.rejects(
    () => firstValueFrom(runInterceptor(
      new HttpRequest('GET', '/api/tasks'),
      () => throwError(() => new HttpErrorResponse({ status: 401, url: '/api/tasks' })),
      backendHandle(() => throwError(() => new HttpErrorResponse({ status: 503, url: '/api/auth/refresh' }))),
      session.auth,
    )),
    (error: unknown) => error instanceof HttpErrorResponse && error.status === 503,
  );
  assert.equal(session.cleared(), 0);
});

test('refresh network failure keeps the session', async () => {
  resetRefreshInFlight();
  const session = sessionSpy();
  await assert.rejects(
    () => firstValueFrom(runInterceptor(
      new HttpRequest('GET', '/api/tasks'),
      () => throwError(() => new HttpErrorResponse({ status: 401, url: '/api/tasks' })),
      backendHandle(() => throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Unknown Error', url: '/api/auth/refresh' }))),
      session.auth,
    )),
    (error: unknown) => error instanceof HttpErrorResponse && error.status === 0,
  );
  assert.equal(session.cleared(), 0);
});

test('retried API 403, 404 and 500 do not expire the session', async () => {
  for (const status of [403, 404, 500]) {
    resetRefreshInFlight();
    const session = sessionSpy();
    const next: HttpHandlerFn = (req) => {
      if (req.context.get(AUTH_RETRIED)) {
        return throwError(() => new HttpErrorResponse({ status, url: req.url }));
      }
      return throwError(() => new HttpErrorResponse({ status: 401, url: req.url }));
    };
    await assert.rejects(
      () => firstValueFrom(runInterceptor(
        new HttpRequest('GET', '/api/tasks'),
        next,
        backendHandle(() => of(new HttpResponse({ status: 200, body: { user } }))),
        session.auth,
      )),
      (error: unknown) => error instanceof HttpErrorResponse && error.status === status,
    );
    assert.equal(session.cleared(), 0, `status ${status} must not clear the session`);
  }
});

