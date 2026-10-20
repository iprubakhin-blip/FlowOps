import { PRIORITIES } from '../domain/tasks';
import type { JsonSchema } from './ai.schema';
import {
  MAX_DRAFT_WARNINGS,
  MAX_GENERATED_TASKS,
  MAX_WARNING_LENGTH,
  MIN_GENERATED_TASKS,
} from './task-draft.types';

export const TASK_DRAFT_RUNTIME_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['tasks', 'warnings'],
  additionalProperties: false,
  properties: {
    tasks: {
      type: 'array',
      minItems: MIN_GENERATED_TASKS,
      maxItems: MAX_GENERATED_TASKS,
      items: {
        type: 'object',
        required: ['title', 'description', 'priority', 'dueDate'],
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 3, maxLength: 120 },
          description: { type: 'string', minLength: 1, maxLength: 5000 },
          priority: { type: 'enum', values: PRIORITIES },
          dueDate: { type: 'nullish-string', minLength: 10, maxLength: 10 },
        },
      },
    },
    warnings: {
      type: 'array',
      minItems: 0,
      maxItems: MAX_DRAFT_WARNINGS,
      items: { type: 'string', minLength: 1, maxLength: MAX_WARNING_LENGTH },
    },
  },
};
