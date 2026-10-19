import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Subject, firstValueFrom } from 'rxjs';
import { authGuard, guestGuard } from './auth.guard';
import { AuthService } from './auth.service';

function runGuard(
  guard: typeof authGuard | typeof guestGuard,
  auth: object,
  router: object,
  stateUrl = '/',
): ReturnType<typeof authGuard> {
  return runInInjectionContext(
    Injector.create({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
    }),
    () => guard({} as never, { url: stateUrl } as never),
  );
}

test('authGuard allows authenticated users and sends others to /login', () => {
  const router = { createUrlTree: (commands: unknown[], extras?: unknown) => ({ commands, extras }) };
  const allowed = runGuard(authGuard, {
    authenticated: () => true,
    initialized: () => true,
  }, router);
  assert.equal(allowed, true);

  const blocked = runGuard(authGuard, {
    authenticated: () => false,
    initialized: () => true,
  }, router, '/');
  assert.deepEqual(blocked, { commands: ['/login'], extras: undefined });
});

test('authGuard waits for auth initialization instead of treating loading as logged out', async () => {
  const ready = new Subject<boolean>();
  const router = { createUrlTree: (commands: unknown[]) => ({ commands }) };
  const result = runGuard(authGuard, {
    authenticated: () => true,
    initialized: () => false,
    whenReady: () => ready.asObservable(),
  }, router);
  assert.equal(typeof (result as { subscribe?: unknown }).subscribe, 'function');
  let allowed: unknown;
  (result as ReturnType<typeof authGuard> & { subscribe: typeof ready.subscribe }).subscribe((value) => {
    allowed = value;
  });
  assert.equal(allowed, undefined);
  ready.next(true);
  ready.complete();
  assert.equal(allowed, true);
  await Promise.resolve();
});

test('authGuard preserves a safe relative return URL', () => {
  const router = { createUrlTree: (commands: unknown[], extras?: unknown) => ({ commands, extras }) };
  const blocked = runGuard(authGuard, {
    authenticated: () => false,
    initialized: () => true,
  }, router, '/?page=2');
  assert.deepEqual(blocked, {
    commands: ['/login'],
    extras: { queryParams: { returnUrl: '/?page=2' } },
  });
});

test('guestGuard sends authenticated users to the dashboard', () => {
  const router = { createUrlTree: (commands: unknown[]) => ({ commands }) };
  const bounced = runGuard(guestGuard, {
    authenticated: () => true,
    initialized: () => true,
  }, router);
  assert.deepEqual(bounced, { commands: ['/'] });

  const login = runGuard(guestGuard, {
    authenticated: () => false,
    initialized: () => true,
  }, router);
  assert.equal(login, true);
});

test('guestGuard waits for initialization', async () => {
  const ready = new Subject<boolean>();
  const router = { createUrlTree: (commands: unknown[]) => ({ commands }) };
  const result = runGuard(guestGuard, {
    authenticated: () => false,
    initialized: () => false,
    whenReady: () => ready.asObservable(),
  }, router);
  const pending = firstValueFrom(result as Exclude<typeof result, boolean>);
  ready.next(true);
  ready.complete();
  assert.equal(await pending, true);
});
