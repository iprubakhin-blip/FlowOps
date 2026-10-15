import assert from 'node:assert/strict';
import test from 'node:test';
import { TestScheduler } from 'rxjs/testing';
import { searchQuery$ } from './search-query';

function scheduler(): TestScheduler {
  return new TestScheduler((actual, expected) => assert.deepEqual(actual, expected));
}

test('debounces search input by 300ms and skips duplicate trimmed values', () => {
  scheduler().run(({ cold, expectObservable }) => {
    const input = cold('a 50ms b 50ms c 300ms d', {
      a: 'g',
      b: 'ga',
      c: 'gat',
      d: ' gat ',
    });
    expectObservable(searchQuery$(input)).toBe('402ms x', { x: 'gat' });
  });
});

test('clears search after debounce when the input is blank', () => {
  scheduler().run(({ cold, expectObservable }) => {
    const input = cold('a 300ms b', { a: 'api', b: '   ' });
    expectObservable(searchQuery$(input)).toBe('300ms x 300ms y', { x: 'api', y: undefined });
  });
});
