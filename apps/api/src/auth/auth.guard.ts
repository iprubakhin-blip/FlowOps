import 'reflect-metadata';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    request.user = await this.auth.currentUserFromRequest(request);
    return true;
  }
}

Reflect.defineMetadata('design:paramtypes', [AuthService], AuthGuard);
