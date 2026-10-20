export const AI_ERROR_CODES = [
  'AI_DISABLED',
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'CANCELLED',
  'INVALID_PROVIDER_RESPONSE',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'INPUT_TOO_LARGE',
  'CREDENTIALS',
  'REFUSAL',
  'INCOMPLETE',
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

const PUBLIC_MESSAGES: Record<AiErrorCode, string> = {
  AI_DISABLED: 'AI is disabled.',
  PROVIDER_UNAVAILABLE: 'The AI provider is unavailable.',
  TIMEOUT: 'The AI request timed out.',
  CANCELLED: 'The AI request was cancelled.',
  INVALID_PROVIDER_RESPONSE: 'The AI provider returned an invalid response.',
  VALIDATION_FAILED: 'The AI response failed structured validation.',
  RATE_LIMITED: 'The AI provider rate limit was reached.',
  INPUT_TOO_LARGE: 'The AI request exceeds the configured size limit.',
  CREDENTIALS: 'The AI provider credentials are invalid.',
  REFUSAL: 'The AI provider refused to generate the requested output.',
  INCOMPLETE: 'The AI provider returned an incomplete response.',
};

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message = PUBLIC_MESSAGES[code]) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }

  toPublic(): { error: AiErrorCode; message: string } {
    return { error: this.code, message: PUBLIC_MESSAGES[this.code] };
  }
}

export function publicAiError(code: AiErrorCode): AiError {
  return new AiError(code, PUBLIC_MESSAGES[code]);
}
