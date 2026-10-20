import { MAX_TEAM_LENGTH, MIN_TEAM_LENGTH } from '../models/task';
import { validateTaskDraft } from '../task-payloads';
import { MIN_REQUIREMENTS_LENGTH, type AiDraftResponse, type BulkCreateRequest, type LocalAiDraft } from './ai.models';

let nextLocalId = 1;

export function newLocalId(): string {
  const id = `local-${nextLocalId}`;
  nextLocalId += 1;
  return id;
}

export function emptyLocalDraft(): LocalAiDraft {
  return { localId: newLocalId(), title: '', description: '', priority: 'medium', dueDate: '' };
}

export function draftsFromResponse(response: AiDraftResponse): LocalAiDraft[] {
  return response.tasks.map((task) => ({
    localId: newLocalId(),
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueDate: task.dueDate ?? '',
  }));
}

export function validateRequirements(requirements: string, maxChars: number): string | null {
  const text = requirements.trim();
  if (text.length < MIN_REQUIREMENTS_LENGTH) {
    return `Requirements must be at least ${MIN_REQUIREMENTS_LENGTH} characters.`;
  }
  if (text.length > maxChars) {
    return `Requirements must be at most ${maxChars} characters.`;
  }
  return null;
}

export function validateTeam(team: string): string | null {
  const value = team.trim();
  if (value.length < MIN_TEAM_LENGTH || value.length > MAX_TEAM_LENGTH) {
    return `Team must be between ${MIN_TEAM_LENGTH} and ${MAX_TEAM_LENGTH} characters.`;
  }
  return null;
}

export function draftValidationError(team: string, draft: LocalAiDraft): string | null {
  return validateTaskDraft({
    title: draft.title,
    team,
    priority: draft.priority,
    description: draft.description,
    dueDate: draft.dueDate,
  });
}

export function firstInvalidDraftError(team: string, drafts: LocalAiDraft[]): string | null {
  if (drafts.length < 1) return 'Add at least one draft before creating tasks.';
  for (const draft of drafts) {
    const error = draftValidationError(team, draft);
    if (error) return error;
  }
  return null;
}

export function buildGenerateBody(
  requirements: string,
  team: string,
  allowExternalProcessing: boolean,
): { requirements: string; team: string; allowExternalProcessing: boolean } {
  return {
    requirements: requirements.trim(),
    team: team.trim(),
    allowExternalProcessing,
  };
}

export function buildBulkBody(team: string, drafts: LocalAiDraft[]): BulkCreateRequest | { error: string } {
  const error = firstInvalidDraftError(team, drafts);
  if (error) return { error };
  return {
    team: team.trim(),
    tasks: drafts.map((draft) => ({
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      priority: draft.priority,
      dueDate: draft.dueDate.trim() || null,
    })),
  };
}
