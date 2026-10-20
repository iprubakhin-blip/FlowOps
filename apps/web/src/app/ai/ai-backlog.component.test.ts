import '@angular/compiler';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injector, runInInjectionContext } from '@angular/core';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Observable, Subject, of, throwError } from 'rxjs';
import { EMPTY_TASK_SUMMARY, Task } from '../models/task';
import { TasksService } from '../services/tasks.service';
import { AiBacklogComponent, createdMessage } from './ai-backlog.component';
import { AiClient } from './ai.client';
import type { AiCapabilities, AiDraftResponse } from './ai.models';

const capsMock: AiCapabilities = {
  enabled: true,
  provider: 'mock',
  externalProcessingRequired: false,
  maxRequirementsChars: 8000,
  maxDrafts: 10,
};

const capsOpenAi: AiCapabilities = {
  ...capsMock,
  provider: 'openai',
  externalProcessingRequired: true,
};

const capsDisabled: AiCapabilities = {
  ...capsMock,
  enabled: false,
};

const portal: AiDraftResponse = {
  team: 'Platform',
  persisted: false,
  provider: 'mock',
  model: 'flowops-mock',
  warnings: ['No individual task deadlines were stated, so dueDate is null on every draft.'],
  consent: { required: false, granted: false, note: 'local' },
  usage: {
    provider: 'mock',
    model: 'flowops-mock',
    usageAvailable: false,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cachedInputTokens: null,
    cost: { status: 'unavailable', amountUsd: null, catalogVersion: null, note: null },
  },
  tasks: [
    {
      title: 'Design customer login flow',
      description: '<b>untrusted</b>',
      priority: 'high',
      dueDate: null,
      team: 'Platform',
      status: 'todo',
    },
    {
      title: 'Build account dashboard shell',
      description: 'Landing view',
      priority: 'medium',
      dueDate: null,
      team: 'Platform',
      status: 'todo',
    },
  ],
};

const taskA: Task = {
  id: 1, title: 'A', team: 'QA', priority: 'low', status: 'todo', ownerId: 7,
  description: null, dueDate: null, completedAt: null, isOverdue: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

function createStore(postImpl?: (url: string, body: unknown) => Observable<unknown>): TasksService {
  const http = {
    get: (url: string) => url.includes('/summary')
      ? of({ ...EMPTY_TASK_SUMMARY, total: 3, todo: 3 })
      : of({ items: [taskA], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
    post: (url: string, body: unknown) => (postImpl ? postImpl(url, body) : of({ items: [taskA, taskA], createdCount: 2 })),
  };
  return runInInjectionContext(
    Injector.create({ providers: [{ provide: HttpClient, useValue: http }] }),
    () => new TasksService(),
  );
}

function createPanel(ai: Partial<AiClient>, store = createStore()): AiBacklogComponent {
  store.reload();
  store.reloadSummary();
  return runInInjectionContext(
    Injector.create({
      providers: [
        { provide: AiClient, useValue: ai },
        { provide: TasksService, useValue: store },
        { provide: DestroyRef, useValue: { onDestroy: () => () => undefined } },
      ],
    }),
    () => new AiBacklogComponent(),
  );
}

test('loads mock capabilities without generating or persisting', () => {
  let generates = 0;
  const panel = createPanel({
    capabilities: () => of(capsMock),
    generateDrafts: () => {
      generates += 1;
      return of(portal);
    },
  });
  assert.equal(panel.capabilities()?.enabled, true);
  assert.equal(panel.mockMode(), true);
  assert.equal(panel.consentRequired(), false);
  assert.equal(panel.consentChecked(), false);
  assert.equal(panel.drafts().length, 0);
  assert.equal(generates, 0);
  assert.equal(panel.canGenerate(), false);
});

test('disabled AI and OpenAI consent default to a safe UI state', () => {
  const disabled = createPanel({ capabilities: () => of(capsDisabled), generateDrafts: () => of(portal) });
  assert.equal(disabled.canGenerate(), false);
  const openai = createPanel({ capabilities: () => of(capsOpenAi), generateDrafts: () => of(portal) });
  assert.equal(openai.consentRequired(), true);
  assert.equal(openai.consentChecked(), false);
  assert.equal(openai.canGenerate(), false);
  openai.requirements.set('Build a customer portal with login and invoices.');
  openai.generate();
  assert.equal(openai.drafts().length, 0);
  openai.consentChecked.set(true);
  assert.equal(openai.canGenerate(), true);
});

test('generate sends the selected team and consent flag once', () => {
  const pending = new Subject<AiDraftResponse>();
  const bodies: unknown[] = [];
  const panel = createPanel({
    capabilities: () => of(capsMock),
    generateDrafts: (body) => {
      bodies.push(body);
      return pending.asObservable();
    },
  });
  panel.requirements.set('Build a customer portal with login, invoices, and payments.');
  panel.team.set('Platform');
  panel.generate();
  panel.generate();
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0], {
    requirements: 'Build a customer portal with login, invoices, and payments.',
    team: 'Platform',
    allowExternalProcessing: false,
  });
  pending.next(portal);
  pending.complete();
  assert.equal(panel.drafts().length, 2);
  assert.equal(panel.lastResponse()?.persisted, false);
  assert.match(panel.warnings()[0] ?? '', /dueDate/);
  assert.equal(panel.lastResponse()?.usage.usageAvailable, false);
  assert.equal(panel.drafts()[0].description, '<b>untrusted</b>');
  assert.match(panel.drafts()[0].localId, /^local-/);
  assert.equal('id' in panel.drafts()[0], false);
});

test('OpenAI generate includes consent only after the checkbox', () => {
  const bodies: Array<{ allowExternalProcessing: boolean }> = [];
  const panel = createPanel({
    capabilities: () => of(capsOpenAi),
    generateDrafts: (body) => {
      bodies.push(body);
      return of(portal);
    },
  });
  panel.requirements.set('Build a customer portal with login and invoices.');
  panel.consentChecked.set(true);
  panel.generate();
  assert.equal(bodies[0]?.allowExternalProcessing, true);
});

test('drafts can be edited, dated, cleared, removed, added, and capped at 10', () => {
  const panel = createPanel({ capabilities: () => of(capsMock), generateDrafts: () => of(portal) });
  panel.requirements.set('Build a customer portal with login and invoices.');
  panel.generate();
  const first = panel.drafts()[0].localId;
  panel.updateDraft(first, { title: 'Edited login', description: 'plain text', priority: 'low', dueDate: '2026-11-02' });
  assert.equal(panel.drafts()[0].title, 'Edited login');
  assert.equal(panel.drafts()[0].priority, 'low');
  assert.equal(panel.drafts()[0].dueDate, '2026-11-02');
  panel.updateDraft(first, { dueDate: '' });
  assert.equal(panel.drafts()[0].dueDate, '');
  panel.removeDraft(panel.drafts()[1].localId);
  assert.equal(panel.drafts().length, 1);
  for (let index = 0; index < 12; index += 1) panel.addDraft();
  assert.equal(panel.drafts().length, 10);
  panel.discardDrafts();
  assert.equal(panel.drafts().length, 0);
  assert.equal(panel.lastResponse(), null);
});

test('invalid drafts block create; success refreshes list and summary; failure keeps drafts', () => {
  const posts: Array<{ url: string; body: unknown }> = [];
  const okStore = createStore((url, body) => {
    posts.push({ url, body });
    return of({ items: [taskA], createdCount: 1 });
  });
  const panel = createPanel({ capabilities: () => of(capsMock), generateDrafts: () => of(portal) }, okStore);
  panel.requirements.set('Build a customer portal with login and invoices.');
  panel.generate();
  panel.updateDraft(panel.drafts()[0].localId, { title: 'no' });
  assert.equal(panel.canCreate(), false);
  panel.createTasks();
  assert.equal(posts.length, 0);
  panel.updateDraft(panel.drafts()[0].localId, { title: 'Edited login flow' });
  panel.removeDraft(panel.drafts()[1].localId);
  panel.createTasks();
  assert.equal(posts[0]?.url, '/api/tasks/bulk');
  const body = posts[0]?.body as { team: string; tasks: Array<Record<string, unknown>> };
  assert.equal(body.team, 'Platform');
  assert.equal('ownerId' in body.tasks[0], false);
  assert.equal('localId' in body.tasks[0], false);
  assert.equal(panel.drafts().length, 0);
  assert.match(panel.persistSuccess() ?? '', /Created 1 task/);

  const failStore = createStore(() => throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'Title must be between 3 and 120 characters.' } })));
  const failing = createPanel({ capabilities: () => of(capsMock), generateDrafts: () => of(portal) }, failStore);
  failing.requirements.set('Build a customer portal with login and invoices.');
  failing.generate();
  failing.createTasks();
  assert.equal(failing.drafts().length, 2);
  assert.match(failing.persistError() ?? '', /Title/);
});

