import '@angular/compiler';
import assert from 'node:assert/strict';
import test from 'node:test';
import { routes } from './app.routes';
import { authGuard, guestGuard } from './auth/auth.guard';

test('protects the dashboard and keeps login public for guests', () => {
  const login = routes.find((route) => route.path === 'login');
  const home = routes.find((route) => route.path === '');
  assert.deepEqual(login?.canActivate, [guestGuard]);
  assert.deepEqual(home?.canActivate, [authGuard]);
  assert.ok(login?.component);
  assert.ok(home?.component);
});
