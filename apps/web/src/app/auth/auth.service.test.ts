import '@angular/compiler';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import assert from 'node:assert/strict';
import test from 'node:test';
import { firstValueFrom, of, throwError } from 'rxjs';
import { PublicUser } from '../models/user';
import { AUTH_LOGIN_URL, AUTH_LOGOUT_URL, AUTH_ME_URL, CSRF_HEADER, CSRF_HEADER_VALUE } from './auth.constants';
import { AuthService } from './auth.service';

const user: PublicUser = { id: 1, email: 'admin@example.com', role: 'ADMIN' };

function createService(http: object): AuthService {
  const injector = Injector.create({
    providers: [{ provide: HttpClient, useValue: http }],
  });
  return runInInjectionContext(injector, () => new AuthService());
}

test('successful login stores the public user and does not write web storage', async () => {
  const writes: string[] = [];
  const fakeStorage = {
    getItem: () => null,
    setItem: (key: string) => writes.push(key),
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: fakeStorage });
  const store = createService({
    post: (url: string, body: unknown) => {
      assert.equal(url, AUTH_LOGIN_URL);
      assert.deepEqual(body, { email: 'admin@example.com', password: 'test-password-ok' });
      return of({ user });
    },
  });
  const result = await firstValueFrom(store.login('admin@example.com', 'test-password-ok'));
  assert.deepEqual(result, user);
  assert.deepEqual(store.currentUser(), user);
  assert.equal(store.authenticated(), true);
  assert.equal(store.loading(), false);
  assert.deepEqual(writes, []);
});

test('invalid credentials set a generic error and stay unauthenticated', async () => {
  const store = createService({
    post: () => throwError(() => new HttpErrorResponse({ status: 401 })),
  });
  await assert.rejects(() => firstValueFrom(store.login('admin@example.com', 'wrong-password')));
  assert.equal(store.error(), 'Invalid email or password.');
  assert.equal(store.authenticated(), false);
  assert.equal(store.loading(), false);
});

test('login surfaces 429 and 503 without treating them as bad credentials', async () => {
  const tooMany = createService({
    post: () => throwError(() => new HttpErrorResponse({ status: 429 })),
  });
  await assert.rejects(() => firstValueFrom(tooMany.login('a@b.co', 'test-password-ok')));
  assert.match(tooMany.error() ?? '', /Too many login attempts/);

  const down = createService({
    post: () => throwError(() => new HttpErrorResponse({ status: 503 })),
  });
  await assert.rejects(() => firstValueFrom(down.login('a@b.co', 'test-password-ok')));
  assert.match(down.error() ?? '', /not available/);
});

test('whenReady resolves after restoreSession and clearSession drops the user', async () => {
  const pending = createService({
    get: () => of({ user }),
  });
  const ready = firstValueFrom(pending.whenReady());
  await firstValueFrom(pending.restoreSession());
  assert.equal(await ready, true);
  pending.clearSession();
  assert.equal(pending.authenticated(), false);
});

test('restoreSession hydrates a valid session and treats 401 as anonymous', async () => {
  const ok = createService({
    get: (url: string) => {
      assert.equal(url, AUTH_ME_URL);
      return of({ user });
    },
  });
  assert.deepEqual(await firstValueFrom(ok.restoreSession()), user);
  assert.equal(ok.initialized(), true);
  assert.equal(ok.authenticated(), true);

  const missing = createService({
    get: () => throwError(() => new HttpErrorResponse({ status: 401 })),
  });
  assert.equal(await firstValueFrom(missing.restoreSession()), null);
  assert.equal(missing.initialized(), true);
  assert.equal(missing.authenticated(), false);
});

test('logout success clears user; logout failure keeps the session', async () => {
  const success = createService({
    post: (url: string) => {
      assert.equal(url, AUTH_LOGOUT_URL);
      return of({ ok: true });
    },
  });
  success.currentUser.set(user);
  assert.deepEqual(await firstValueFrom(success.logout()), { ok: true });
  assert.equal(success.authenticated(), false);

  const failure = createService({
    post: () => throwError(() => new HttpErrorResponse({ status: 500 })),
  });
  failure.currentUser.set(user);
  await assert.rejects(() => firstValueFrom(failure.logout()));
  assert.equal(failure.authenticated(), true);
  assert.equal(failure.currentUser()?.email, user.email);
  assert.match(failure.error() ?? '', /Could not sign out/);
});

test('login request body never includes a token field', async () => {
  let body: Record<string, unknown> | undefined;
  const store = createService({
    post: (_url: string, payload: Record<string, unknown>) => {
      body = payload;
      return of({ user });
    },
  });
  await firstValueFrom(store.login('admin@example.com', 'test-password-ok'));
  assert.deepEqual(body, { email: 'admin@example.com', password: 'test-password-ok' });
  assert.equal('token' in (body ?? {}), false);
  assert.equal(CSRF_HEADER_VALUE, 'FlowOpsWeb');
  assert.equal(CSRF_HEADER, 'X-Requested-With');
});
