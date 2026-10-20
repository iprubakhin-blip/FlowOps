import { ILLUSTRATIVE_NOTE_SCHEMA, type IllustrativeNote } from './ai.fixtures';
import type { JsonSchema } from './ai.schema';
import { TASK_DRAFT_RUNTIME_SCHEMA } from './task-draft.schema';
import { TASK_DRAFT_SCHEMA_NAME, type TaskDraftModelOutput } from './task-draft.types';

export interface RegisteredAiSchema<T = unknown> {
  name: string;
  providerFormatName: string;
  providerJsonSchema: Record<string, unknown>;
  runtimeSchema: JsonSchema;
  /** TypeScript contract documentation only. */
  resultType?: T;
}

const registry = new Map<string, RegisteredAiSchema>();

export function registerAiSchema(entry: RegisteredAiSchema): void {
  if (registry.has(entry.name)) {
    throw new Error(`AI schema "${entry.name}" is already registered.`);
  }
  registry.set(entry.name, entry);
}

export function getRegisteredSchema(name: string): RegisteredAiSchema | undefined {
  return registry.get(name);
}

export function listRegisteredSchemaNames(): string[] {
  return [...registry.keys()];
}

export function toOpenAiJsonSchema(schema: JsonSchema): Record<string, unknown> {
  switch (schema.type) {
    case 'string': {
      const node: Record<string, unknown> = { type: 'string' };
      if (schema.minLength !== undefined) node.minLength = schema.minLength;
      if (schema.maxLength !== undefined) node.maxLength = schema.maxLength;
      return node;
    }
    case 'nullish-string':
      return { type: ['string', 'null'] };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'enum':
      return { type: 'string', enum: [...schema.values] };
    case 'array': {
      const node: Record<string, unknown> = {
        type: 'array',
        items: toOpenAiJsonSchema(schema.items),
        maxItems: schema.maxItems,
      };
      if (schema.minItems !== undefined) node.minItems = schema.minItems;
      return node;
    }
    case 'object': {
      const properties: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(schema.properties)) {
        properties[key] = toOpenAiJsonSchema(field);
      }
      return {
        type: 'object',
        properties,
        required: Object.keys(schema.properties),
        additionalProperties: false,
      };
    }
    default:
      throw new Error('Unsupported JSON Schema fragment for OpenAI structured outputs.');
  }
}

function providerFormatName(name: string): string {
  const converted = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (converted === '' || converted.length > 64) {
    throw new Error('Schema format name is not compatible with the provider.');
  }
  return converted;
}

registerAiSchema({
  name: 'illustrative.note',
  providerFormatName: providerFormatName('illustrative.note'),
  providerJsonSchema: toOpenAiJsonSchema(ILLUSTRATIVE_NOTE_SCHEMA),
  runtimeSchema: ILLUSTRATIVE_NOTE_SCHEMA,
  resultType: undefined as unknown as IllustrativeNote,
});

registerAiSchema({
  name: TASK_DRAFT_SCHEMA_NAME,
  providerFormatName: providerFormatName(TASK_DRAFT_SCHEMA_NAME),
  providerJsonSchema: toOpenAiJsonSchema(TASK_DRAFT_RUNTIME_SCHEMA),
  runtimeSchema: TASK_DRAFT_RUNTIME_SCHEMA,
  resultType: undefined as unknown as TaskDraftModelOutput,
});
