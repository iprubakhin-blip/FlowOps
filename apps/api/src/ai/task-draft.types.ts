import type { TaskPriority } from '../domain/tasks';
import type { AiUsage } from './ai.types';

export const TASK_DRAFT_SCHEMA_NAME = 'task.drafts.v1';
export const MAX_GENERATED_TASKS = 10;
export const MIN_GENERATED_TASKS = 1;
export const MAX_DRAFT_WARNINGS = 8;
export const MAX_WARNING_LENGTH = 200;
export const MIN_REQUIREMENTS_LENGTH = 10;

export const TASK_DRAFT_REQUEST_FORBIDDEN_FIELDS = [
  'id',
  'ownerId',
  'owner_id',
  'userId',
  'apiKey',
  'completedAt',
  'createdAt',
  'updatedAt',
  'status',
] as const;

export const TASK_DRAFT_MODEL_FORBIDDEN_FIELDS = [
  ...TASK_DRAFT_REQUEST_FORBIDDEN_FIELDS,
  'team',
  'isOverdue',
] as const;

export interface TaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string | null;
  team: string;
  status: 'todo';
}

export interface TaskDraftModelOutput {
  tasks: Array<{
    title: string;
    description: string;
    priority: TaskPriority;
    dueDate: string | null;
  }>;
  warnings: string[];
}

export interface TaskDraftRequest {
  requirements: string;
  team: string;
  allowExternalProcessing: boolean;
}

export interface TaskDraftResponse {
  team: string;
  tasks: TaskDraft[];
  warnings: string[];
  persisted: false;
  provider: string;
  model: string;
  usage: AiUsage;
  consent: {
    required: boolean;
    granted: boolean;
    note: string;
  };
}
