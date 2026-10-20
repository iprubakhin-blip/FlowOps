import '@angular/compiler';
import { HttpClient } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import {
  DEFAULT_TASK_QUERY,
  EMPTY_TASK_SUMMARY,
  NewTask,
  PaginatedTasks,
  Task,
  TaskSummary,
} from '../models/task';
import {
  TasksService,
  applyQueryPatch,
  canNavigateToPage,
  toParams,
} from './tasks.service';

const taskA: Task = {
  id: 1, title: 'A', team: 'QA', priority: 'low', status: 'todo', ownerId: 7,
  description: null, dueDate: null, completedAt: null, isOverdue: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const taskB: Task = { ...taskA, id: 2, title: 'B' };
const summaryA: TaskSummary = {
  total: 9, todo: 4, inProgress: 2, done: 3, overdue: 1, highPriorityOpen: 2,
};

function page(items: Task[], pagination: Partial<PaginatedTasks['pagination']> = {}): PaginatedTasks {
  return {
    items,
    pagination: { page: 1, limit: 20, total: items.length, totalPages: 1, ...pagination },
  };
}

function isSummaryUrl(url: string): boolean {
  return url.includes('/summary');
}

function createService(http: object): TasksService {
  const injector = Injector.create({
    providers: [{ provide: HttpClient, useValue: http }],
  });
  const store = runInInjectionContext(injector, () => new TasksService());
  store.reload();
  store.reloadSummary();
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
  assert.equal(applyQueryPatch(current, { sortBy: 'dueDate' }).page, 1);
  assert.equal(applyQueryPatch(current, { page: 3 }).page, 3);
});

test('rejects out-of-range pagination', () => {
  assert.equal(canNavigateToPage(0, 1, 3), false);
  assert.equal(canNavigateToPage(1, 1, 3), false);
  assert.equal(canNavigateToPage(4, 1, 3), false);
  assert.equal(canNavigateToPage(2, 1, 3), true);
  assert.equal(canNavigateToPage(1, 1, 0), false);
});

test('stores paginated API responses separately from summary totals', () => {
  const urls: string[] = [];
  const http = {
    get: (url: string) => {
      urls.push(url);
      if (isSummaryUrl(url)) return of(summaryA);
      return of(page([taskA], { total: 1, totalPages: 1 }));
    },
  };
  const store = createService(http);
  assert.equal(store.loading(), false);
  assert.equal(store.tasks()[0]?.title, 'A');
  assert.equal(store.tasks()[0]?.isOverdue, false);
  assert.equal(store.pagination().total, 1);
  assert.equal(store.summary().total, 9);
  assert.equal(store.summary().overdue, 1);
  assert.equal(urls.some((url) => url.endsWith('/api/tasks/summary')), true);
  assert.equal(urls.some((url) => url.includes('ownerId')), false);
});

