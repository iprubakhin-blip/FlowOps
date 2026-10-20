import type { JsonSchema } from './ai.schema';

/**
 * Test-only illustrative schema. Not the M3.3 task-draft contract.
 * `notes` is required (empty array allowed) so the OpenAI strict JSON Schema
 * (`additionalProperties: false` + every property required) matches local validation.
 */
export const ILLUSTRATIVE_NOTE_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['title', 'priority', 'notes'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    priority: { type: 'enum', values: ['low', 'medium', 'high'] },
    notes: { type: 'array', minItems: 0, maxItems: 3, items: { type: 'string', maxLength: 40 } },
  },
};

export const VALID_ILLUSTRATIVE_NOTE = {
  title: 'Clarify delivery window',
  priority: 'high' as const,
  notes: ['Check with client'],
};

export type IllustrativeNote = typeof VALID_ILLUSTRATIVE_NOTE;
