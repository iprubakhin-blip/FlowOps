import '@angular/compiler';
import { HttpClient } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { DEFAULT_TASK_QUERY, NewTask, PaginatedTasks, Task } from '../models/task';
import {
  TasksService,
  applyQueryPatch,
  canNavigateToPage,
  toParams,
} from './tasks.service';

const taskA: Task = {
  id: 1, title: 'A', team: 'QA', priority: 'low', status: 'todo', ownerId: 7,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const taskB: Task = { ...taskA, id: 2, title: 'B' };

function page(items: Task[], pagination: Partial<PaginatedTasks['pagination']> = {}): PaginatedTasks {
  return {
    items,
    pagination: { page: 1, limit: 20, total: items.length, totalPages: 1, ...pagination },
  };
}

function createService(http: object): TasksService {
  const injector = Injector.create({
    providers: [{ provide: HttpClient, useValue: http }],
  });
  const store = runInInjectionContext(injector, () => new TasksService());
  store.reload();
  return store;
}

test('builds paginated query params without sending empty filters', () => {
  const params = toParams({ ...DEFAULT_TASK_QUERY, page: 2, limit: 10, search: 'api', status: 'todo' });
  assert.equal(params.get('page'), '2');
  assert.equal(params.get('limit'), '10');
  assert.equal(params.get('sortBy'), 'createdAt');
  assert.equal(params.get('status'), 'todo');
  assert.equal(params.get('search'), 'api');
  assert.equal(params.get('priority'), null);
});

test('resets to page 1 when search, filters or sorting change', () => {
  const current = { ...DEFAULT_TASK_QUERY, page: 4 };
  assert.equal(applyQueryPatch(current, { search: 'ops' }).page, 1);
  assert.equal(applyQueryPatch(current, { status: 'done' }).page, 1);
  assert.equal(applyQueryPatch(current, { sortBy: 'title' }).page, 1);
  assert.equal(applyQueryPatch(current, { page: 3 }).page, 3);
});

test('rejects out-of-range pagination', () => {
  assert.equal(canNavigateToPage(0, 1, 3), false);
  assert.equal(canNavigateToPage(1, 1, 3), false);
  assert.equal(canNavigateToPage(4, 1, 3), false);
  assert.equal(canNavigateToPage(2, 1, 3), true);
  assert.equal(canNavigateToPage(1, 1, 0), false);
});

test('stores paginated API responses and exposes loading then idle', () => {
  const http = { get: () => of(page([taskA], { total: 1, totalPages: 1 })) };
  const store = createService(http);
  assert.equal(store.loading(), false);
  assert.equal(store.tasks()[0]?.title, 'A');
  assert.equal(store.pagination().total, 1);
});

test('cancels an in-flight list request when a newer query is issued', () => {
  const first = new Subject<PaginatedTasks>();
  let calls = 0;
  const http = {
    get: () => {
      calls += 1;
      return calls === 1 ? first.asObservable() : of(page([taskB], { page: 2, total: 2, totalPages: 2 }));
    },
  };
  const store = createService(http);
  assert.equal(store.loading(), true);
  store.setPage(2);
  first.next(page([taskA]));
  first.complete();
  assert.equal(store.tasks()[0]?.id, 2);
  assert.equal(store.pagination().page, 2);
  assert.equal(store.error(), null);
});

test('does not request a page outside the current bounds', () => {
  let calls = 0;
  const http = {
    get: () => {
      calls += 1;
      return of(page([taskA], { page: 1, total: 5, totalPages: 1 }));
    },
  };
  const store = createService(http);
  store.setPage(2);
  store.setPage(0);
  assert.equal(calls, 1);
  assert.equal(store.query().page, 1);
});

test('records load errors and retry replaces them', () => {
  let fail = true;
  const http = {
    get: () => fail
      ? throwError(() => new Error('down'))
      : of(page([taskA])),
  };
  const store = createService(http);
  assert.match(store.error() ?? '', /Could not load/);
  fail = false;
  store.reload();
  assert.equal(store.error(), null);
  assert.equal(store.tasks().length, 1);
});

test('create resets to page 1 and reloads the list', () => {
  const requests: string[] = [];
  let posted: NewTask | undefined;
  const http = {
    get: () => {
      requests.push('GET');
      return of(page([taskB], { page: 1, total: 2, totalPages: 1 }));
    },
    post: (_url: string, body: NewTask) => {
      posted = body;
      requests.push('POST');
      return of(taskB);
    },
  };
  const store = createService(http);
  store.patchQuery({ page: 2 });
  let saved = false;
  store.create({ title: 'New task', team: 'QA', priority: 'high' }, () => { saved = true; });
  assert.deepEqual(requests, ['GET', 'GET', 'POST', 'GET']);
  assert.equal(store.query().page, 1);
  assert.equal(saved, true);
  assert.equal('ownerId' in posted, false);
});

test('status updates reload the current query', () => {
  const requests: string[] = [];
  const http = {
    get: () => {
      requests.push('GET');
      return of(page([{ ...taskA, status: 'done' }]));
    },
    patch: () => {
      requests.push('PATCH');
      return of({ ...taskA, status: 'done' });
    },
  };
  const store = createService(http);
  store.updateStatus(taskA, 'done');
  assert.deepEqual(requests, ['GET', 'PATCH', 'GET']);
  assert.equal(store.tasks()[0]?.status, 'done');
});

test('status 404 is shown without treating it as a session expiry', () => {
  const http = {
    get: () => of(page([taskA])),
    patch: () => throwError(() => new HttpErrorResponse({ status: 404 })),
  };
  const store = createService(http);
  store.updateStatus(taskA, 'done');
  assert.match(store.error() ?? '', /no longer available/);
  assert.doesNotMatch(store.error() ?? '', /session expired/);
  assert.equal(store.tasks()[0]?.ownerId, 7);
});
