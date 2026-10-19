import { Response } from 'express';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_TTL_SECONDS,
} from './auth.constants';
import { accessTtlSeconds, cookieSecure } from './auth.config';

const accessCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/api',
};

const refreshCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: REFRESH_TTL_SECONDS * 1000,
};

export function setAuthCookies(response: Response, accessToken: string, refreshToken: string): void {
  const secure = cookieSecure();
  response.cookie(ACCESS_COOKIE, accessToken, {
    ...accessCookieOptions,
    secure,
    maxAge: accessTtlSeconds() * 1000,
  });
  response.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions, secure });
}

export function clearAuthCookies(response: Response): void {
  const secure = cookieSecure();
  response.clearCookie(ACCESS_COOKIE, { ...accessCookieOptions, secure, maxAge: 0 });
  response.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, secure, maxAge: 0 });
}
