import { DEFAULT_WEB_ORIGIN, MIN_JWT_SECRET_LENGTH } from './auth.constants';

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function cookieSecure(): boolean {
  if (process.env.AUTH_COOKIE_SECURE === 'true') return true;
  if (process.env.AUTH_COOKIE_SECURE === 'false') return false;
  return isProduction();
}

export function trustedWebOrigins(): string[] {
  const configured = process.env.AUTH_WEB_ORIGIN?.split(',').map((value) => value.trim()).filter(Boolean);
  return configured && configured.length > 0 ? configured : [DEFAULT_WEB_ORIGIN];
}

export function jwtSecretBytes(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? '';
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error('JWT_SECRET is missing or shorter than 32 characters.');
  }
  return new TextEncoder().encode(secret);
}

export function isAuthConfigured(): boolean {
  return (process.env.JWT_SECRET ?? '').length >= MIN_JWT_SECRET_LENGTH;
}

export function isTestDatabaseUrl(url = process.env.DATABASE_URL ?? ''): boolean {
  return url.includes('flowops_test');
}
