import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import {
  ACCESS_TTL_SECONDS,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from './auth.constants';
import { jwtSecretBytes } from './auth.config';
import { UserRole } from './auth.types';

export interface AccessClaims {
  sub: string;
  role: UserRole;
  jti: string;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function signAccessToken(userId: number, role: UserRole): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .sign(jwtSecretBytes());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, jwtSecretBytes(), {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  const role = payload.role;
  if (typeof payload.sub !== 'string' || (role !== 'ADMIN' && role !== 'MEMBER') || typeof payload.jti !== 'string') {
    throw new Error('Access token claims are invalid.');
  }
  return { sub: payload.sub, role, jti: payload.jti };
}

export function isJwtVerificationError(error: unknown): boolean {
  return error instanceof joseErrors.JOSEError || (error instanceof Error && /token|JWT|secret/i.test(error.message));
}
