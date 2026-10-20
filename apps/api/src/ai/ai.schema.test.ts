import assert from 'node:assert/strict';
import test from 'node:test';
import { AiError } from './ai.errors';
import { ILLUSTRATIVE_NOTE_SCHEMA, VALID_ILLUSTRATIVE_NOTE } from './ai.fixtures';
import { parseProviderJson, validateStructured } from './ai.schema';

test('valid structured mock-shaped JSON passes the illustrative schema', () => {
  const parsed = parseProviderJson(JSON.stringify(VALID_ILLUSTRATIVE_NOTE));
  const result = validateStructured<typeof VALID_ILLUSTRATIVE_NOTE>(parsed, ILLUSTRATIVE_NOTE_SCHEMA);
  assert.deepEqual(result, VALID_ILLUSTRATIVE_NOTE);
});

test('malformed JSON is rejected as an invalid provider response', () => {
  assert.throws(() => parseProviderJson('{not json'), (error: unknown) => {
    assert.ok(error instanceof AiError);
    assert.equal(error.code, 'INVALID_PROVIDER_RESPONSE');
    assert.equal(error.toPublic().message.includes('sk-'), false);
    return true;
  });
});

test('missing required schema fields fail validation', () => {
  assert.throws(
    () => validateStructured({ title: 'Only title' }, ILLUSTRATIVE_NOTE_SCHEMA),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
});

test('missing notes fails now that the registry and local schema both require it', () => {
  assert.throws(
    () => validateStructured({ title: 'Has title', priority: 'low' }, ILLUSTRATIVE_NOTE_SCHEMA),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
});

test('empty notes array is valid', () => {
  const result = validateStructured({ title: 'Has title', priority: 'low', notes: [] }, ILLUSTRATIVE_NOTE_SCHEMA);
  assert.deepEqual(result, { title: 'Has title', priority: 'low', notes: [] });
});

test('incorrect field types fail validation', () => {
  assert.throws(
    () => validateStructured({ title: 12, priority: 'high', notes: [] }, ILLUSTRATIVE_NOTE_SCHEMA),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
});

test('unsupported enum values fail validation', () => {
  assert.throws(
    () => validateStructured({ title: 'X', priority: 'urgent', notes: [] }, ILLUSTRATIVE_NOTE_SCHEMA),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
});

test('maximum string length is enforced', () => {
  assert.throws(
    () => validateStructured({ title: 'a'.repeat(81), priority: 'low', notes: [] }, ILLUSTRATIVE_NOTE_SCHEMA),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
});

test('maximum array length is enforced', () => {
  assert.throws(
    () => validateStructured({
      title: 'X',
      priority: 'low',
      notes: ['a', 'b', 'c', 'd'],
    }, ILLUSTRATIVE_NOTE_SCHEMA),
    (error: unknown) => error instanceof AiError && error.code === 'VALIDATION_FAILED',
  );
});
