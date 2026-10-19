import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCredentials } from './credentials';
import { csrfDecision } from './csrf';

test('normalizes email and accepts a valid password', () => {
  const parsed = parseCredentials({ email: '  Admin@Example.COM ', password: 'long-enough' });
  assert.deepEqual(parsed, { email: 'admin@example.com', password: 'long-enough' });
});

test('rejects invalid email and password shapes with generic field errors', () => {
  assert.throws(() => parseCredentials(null), /JSON object/);
  assert.throws(() => parseCredentials({ email: 'not-an-email', password: 'long-enough' }), /Email is invalid/);
  assert.throws(() => parseCredentials({ email: 'a@b.c', password: 'short' }), /Password is invalid/);
});

test('CSRF allows trusted SPA requests and denies cross-site form posts', () => {
  assert.equal(csrfDecision({ method: 'GET' }), 'allow');
  assert.equal(csrfDecision({
    method: 'POST',
    requestedWith: 'FlowOpsWeb',
    origin: 'http://127.0.0.1:4300',
  }), 'allow');
  assert.equal(csrfDecision({ method: 'POST' }), 'deny');
  assert.equal(csrfDecision({
    method: 'POST',
    requestedWith: 'FlowOpsWeb',
    origin: 'https://evil.example',
  }), 'deny');
  assert.equal(csrfDecision({
    method: 'POST',
    requestedWith: 'FlowOpsWeb',
    secFetchSite: 'cross-site',
  }), 'deny');
  assert.equal(csrfDecision({
    method: 'POST',
    requestedWith: 'FlowOpsWeb',
  }), 'allow');
  assert.equal(csrfDecision({
    method: 'POST',
    requestedWith: 'XMLHttpRequest',
    origin: 'http://127.0.0.1:4300',
  }), 'deny');
});
