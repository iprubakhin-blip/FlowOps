import { HttpException, HttpStatus } from '@nestjs/common';
import { AiError, type AiErrorCode } from './ai.errors';

const STATUS: Record<AiErrorCode, HttpStatus> = {
  AI_DISABLED: HttpStatus.SERVICE_UNAVAILABLE,
  PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  CANCELLED: HttpStatus.BAD_REQUEST,
  INVALID_PROVIDER_RESPONSE: HttpStatus.BAD_GATEWAY,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INPUT_TOO_LARGE: HttpStatus.BAD_REQUEST,
  CREDENTIALS: HttpStatus.SERVICE_UNAVAILABLE,
  REFUSAL: HttpStatus.BAD_GATEWAY,
  INCOMPLETE: HttpStatus.BAD_GATEWAY,
  CONSENT_REQUIRED: HttpStatus.BAD_REQUEST,
  QUOTA_EXCEEDED: HttpStatus.TOO_MANY_REQUESTS,
};

export function throwAiHttp(error: unknown): never {
  if (error instanceof AiError) {
    throw new HttpException(error.toPublic(), STATUS[error.code]);
  }
  throw error;
}
