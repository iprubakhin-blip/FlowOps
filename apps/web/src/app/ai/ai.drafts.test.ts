import '@angular/compiler';
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBulkBody, buildGenerateBody, draftsFromResponse, firstInvalidDraftError, validateRequirements } from './ai.drafts';
import type { AiDraftResponse } from './ai.models';

const response: AiDraftResponse = {
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
      description: '<img src=x onerror=alert(1)>',
      priority: 'high',
      dueDate: null,
      team: 'Platform',
      status: 'todo',
    },
  ],
};

test('generate payload never includes ownerId or API keys', () => {
  const body = buildGenerateBody('Build a customer portal with login and invoices.', 'Platform', true);
  assert.deepEqual(body, {
    requirements: 'Build a customer portal with login and invoices.',
    team: 'Platform',
    allowExternalProcessing: true,
  });
  assert.equal('ownerId' in body, false);
  assert.equal('apiKey' in body, false);
});

test('requirements length is validated against the server limit', () => {
  assert.equal(validateRequirements('short', 8000) !== null, true);
  assert.equal(validateRequirements('x'.repeat(8001), 8000) !== null, true);
  assert.equal(validateRequirements('Build a customer portal with login.', 8000), null);
});

test('bulk payload keeps only allowed task fields and drops local ids', () => {
  const drafts = draftsFromResponse(response);
  drafts[0].dueDate = '2026-11-02';
  const body = buildBulkBody('Platform', drafts);
  assert.equal('error' in body, false);
  if ('error' in body) return;
  assert.deepEqual(body, {
    team: 'Platform',
    tasks: [{
      title: 'Design customer login flow',
      description: '<img src=x onerror=alert(1)>',
      priority: 'high',
      dueDate: '2026-11-02',
    }],
  });
  assert.equal('localId' in body.tasks[0], false);
  assert.equal('ownerId' in body.tasks[0], false);
  assert.equal('status' in body.tasks[0], false);
});

test('invalid drafts and empty batches block create', () => {
  assert.match(firstInvalidDraftError('Platform', []) ?? '', /at least one/i);
  const drafts = draftsFromResponse(response);
  drafts[0].title = 'no';
  assert.match(firstInvalidDraftError('Platform', drafts) ?? '', /Title/);
});
