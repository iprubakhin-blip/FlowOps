import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { parseCalendarDate } from '../domain/task-dates';
import { isPriority, parseTaskTitle } from '../domain/tasks';
import { ValidationError } from '../http/validation-error';
import { loadAiConfig } from './ai.config';
import { publicAiError } from './ai.errors';
import { AiService } from './ai.service';
import { AiQuotaRepository } from './ai-quota.repository';
import { TASK_DRAFT_SYSTEM_INSTRUCTION } from './task-draft.prompt';
import { TASK_DRAFT_RUNTIME_SCHEMA } from './task-draft.schema';
import {
  MAX_GENERATED_TASKS,
  TASK_DRAFT_MODEL_FORBIDDEN_FIELDS,
  TASK_DRAFT_SCHEMA_NAME,
  type TaskDraft,
  type TaskDraftModelOutput,
  type TaskDraftRequest,
  type TaskDraftResponse,
} from './task-draft.types';

@Injectable()
export class TaskDraftGenerationService {
  constructor(
    private readonly ai: AiService,
    private readonly quotas: AiQuotaRepository,
  ) {}

  async generate(userId: number, request: TaskDraftRequest, now = new Date()): Promise<TaskDraftResponse> {
    const config = loadAiConfig();
    if (!config.enabled) throw publicAiError('AI_DISABLED');

    const external = config.provider === 'openai';
    if (external && request.allowExternalProcessing !== true) {
      throw publicAiError('CONSENT_REQUIRED');
    }

    const reservation = await this.quotas.reserveDailyRequest(userId, config.maxRequestsPerUserDay, now);
    if (!reservation.allowed) throw publicAiError('QUOTA_EXCEEDED');

    const result = await this.ai.generateStructured<TaskDraftModelOutput>({
      systemInstruction: TASK_DRAFT_SYSTEM_INSTRUCTION,
      userInput: request.requirements,
      schemaName: TASK_DRAFT_SCHEMA_NAME,
      schema: TASK_DRAFT_RUNTIME_SCHEMA,
      maxOutputTokens: Math.min(1024, config.maxOutputTokens),
    });

    return {
      team: request.team,
      tasks: result.output.tasks.map((task) => toSafeDraft(task, request.team)),
      warnings: result.output.warnings,
      persisted: false,
      provider: result.usage.provider,
      model: result.usage.model,
      usage: result.usage,
      consent: {
        required: external,
        granted: request.allowExternalProcessing,
        note: external
          ? 'Submitted requirements are sent to the configured external AI provider. This flag is request-level authorization, not a full privacy compliance programme.'
          : 'Mock generation stays on this server and does not send requirements to an external provider.',
      },
    };
  }
}

const MODEL_TASK_FIELDS = new Set(['title', 'description', 'priority', 'dueDate']);

function toSafeDraft(task: TaskDraftModelOutput['tasks'][number], team: string): TaskDraft {
  const record = task as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if ((TASK_DRAFT_MODEL_FORBIDDEN_FIELDS as readonly string[]).includes(key) || !MODEL_TASK_FIELDS.has(key)) {
      throw new ValidationError(`${key} cannot be set by the model.`);
    }
  }
  if (!isPriority(task.priority)) {
    throw publicAiError('VALIDATION_FAILED');
  }
  const description = task.description.trim();
  if (description.length === 0 || description.length > 5000) {
    throw publicAiError('VALIDATION_FAILED');
  }
  return {
    title: parseTaskTitle(task.title),
    description,
    priority: task.priority,
    dueDate: parseCalendarDate(task.dueDate),
    team,
    status: 'todo',
  };
}

export const MAX_DRAFT_BATCH = MAX_GENERATED_TASKS;

Reflect.defineMetadata('design:paramtypes', [AiService, AiQuotaRepository], TaskDraftGenerationService);
