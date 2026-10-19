import { BadRequestException } from '@nestjs/common';
import { ValidationError } from './validation-error';

export function throwClientOrInternal(error: unknown): never {
  if (error instanceof BadRequestException) throw error;
  if (error instanceof ValidationError) throw new BadRequestException(error.message);
  throw error;
}
