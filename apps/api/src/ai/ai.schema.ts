import { publicAiError } from './ai.errors';

export type JsonSchema =
  | { type: 'string'; minLength?: number; maxLength?: number }
  | { type: 'nullish-string'; minLength?: number; maxLength?: number }
  | { type: 'number' }
  | { type: 'boolean' }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'array'; items: JsonSchema; minItems?: number; maxItems: number }
  | { type: 'object'; properties: Record<string, JsonSchema>; required: readonly string[]; additionalProperties?: boolean };

export function parseProviderJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    throw publicAiError('INVALID_PROVIDER_RESPONSE');
  }
}

export function validateStructured<T>(value: unknown, schema: JsonSchema): T {
  return visit(value, schema) as T;
}

function visit(value: unknown, schema: JsonSchema): unknown {
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') throw publicAiError('VALIDATION_FAILED');
      if (schema.minLength !== undefined && value.length < schema.minLength) throw publicAiError('VALIDATION_FAILED');
      if (schema.maxLength !== undefined && value.length > schema.maxLength) throw publicAiError('VALIDATION_FAILED');
      return value;
    case 'nullish-string':
      if (value === null) return null;
      if (typeof value !== 'string') throw publicAiError('VALIDATION_FAILED');
      if (schema.minLength !== undefined && value.length < schema.minLength) throw publicAiError('VALIDATION_FAILED');
      if (schema.maxLength !== undefined && value.length > schema.maxLength) throw publicAiError('VALIDATION_FAILED');
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw publicAiError('VALIDATION_FAILED');
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') throw publicAiError('VALIDATION_FAILED');
      return value;
    case 'enum':
      if (typeof value !== 'string' || !schema.values.includes(value)) throw publicAiError('VALIDATION_FAILED');
      return value;
    case 'array':
      if (!Array.isArray(value)) throw publicAiError('VALIDATION_FAILED');
      if (schema.minItems !== undefined && value.length < schema.minItems) throw publicAiError('VALIDATION_FAILED');
      if (value.length > schema.maxItems) throw publicAiError('VALIDATION_FAILED');
      return value.map((item) => visit(item, schema.items));
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw publicAiError('VALIDATION_FAILED');
      const record = value as Record<string, unknown>;
      for (const key of schema.required) {
        if (!(key in record)) throw publicAiError('VALIDATION_FAILED');
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(key in schema.properties)) throw publicAiError('VALIDATION_FAILED');
        }
      }
      const output: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(schema.properties)) {
        if (!(key in record)) continue;
        output[key] = visit(record[key], field);
      }
      return output;
    }
    default:
      throw publicAiError('VALIDATION_FAILED');
  }
}
