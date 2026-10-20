import assert from 'node:assert/strict';
import test from 'node:test';
import { getRegisteredSchema, toOpenAiJsonSchema } from './ai.registry';
import { ILLUSTRATIVE_NOTE_SCHEMA } from './ai.fixtures';

test('illustrative.note is registered with a provider-compatible strict schema', () => {
  const registered = getRegisteredSchema('illustrative.note');
  assert.ok(registered);
  assert.equal(registered.providerFormatName, 'illustrative_note');
  assert.equal(registered.runtimeSchema, ILLUSTRATIVE_NOTE_SCHEMA);
  assert.deepEqual(registered.runtimeSchema.type === 'object' ? registered.runtimeSchema.required : [], ['title', 'priority', 'notes']);
  const schema = registered.providerJsonSchema;
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, registered.runtimeSchema.type === 'object' ? [...registered.runtimeSchema.required] : []);
});

test('unknown schema names are not registered', () => {
  assert.equal(getRegisteredSchema('task.draft'), undefined);
  assert.equal(getRegisteredSchema('missing'), undefined);
});

test('OpenAI JSON Schema conversion marks every object property required', () => {
  const converted = toOpenAiJsonSchema(ILLUSTRATIVE_NOTE_SCHEMA);
  assert.deepEqual(converted.required, ['title', 'priority', 'notes']);
  const properties = converted.properties as Record<string, { enum?: string[] }>;
  assert.deepEqual(properties.priority.enum, ['low', 'medium', 'high']);
});
