import '@angular/compiler';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpErrorResponse } from '@angular/common/http';
import { loginErrorMessage, logoutErrorMessage, taskLoadErrorMessage, taskWriteErrorMessage } from './auth.errors';
import { isAuthMutation, needsCsrfHeader, safeReturnUrl, shouldAttemptRefresh } from './auth.session';

test('maps login HTTP statuses to generic messages', () => {
  assert.equal(loginErrorMessage(new HttpErrorResponse({ status: 401 })), 'Invalid email or password.');
  assert.equal(loginErrorMessage(new HttpErrorResponse({ status: 429 })), 'Too many login attempts. Try again in a minute.');
  assert.equal(loginErrorMessage(new HttpErrorResponse({ status: 503 })), 'Authentication is not available right now.');
  assert.equal(loginErrorMessage(new HttpErrorResponse({ status: 0 })), 'Could not reach the API.');
});

test('logout failure does not claim success', () => {
  assert.match(logoutErrorMessage(new HttpErrorResponse({ status: 0 })), /still be signed in/);
});

test('auth mutations require CSRF and skip refresh loops', () => {
  assert.equal(isAuthMutation('POST', '/api/auth/login'), true);
  assert.equal(isAuthMutation('POST', '/api/auth/refresh'), true);
  assert.equal(isAuthMutation('POST', '/api/tasks'), false);
  assert.equal(isAuthMutation('GET', '/api/auth/me'), false);
  assert.equal(needsCsrfHeader('POST', '/api/auth/login'), true);
  assert.equal(needsCsrfHeader('POST', '/api/tasks'), true);
  assert.equal(needsCsrfHeader('POST', '/api/tasks/bulk'), true);
  assert.equal(needsCsrfHeader('POST', '/api/ai/task-drafts'), true);
  assert.equal(needsCsrfHeader('GET', '/api/ai/capabilities'), false);
  assert.equal(needsCsrfHeader('PATCH', '/api/tasks/3/status'), true);
  assert.equal(needsCsrfHeader('PATCH', '/api/tasks/3'), true);
  assert.equal(needsCsrfHeader('GET', '/api/tasks'), false);
  assert.equal(needsCsrfHeader('GET', '/api/tasks/summary'), false);
  assert.equal(shouldAttemptRefresh('/api/tasks', false), true);
  assert.equal(shouldAttemptRefresh('/api/auth/me', false), true);
  assert.equal(shouldAttemptRefresh('/api/auth/login', false), false);
  assert.equal(shouldAttemptRefresh('/api/auth/refresh', false), false);
  assert.equal(shouldAttemptRefresh('/api/auth/logout', false), false);
  assert.equal(shouldAttemptRefresh('/api/tasks', true), false);
});

test('safeReturnUrl rejects external and login targets', () => {
  assert.equal(safeReturnUrl('/?page=2'), '/?page=2');
  assert.equal(safeReturnUrl('https://evil.example/'), '/');
  assert.equal(safeReturnUrl('//evil.example'), '/');
  assert.equal(safeReturnUrl('/login'), '/');
  assert.equal(safeReturnUrl(null), '/');
});

test('task 403 and 404 messages are not treated as session expiry', () => {
  assert.match(taskWriteErrorMessage(new HttpErrorResponse({
    status: 400,
    error: { message: 'dueDate must be a real calendar date.' },
  })), /calendar date/);
  assert.match(taskWriteErrorMessage(new HttpErrorResponse({ status: 403 })), /blocked/i);
  assert.match(taskWriteErrorMessage(new HttpErrorResponse({ status: 404 })), /no longer available/);
  assert.match(taskLoadErrorMessage(new HttpErrorResponse({ status: 401 })), /session expired/);
  assert.match(taskLoadErrorMessage(new HttpErrorResponse({ status: 0 })), /Could not reach the API/);
});
