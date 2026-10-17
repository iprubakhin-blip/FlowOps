import { Credentials } from './auth.types';

export const MAX_EMAIL_LENGTH = 254;
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function parseCredentials(input: unknown): Credentials {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Body must be a JSON object.');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.email !== 'string') {
    throw new Error('Email is invalid.');
  }
  const email = normalizeEmail(raw.email);
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new Error('Email is invalid.');
  }
  if (typeof raw.password !== 'string') {
    throw new Error('Password is invalid.');
  }
  if (raw.password.length < MIN_PASSWORD_LENGTH || raw.password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Password is invalid.');
  }
  return { email, password: raw.password };
}
