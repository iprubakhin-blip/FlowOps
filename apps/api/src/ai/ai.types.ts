import type { JsonSchema } from './ai.schema';

export const AI_PROVIDERS = ['mock', 'openai'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export type AiCompletionStatus = 'completed' | 'incomplete' | 'failed' | 'unknown';

/**
 * Usage/cost contract. Token counts are provider measurements, not invoices.
 * Mock responses never claim provider-reported or billable usage.
 */
export interface AiUsage {
  provider: string;
  model: string;
  /** False unless a real provider actually reported token counts. */
  usageAvailable: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  completionStatus: AiCompletionStatus | null;
  cost: {
    status: 'unavailable' | 'estimated';
    amountUsd: number | null;
    catalogVersion: string | null;
    note: string | null;
  };
}

export const UNAVAILABLE_COST = {
  status: 'unavailable' as const,
  amountUsd: null,
  catalogVersion: null,
  note: null,
};

export const UNAVAILABLE_USAGE = {
  usageAvailable: false,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedInputTokens: null,
  completionStatus: null,
  cost: UNAVAILABLE_COST,
};

export interface AiCompletionRequest {
  systemInstruction: string;
  userInput: string;
  /** Application schema name. Looked up in the registry before a real provider call. */
  schemaName: string;
  /** Provider-side JSON Schema. Required for OpenAI; ignored by mock. */
  jsonSchema?: Record<string, unknown>;
  /** Provider format name (alphanumeric / underscore). */
  formatName?: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

/** Untrusted provider payload. Application code must validate `rawText`. */
export interface AiCompletionResponse {
  rawText: string;
  provider: string;
  model: string;
  usage: AiUsage;
}

export interface AiProvider {
  readonly id: AiProviderId;
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
}

export interface StructuredGenerationInput {
  systemInstruction: string;
  userInput: string;
  schemaName: string;
  schema: JsonSchema;
  signal?: AbortSignal;
  maxOutputTokens?: number;
}

export interface AiStructuredResult<T> {
  output: T;
  schemaName: string;
  usage: AiUsage;
}

export const AI_PROVIDER = Symbol('AiProvider');
