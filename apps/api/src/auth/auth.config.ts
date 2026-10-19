import { ACCESS_TTL_SECONDS, DEFAULT_WEB_ORIGIN, LOGIN_THROTTLE, MIN_JWT_SECRET_LENGTH, REFRESH_THROTTLE } from './auth.constants';

export type AppMode = 'production' | 'development' | 'test';

const ARGON2_PROD_MEMORY = 19_456;
const ARGON2_PROD_TIME = 2;
const ARGON2_FLOOR_MEMORY = 1_024;
const ARGON2_FLOOR_TIME = 1;
const LOGIN_THROTTLE_PROD_MAX = 30;
const REFRESH_THROTTLE_PROD_MAX = 60;
const THROTTLE_ABS_MAX = 10_000;

export function appMode(): AppMode {
  const env = process.env.NODE_ENV;
  if (env === 'production' || env === 'development' || env === 'test') return env;
  throw new Error('Refusing to start: NODE_ENV must be production, development, or test.');
}

export function isProduction(): boolean {
  return appMode() === 'production';
}

export function cookieSecure(): boolean {
  const flag = process.env.AUTH_COOKIE_SECURE;
  if (flag === 'true') return true;
  if (flag === 'false') {
    if (isProduction()) {
      throw new Error(
        'Refusing to start: AUTH_COOKIE_SECURE=false is not allowed when NODE_ENV=production. Serve HTTPS and set AUTH_COOKIE_SECURE=true.',
      );
    }
    return false;
  }
  if (flag !== undefined && flag !== '') {
    throw new Error('AUTH_COOKIE_SECURE must be true, false, or omitted.');
  }
  return isProduction();
}

export function assertSecurityConfig(): void {
  const mode = appMode();
  if (mode === 'production') {
    const flag = process.env.AUTH_COOKIE_SECURE;
    if (flag === 'false') {
      throw new Error(
        'Refusing to start: AUTH_COOKIE_SECURE=false is not allowed when NODE_ENV=production. Serve HTTPS and set AUTH_COOKIE_SECURE=true.',
      );
    }
    if (flag !== undefined && flag !== '' && flag !== 'true') {
      throw new Error('Refusing to start: AUTH_COOKIE_SECURE must be true or false.');
    }
    if (!cookieSecure()) {
      throw new Error('Refusing to start: authentication cookies must be Secure in production.');
    }
    if (!isAuthConfigured()) {
      throw new Error('Refusing to start: JWT_SECRET is required in production (minimum 32 characters).');
    }
    if (process.env.AUTH_ACCESS_TTL_SECONDS) {
      throw new Error('Refusing to start: AUTH_ACCESS_TTL_SECONDS is not allowed when NODE_ENV=production.');
    }
  } else {
    cookieSecure();
  }
  accessTtlSeconds();
  argon2MemoryCost();
  argon2TimeCost();
  loginThrottleLimit();
  refreshThrottleLimit();
}

/** @deprecated Use assertSecurityConfig. */
export const assertProductionAuthConfig = assertSecurityConfig;

export function accessTtlSeconds(): number {
  const raw = process.env.AUTH_ACCESS_TTL_SECONDS;
  if (raw === undefined || raw === '') return ACCESS_TTL_SECONDS;
  if (isProduction()) {
    throw new Error('AUTH_ACCESS_TTL_SECONDS is not allowed when NODE_ENV=production.');
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error('AUTH_ACCESS_TTL_SECONDS must be a positive integer.');
  }
  return Number(raw);
}

export function argon2MemoryCost(): number {
  return readBoundedInt(
    process.env.AUTH_ARGON2_MEMORY,
    ARGON2_PROD_MEMORY,
    isProduction() ? ARGON2_PROD_MEMORY : ARGON2_FLOOR_MEMORY,
    1_048_576,
    'AUTH_ARGON2_MEMORY',
  );
}

export function argon2TimeCost(): number {
  return readBoundedInt(
    process.env.AUTH_ARGON2_TIME,
    ARGON2_PROD_TIME,
    isProduction() ? ARGON2_PROD_TIME : ARGON2_FLOOR_TIME,
    16,
    'AUTH_ARGON2_TIME',
  );
}

export function loginThrottleLimit(): number {
  return readBoundedInt(
    process.env.AUTH_LOGIN_THROTTLE_LIMIT,
    LOGIN_THROTTLE.limit,
    1,
    isProduction() ? LOGIN_THROTTLE_PROD_MAX : THROTTLE_ABS_MAX,
    'AUTH_LOGIN_THROTTLE_LIMIT',
  );
}

export function refreshThrottleLimit(): number {
  return readBoundedInt(
    process.env.AUTH_REFRESH_THROTTLE_LIMIT,
    REFRESH_THROTTLE.limit,
    1,
    isProduction() ? REFRESH_THROTTLE_PROD_MAX : THROTTLE_ABS_MAX,
    'AUTH_REFRESH_THROTTLE_LIMIT',
  );
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
  try {
    return isIsolatedTestDatabaseName(databaseNameFromUrl(url));
  } catch {
    return false;
  }
}

export function isIsolatedTestDatabaseName(name: string): boolean {
  return /^flowops_test(?:_[a-z0-9]+)*$/.test(name);
}

function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url.replace(/^postgresql:/, 'http:'));
  return parsed.pathname.replace(/^\//, '').split('/')[0] ?? '';
}

function readBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}
