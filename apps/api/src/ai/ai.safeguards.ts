import type { AiConfig } from './ai.config';

export interface AiSafeguards {
  maxInputChars: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  maxRequestsPerUserDay: number;
  retries: 0;
  fanOut: 0;
  dailyLimitStorage: 'postgresql';
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
    dailyLimitStorage: 'postgresql',
    notes: [
      'max_output_tokens and estimated USD are not a guaranteed spending cap.',
      'AI_MAX_REQUESTS_PER_USER_DAY is enforced per authenticated user per UTC date in PostgreSQL. Failed provider attempts still consume a slot. This is not a dollar cap.',
      'Unknown model prices make cost estimates unavailable rather than inventing a number.',
    ],
  };
}

export function clampOutputTokens(requested: number | undefined, configuredMax: number): number {
  return Math.min(requested ?? configuredMax, configuredMax);
}
