import { BadRequestException } from '@nestjs/common';
import assert from 'node:assert/strict';
import test from 'node:test';
import { throwClientOrInternal } from './client-error';
import { ValidationError } from './validation-error';

test('validation errors become HTTP 400 with the public message', () => {
  assert.throws(
    () => throwClientOrInternal(new ValidationError('Title must be between 3 and 120 characters.')),
    (error: unknown) => error instanceof BadRequestException
      && error.message === 'Title must be between 3 and 120 characters.',
  );
});

test('unexpected errors are not converted into HTTP 400', () => {
  assert.throws(
    () => throwClientOrInternal(new Error('ECONNREFUSED 127.0.0.1:5432')),
    (error: unknown) => error instanceof Error
      && error.message === 'ECONNREFUSED 127.0.0.1:5432'
      && !(error instanceof BadRequestException),
  );
});
