import {
  EditTask,
  MAX_DESCRIPTION_LENGTH,
  MAX_TEAM_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_TEAM_LENGTH,
  MIN_TITLE_LENGTH,
  NewTask,
  Priority,
  Task,
} from './models/task';
import { isCalendarDate } from './task-dates';

export interface TaskDraft {
  title: string;
  team: string;
  priority: Priority;
  description: string;
  dueDate: string;
}

export function taskToDraft(task: Task): TaskDraft {
  return {
    title: task.title,
    team: task.team,
    priority: task.priority,
    description: task.description ?? '',
    dueDate: task.dueDate ?? '',
  };
}

export function validateTaskDraft(draft: TaskDraft): string | null {
  const title = draft.title.trim();
  const team = draft.team.trim();
  if (title.length < MIN_TITLE_LENGTH || title.length > MAX_TITLE_LENGTH) {
    return `Title must be between ${MIN_TITLE_LENGTH} and ${MAX_TITLE_LENGTH} characters.`;
  }
  if (team.length < MIN_TEAM_LENGTH || team.length > MAX_TEAM_LENGTH) {
    return `Team must be between ${MIN_TEAM_LENGTH} and ${MAX_TEAM_LENGTH} characters.`;
  }
  if (draft.description.trim().length > MAX_DESCRIPTION_LENGTH) {
    return `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`;
  }
  const due = draft.dueDate.trim();
  if (due && !isCalendarDate(due)) {
    return 'dueDate must be a real calendar date in YYYY-MM-DD format.';
  }
  return null;
}

export function buildCreateBody(draft: TaskDraft): NewTask | { error: string } {
  const error = validateTaskDraft(draft);
  if (error) return { error };
  const body: NewTask = {
    title: draft.title.trim(),
    team: draft.team.trim(),
    priority: draft.priority,
  };
  const description = draft.description.trim();
  if (description) body.description = description;
  const dueDate = draft.dueDate.trim();
  if (dueDate) body.dueDate = dueDate;
  return body;
}

export function buildEditPatch(original: Task, draft: TaskDraft): EditTask | { error: string } | { empty: true } {
  const error = validateTaskDraft(draft);
  if (error) return { error };
  const patch: EditTask = {};
  const title = draft.title.trim();
  const team = draft.team.trim();
  const description = draft.description.trim() || null;
  const dueDate = draft.dueDate.trim() || null;
  if (title !== original.title) patch.title = title;
  if (team !== original.team) patch.team = team;
  if (draft.priority !== original.priority) patch.priority = draft.priority;
  if (description !== (original.description ?? null)) patch.description = description;
  if (dueDate !== (original.dueDate ?? null)) patch.dueDate = dueDate;
  if (Object.keys(patch).length === 0) return { empty: true };
  return patch;
}