test('quota, timeout, and network errors do not auto-retry generation', () => {
  let calls = 0;
  const panel = createPanel({
    capabilities: () => of(capsMock),
    generateDrafts: () => {
      calls += 1;
      return throwError(() => new HttpErrorResponse({ status: 429, error: { error: 'QUOTA_EXCEEDED', message: 'The daily AI request quota for this user has been reached.' } }));
    },
  });
  panel.requirements.set('Build a customer portal with login and invoices.');
  panel.generate();
  assert.equal(calls, 1);
  assert.match(panel.generateError() ?? '', /quota/i);
  const timeout = createPanel({
    capabilities: () => of(capsMock),
    generateDrafts: () => throwError(() => new HttpErrorResponse({ status: 504, error: { error: 'TIMEOUT', message: 'The AI request timed out.' } })),
  });
  timeout.requirements.set('Build a customer portal with login and invoices.');
  timeout.generate();
  assert.match(timeout.generateError() ?? '', /timed out/i);
  const network = createPanel({
    capabilities: () => of(capsMock),
    generateDrafts: () => throwError(() => new HttpErrorResponse({ status: 0 })),
  });
  network.requirements.set('Build a customer portal with login and invoices.');
  network.generate();
  assert.match(network.generateError() ?? '', /not confirmed/);
});

test('double create is blocked while saving', () => {
  const pending = new Subject<{ items: Task[]; createdCount: number }>();
  let posts = 0;
  const store = createStore(() => {
    posts += 1;
    return pending.asObservable();
  });
  const panel = createPanel({ capabilities: () => of(capsMock), generateDrafts: () => of(portal) }, store);
  panel.requirements.set('Build a customer portal with login and invoices.');
  panel.generate();
  panel.createTasks();
  panel.createTasks();
  assert.equal(posts, 1);
  pending.next({ items: [taskA], createdCount: 2 });
  pending.complete();
});

test('created copy mentions filters when the current query would hide new todos', () => {
  assert.equal(createdMessage(2), 'Created 2 tasks.');
  assert.match(createdMessage(1, 'portal'), /hidden by the current search/);
});
