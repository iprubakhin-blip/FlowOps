import { Priority } from '../models/task';

export interface AiCapabilities {
  enabled: boolean;
  provider: 'mock' | 'openai';
  externalProcessingRequired: boolean;
  maxRequirementsChars: number;
  maxDrafts: number;
}

export interface AiUsageView {
  provider: string;
  model: string;
  usageAvailable: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  cost: {
    status: 'unavailable' | 'estimated';
    amountUsd: number | null;
    catalogVersion: string | null;
    note: string | null;
  };
}

export interface AiDraftResponse {
  team: string;
  tasks: Array<{
    title: string;
    description: string;
    priority: Priority;
    dueDate: string | null;
    team: string;
    status: 'todo';
  }>;
  warnings: string[];
  persisted: false;
  provider: string;
  model: string;
  usage: AiUsageView;
  consent: {
    required: boolean;
    granted: boolean;
    note: string;
  };
}

export interface LocalAiDraft {
  localId: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
}

export interface BulkCreateRequest {
  team: string;
  tasks: Array<{
    title: string;
    description: string | null;
    priority: Priority;
    dueDate: string | null;
  }>;
}

export interface BulkCreateResponse {
  items: unknown[];
  createdCount: number;
}

export const MIN_REQUIREMENTS_LENGTH = 10;
export const SUGGESTED_TEAMS = ['Frontend', 'Platform', 'Backend', 'QA'] as const;
