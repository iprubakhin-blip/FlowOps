import assert from 'node:assert/strict';
import test from 'node:test';
import { AiError } from './ai.errors';
import { getRegisteredSchema, toOpenAiJsonSchema } from './ai.registry';
import { validateStructured } from './ai.schema';
import { PORTAL_DRAFT_OUTPUT } from './task-draft.fixtures';
import { TASK_DRAFT_RUNTIME_SCHEMA } from './task-draft.schema';
import { TASK_DRAFT_SCHEMA_NAME } from './task-draft.types';

test('task.drafts.v1 is registered with a strict provider schema', () => {
  const registered = getRegisteredSchema(TASK_DRAFT_SCHEMA_NAME);
  assert.ok(registered);
  assert.equal(registered.providerFormatName, 'task_drafts_v1');
  assert.equal(registered.providerJsonSchema.additionalProperties, false);
  const tasks = (registered.providerJsonSchema.properties as { tasks: { items: { required: string[]; additionalProperties: boolean } } }).tasks;
  assert.deepEqual(tasks.items.required, ['title', 'description', 'priority', 'dueDate']);
  assert.equal(tasks.items.additionalProperties, false);
  const converted = toOpenAiJsonSchema(TASK_DRAFT_RUNTIME_SCHEMA);
  const dueDate = ((converted.properties as { tasks: { items: { properties: { dueDate: { type: unknown } } } } }).tasks.items.properties.dueDate);
  assert.deepEqual(dueDate.type, ['string', 'null']);
});

test('runtime schema accepts the portal fixture and rejects empty or invalid drafts', () => {
  const valid = validateStructured(PORTAL_DRAFT_OUTPUT, TASK_DRAFT_RUNTIME_SCHEMA);
  assert.equal((valid as typeof PORTAL_DRAFT_OUTPUT).tasks.length, PORTAL_DRAFT_OUTPUT.tasks.length);
  assert.throws(
    () => validateStructured({ tasks: [], warnings: [] }, TASK_DRAFT_RUNTIME_SCHEMA),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
  assert.throws(
    () => validateStructured({
      tasks: [{ title: 'No', description: 'Desc', priority: 'urgent', dueDate: null }],
      warnings: [],
    }, TASK_DRAFT_RUNTIME_SCHEMA),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
  assert.throws(
    () => validateStructured({
      tasks: [{ title: 'Valid title here', description: 'Desc', priority: 'low', dueDate: null, ownerId: 1 }],
      warnings: [],
    }, TASK_DRAFT_RUNTIME_SCHEMA),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
});
