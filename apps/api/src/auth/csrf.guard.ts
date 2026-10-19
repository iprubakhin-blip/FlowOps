import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { csrfDecision, csrfFromHeaders } from './csrf';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (csrfDecision(csrfFromHeaders(request.method, request.headers as Record<string, unknown>)) === 'allow') {
      return true;
    }
    throw new ForbiddenException('Request rejected by CSRF protection.');
  }
}
