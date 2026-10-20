import type { AiConfig } from './ai.config';

export interface AiSafeguards {
  maxInputChars: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  maxRequestsPerUserDay: number;
  retries: 0;
  fanOut: 0;
  dailyLimitStorage: 'config-only';
  notes: string[];
}

export function describeAiSafeguards(config: AiConfig): AiSafeguards {
  return {
    maxInputChars: config.maxInputChars,
    maxOutputTokens: config.maxOutputTokens,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRequestsPerUserDay: config.maxRequestsPerUserDay,
    retries: 0,
    fanOut: 0,
    dailyLimitStorage: 'config-only',
    notes: [
      'max_output_tokens and estimated USD are not a guaranteed spending cap.',
      'AI_MAX_REQUESTS_PER_USER_DAY is configuration for a future durable counter. It is not enforced in memory and is not multi-instance safe.',
      'Unknown model prices make cost estimates unavailable rather than inventing a number.',
    ],
  };
}

export function clampOutputTokens(requested: number | undefined, configuredMax: number): number {
  return Math.min(requested ?? configuredMax, configuredMax);
}
