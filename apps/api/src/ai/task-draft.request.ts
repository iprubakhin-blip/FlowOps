import { parseTaskTeam } from '../domain/tasks';
import { ValidationError } from '../http/validation-error';
import { loadAiConfig } from './ai.config';
import {
  MIN_REQUIREMENTS_LENGTH,
  TASK_DRAFT_REQUEST_FORBIDDEN_FIELDS,
  type TaskDraftRequest,
} from './task-draft.types';

const ALLOWED = new Set(['requirements', 'team', 'allowExternalProcessing']);

export function parseTaskDraftRequest(input: unknown): TaskDraftRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('Body must be a JSON object.');
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED.has(key)) {
      throw new ValidationError(`Unsupported field: ${key}.`);
    }
    if ((TASK_DRAFT_REQUEST_FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
      throw new ValidationError(`${key} cannot be set by the client.`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'allowExternalProcessing') && typeof raw.allowExternalProcessing !== 'boolean') {
    throw new ValidationError('allowExternalProcessing must be a boolean.');
  }
  const requirements = typeof raw.requirements === 'string' ? raw.requirements.trim() : '';
  const maxChars = loadAiConfig().maxInputChars;
  if (requirements.length < MIN_REQUIREMENTS_LENGTH) {
    throw new ValidationError(`requirements must be at least ${MIN_REQUIREMENTS_LENGTH} characters.`);
  }
  if (requirements.length > maxChars) {
    throw new ValidationError(`requirements must be at most ${maxChars} characters.`);
  }
  return {
    requirements,
    team: parseTaskTeam(raw.team),
    allowExternalProcessing: raw.allowExternalProcessing === true,
  };
}
