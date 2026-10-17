import 'reflect-metadata';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { LOGIN_THROTTLE, REFRESH_COOKIE, REFRESH_THROTTLE } from './auth.constants';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { clearAuthCookies, setAuthCookies } from './cookies';
import { CsrfGuard } from './csrf.guard';
import { PublicUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard, CsrfGuard)
  @Throttle({ default: { limit: Number(process.env.AUTH_LOGIN_THROTTLE_LIMIT ?? LOGIN_THROTTLE.limit), ttl: LOGIN_THROTTLE.ttl } })
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser }> {
    try {
      const result = await this.auth.login(body);
      setAuthCookies(response, result.accessToken, result.refreshToken);
      return { user: result.user };
    } catch (error) {
      throw mapAuthError(error, 'Invalid login request.');
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard, CsrfGuard)
  @Throttle({ default: { limit: Number(process.env.AUTH_REFRESH_THROTTLE_LIMIT ?? REFRESH_THROTTLE.limit), ttl: REFRESH_THROTTLE.ttl } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser }> {
    try {
      const result = await this.auth.refresh(cookieValue(request, REFRESH_COOKIE));
      setAuthCookies(response, result.accessToken, result.refreshToken);
      return { user: result.user };
    } catch (error) {
      clearAuthCookies(response);
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Authentication required.');
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: true }> {
    await this.auth.logout(cookieValue(request, REFRESH_COOKIE));
    clearAuthCookies(response);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: Request): { user: PublicUser } {
    if (!request.user) throw new UnauthorizedException('Authentication required.');
    return { user: request.user };
  }
}

function cookieValue(request: Request, name: string): string | undefined {
  const value = request.cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function mapAuthError(error: unknown, fallback: string): never {
  if (
    error instanceof UnauthorizedException
    || error instanceof ServiceUnavailableException
    || error instanceof BadRequestException
  ) {
    throw error;
  }
  if (error instanceof Error) {
    throw new BadRequestException(error.message);
  }
  throw new BadRequestException(fallback);
}

Reflect.defineMetadata('design:paramtypes', [AuthService], AuthController);
