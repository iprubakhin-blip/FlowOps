import 'reflect-metadata';
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ACCESS_COOKIE, GENERIC_LOGIN_ERROR, REFRESH_COOKIE } from './auth.constants';
import { isAuthConfigured } from './auth.config';
import { PublicUser, toPublicUser } from './auth.types';
import { parseCredentials } from './credentials';
import { verifyPassword, verifyUnknownUserPassword } from './passwords';
import { SessionsRepository } from './sessions.repository';
import { isJwtVerificationError, signAccessToken, verifyAccessToken } from './tokens';
import { UsersRepository } from './users.repository';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
  ) {}

  async login(body: unknown): Promise<{ user: PublicUser; accessToken: string; refreshToken: string }> {
    this.assertConfigured();
    const credentials = parseCredentials(body);
    const user = await this.users.findByEmail(credentials.email);
    if (!user) {
      await verifyUnknownUserPassword(credentials.password);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    const ok = await verifyPassword(user.passwordHash, credentials.password);
    if (!ok) throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(user.id, user.role),
      this.sessions.create(user.id),
    ]);
    return { user: toPublicUser(user), accessToken, refreshToken };
  }

  async refresh(refreshToken: string | undefined): Promise<{ user: PublicUser; accessToken: string; refreshToken: string }> {
    this.assertConfigured();
    if (!refreshToken) throw new UnauthorizedException('Authentication required.');
    const rotated = await this.sessions.rotate(refreshToken);
    if (rotated.status !== 'rotated') {
      throw new UnauthorizedException('Authentication required.');
    }
    const user = await this.users.findById(rotated.userId);
    if (!user) throw new UnauthorizedException('Authentication required.');
    const accessToken = await signAccessToken(user.id, user.role);
    return { user: toPublicUser(user), accessToken, refreshToken: rotated.refreshToken };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.sessions.revokeFamilyByToken(refreshToken);
  }

  async currentUserFromRequest(request: Request): Promise<PublicUser> {
    this.assertConfigured();
    const token = bearerToken(request) ?? request.cookies?.[ACCESS_COOKIE];
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Authentication required.');
    }
    try {
      const claims = await verifyAccessToken(token);
      const user = await this.users.findById(Number(claims.sub));
      if (!user || user.role !== claims.role) {
        throw new UnauthorizedException('Authentication required.');
      }
      return toPublicUser(user);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      if (isJwtVerificationError(error)) {
        throw new UnauthorizedException('Authentication required.');
      }
      throw error;
    }
  }

  private assertConfigured(): void {
    if (!isAuthConfigured()) {
      throw new ServiceUnavailableException('Authentication is not configured.');
    }
  }
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token || undefined;
}

Reflect.defineMetadata('design:paramtypes', [UsersRepository, SessionsRepository], AuthService);