test('cancels an in-flight list request when a newer query is issued', () => {
  const first = new Subject<PaginatedTasks>();
  let listCalls = 0;
  const http = {
    get: (url: string) => {
      if (isSummaryUrl(url)) return of(EMPTY_TASK_SUMMARY);
      listCalls += 1;
      return listCalls === 1 ? first.asObservable() : of(page([taskB], { page: 2, total: 2, totalPages: 2 }));
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
  let listCalls = 0;
  const http = {
    get: (url: string) => {
      if (isSummaryUrl(url)) return of(EMPTY_TASK_SUMMARY);
      listCalls += 1;
      return of(page([taskA], { page: 1, total: 5, totalPages: 1 }));
    },
  };
  const store = createService(http);
  store.setPage(2);
  store.setPage(0);
  assert.equal(listCalls, 1);
  assert.equal(store.query().page, 1);
});

test('records load errors and retry replaces them', () => {
  let fail = true;
  const http = {
    get: (url: string) => {
      if (isSummaryUrl(url)) return of(EMPTY_TASK_SUMMARY);
      return fail ? throwError(() => new Error('down')) : of(page([taskA]));
    },
  };
  const store = createService(http);
  assert.match(store.error() ?? '', /Could not load/);
  fail = false;
  store.reload();
  assert.equal(store.error(), null);
  assert.equal(store.tasks().length, 1);
});

test('summary error and retry do not use pagination totals', () => {
  let failSummary = true;
  const http = {
    get: (url: string) => {
      if (isSummaryUrl(url)) {
        return failSummary
          ? throwError(() => new Error('summary-down'))
          : of(summaryA);
      }
      return of(page([taskA, taskB], { total: 2 }));
    },
  };
  const store = createService(http);
  assert.match(store.summaryError() ?? '', /Could not load/);
  assert.equal(store.pagination().total, 2);
  assert.equal(store.summary().total, 0);
  failSummary = false;
  store.reloadSummary();
  assert.equal(store.summaryError(), null);
  assert.equal(store.summary().total, 9);
  assert.notEqual(store.summary().total, store.pagination().total);
});

test('create with details resets to page 1 and refreshes list plus summary', () => {
  const requests: string[] = [];
  let posted: NewTask | undefined;
  const http = {
    get: (url: string) => {
      requests.push(isSummaryUrl(url) ? 'GET summary' : 'GET list');
      if (isSummaryUrl(url)) return of(summaryA);
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
  store.create({ title: 'New task', team: 'QA', priority: 'high', description: 'Ship it', dueDate: '2026-11-01' }, () => {
    saved = true;
  });
  assert.deepEqual(requests, [
    'GET list', 'GET summary', 'GET list', 'POST', 'GET list', 'GET summary',
  ]);
  assert.equal(store.query().page, 1);
  assert.equal(saved, true);
  assert.equal(posted?.description, 'Ship it');
  assert.equal(posted?.dueDate, '2026-11-01');
  assert.equal('ownerId' in (posted ?? {}), false);
  assert.equal('completedAt' in (posted ?? {}), false);
});

test('create without optional fields remains compatible', () => {
  let posted: NewTask | undefined;
  const http = {
    get: (url: string) => isSummaryUrl(url) ? of(EMPTY_TASK_SUMMARY) : of(page([taskB])),
    post: (_url: string, body: NewTask) => {
      posted = body;
      return of(taskB);
    },
  };
  const store = createService(http);
  store.create({ title: 'Legacy create', team: 'QA', priority: 'low' }, () => undefined);
  assert.deepEqual(posted, { title: 'Legacy create', team: 'QA', priority: 'low' });
});

test('bulk create posts allowed fields then refreshes list and summary', () => {
  const requests: string[] = [];
  let posted: unknown;
  const http = {
    get: (url: string) => {
      requests.push(isSummaryUrl(url) ? 'GET summary' : 'GET list');
      if (isSummaryUrl(url)) return of(summaryA);
      return of(page([taskB], { page: 1, total: 2, totalPages: 1 }));
    },
    post: (url: string, body: unknown) => {
      posted = body;
      requests.push(url);
      return of({ items: [taskB], createdCount: 1 });
    },
  };
  const store = createService(http);
  let saved = 0;
  store.createBulk({
    team: 'Platform',
    tasks: [{ title: 'Bulk one', description: 'notes', priority: 'high', dueDate: null }],
  }, (count) => { saved = count; });
  assert.equal(posted && typeof posted === 'object' && 'ownerId' in posted, false);
  assert.equal(saved, 1);
  assert.equal(requests.includes('/api/tasks/bulk'), true);
  assert.equal(store.query().page, 1);
});

test('duplicate create submits are ignored while saving', () => {
  let posts = 0;
  const pending = new Subject<Task>();
  const http = {
    get: (url: string) => isSummaryUrl(url) ? of(EMPTY_TASK_SUMMARY) : of(page([taskA])),
    post: () => {
      posts += 1;
      return pending.asObservable();
    },
  };
  const store = createService(http);
  store.create({ title: 'Once', team: 'QA', priority: 'low' }, () => undefined);
  store.create({ title: 'Twice', team: 'QA', priority: 'low' }, () => undefined);
  assert.equal(posts, 1);
  pending.next(taskA);
  pending.complete();
});

test('status updates reload the current query and summary', () => {
  const requests: string[] = [];
  const http = {
    get: (url: string) => {
      requests.push(isSummaryUrl(url) ? 'GET summary' : 'GET list');
      if (isSummaryUrl(url)) return of(summaryA);
      return of(page([{ ...taskA, status: 'done', completedAt: '2026-01-02T00:00:00.000Z' }]));
    },
    patch: (url: string, body: { status: string }) => {
      requests.push('PATCH status');
      assert.match(url, /\/status$/);
      assert.deepEqual(body, { status: 'done' });
      return of({ ...taskA, status: 'done', completedAt: '2026-01-02T00:00:00.000Z' });
    },
  };
  const store = createService(http);
  store.updateStatus(taskA, 'done');
  assert.deepEqual(requests, ['GET list', 'GET summary', 'PATCH status', 'GET list', 'GET summary']);
  assert.equal(store.tasks()[0]?.status, 'done');
  assert.equal(store.tasks()[0]?.completedAt, '2026-01-02T00:00:00.000Z');
});

test('edit patch refreshes displayed data; 400 403 404 and network errors surface', () => {
  const httpOk = {
    get: (url: string) => isSummaryUrl(url) ? of(summaryA) : of(page([taskA])),
    patch: (url: string, body: object) => {
      assert.equal(url, '/api/tasks/1');
      assert.deepEqual(body, { dueDate: null, description: null });
      return of({ ...taskA, description: null, dueDate: null });
    },
  };
  const store = createService(httpOk);
  let saved = false;
  store.update(1, { dueDate: null, description: null }, () => { saved = true; });
  assert.equal(saved, true);

  const store400 = createService({
    get: (url: string) => isSummaryUrl(url) ? of(EMPTY_TASK_SUMMARY) : of(page([taskA])),
    patch: () => throwError(() => new HttpErrorResponse({
      status: 400,
      error: { message: 'dueDate must be a real calendar date.' },
    })),
  });
  store400.update(1, { dueDate: '2026-02-30' }, () => undefined);
  assert.match(store400.error() ?? '', /calendar date/);

  const store404 = createService({
    get: (url: string) => isSummaryUrl(url) ? of(EMPTY_TASK_SUMMARY) : of(page([taskA])),
    patch: () => throwError(() => new HttpErrorResponse({ status: 404 })),
  });
  store404.update(1, { title: 'Gone' }, () => undefined);
  assert.match(store404.error() ?? '', /no longer available/);
  assert.doesNotMatch(store404.error() ?? '', /session expired/);

  const store403 = createService({
    get: (url: string) => isSummaryUrl(url) ? of(EMPTY_TASK_SUMMARY) : of(page([taskA])),
    patch: () => throwError(() => new HttpErrorResponse({ status: 403 })),
  });
  store403.update(1, { title: 'Blocked' }, () => undefined);
  assert.match(store403.error() ?? '', /blocked/i);

  const storeNet = createService({
    get: (url: string) => isSummaryUrl(url) ? of(EMPTY_TASK_SUMMARY) : of(page([taskA])),
    patch: () => throwError(() => new HttpErrorResponse({ status: 0 })),
  });
  storeNet.update(1, { title: 'Offline' }, () => undefined);
  assert.match(storeNet.error() ?? '', /Could not reach/);
});

test('status 404 is shown without treating it as a session expiry', () => {
  const http = {
    get: (url: string) => isSummaryUrl(url) ? of(EMPTY_TASK_SUMMARY) : of(page([taskA])),
    patch: () => throwError(() => new HttpErrorResponse({ status: 404 })),
  };
  const store = createService(http);
  store.updateStatus(taskA, 'done');
  assert.match(store.error() ?? '', /no longer available/);
  assert.doesNotMatch(store.error() ?? '', /session expired/);
  assert.equal(store.tasks()[0]?.ownerId, 7);
});
