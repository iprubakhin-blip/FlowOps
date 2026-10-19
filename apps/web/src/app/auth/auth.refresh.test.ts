import '@angular/compiler';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetRefreshInFlight, withRefreshLock } from './auth.refresh';

test('withRefreshLock serializes work when the Web Locks API is present', async () => {
  resetRefreshInFlight();
  const order: number[] = [];
  let chain = Promise.resolve();
  const previous = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (_name: string, callback: () => Promise<unknown>) => {
          const run = chain.then(() => callback());
          chain = run.then(() => undefined, () => undefined);
          return run;
        },
      },
    },
  });
  try {
    const first = withRefreshLock(async () => {
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(2);
      return 'a';
    });
    const second = withRefreshLock(async () => {
      order.push(3);
      return 'b';
    });
    assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
    assert.deepEqual(order, [1, 2, 3]);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous });
  }
});

test('withRefreshLock runs work immediately when Web Locks are unavailable', async () => {
  const previous = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    assert.equal(await withRefreshLock(async () => 'direct'), 'direct');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous });
  }
});

test('withRefreshLock releases after an error so a later refresh can run', async () => {
  let held = false;
  const previous = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async (_name: string, callback: () => Promise<unknown>) => {
          if (held) throw new Error('lock was not released');
          held = true;
          try {
            return await callback();
          } finally {
            held = false;
          }
        },
      },
    },
  });
  try {
    await assert.rejects(() => withRefreshLock(async () => {
      throw new Error('refresh failed');
    }), /refresh failed/);
    assert.equal(await withRefreshLock(async () => 'recovered'), 'recovered');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous });
  }
});

test('withRefreshLock does not store tokens in web storage', async () => {
  const writes: string[] = [];
  const storage = {
    getItem: () => null,
    setItem: (key: string) => writes.push(key),
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  await withRefreshLock(async () => 'ok');
  assert.deepEqual(writes, []);
});
