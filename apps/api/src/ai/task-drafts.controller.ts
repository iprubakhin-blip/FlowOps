import 'reflect-metadata';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PublicUser } from '../auth/auth.types';
import { CsrfGuard } from '../auth/csrf.guard';
import { throwClientOrInternal } from '../http/client-error';
import { AiError } from './ai.errors';
import { throwAiHttp } from './ai.http';
import { currentAiCapabilities, type AiCapabilities } from './ai.capabilities';
import { parseTaskDraftRequest } from './task-draft.request';
import { TaskDraftGenerationService } from './task-draft.generation';
import type { TaskDraftResponse } from './task-draft.types';

@Controller('ai')
@UseGuards(AuthGuard, ThrottlerGuard)
export class TaskDraftsController {
  constructor(private readonly drafts: TaskDraftGenerationService) {}

  @Get('capabilities')
  capabilities(@Req() request: Request): AiCapabilities {
    requireUser(request);
    return currentAiCapabilities();
  }

  @Post('task-drafts')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(@Req() request: Request, @Body() body: unknown): Promise<TaskDraftResponse> {
    const user = requireUser(request);
    try {
      const parsed = parseTaskDraftRequest(body);
      return await this.drafts.generate(user.id, parsed);
    } catch (error) {
      if (error instanceof AiError) throwAiHttp(error);
      throwClientOrInternal(error);
    }
  }
}

function requireUser(request: Request): PublicUser {
  if (!request.user) throw new UnauthorizedException('Authentication required.');
  return request.user;
}

Reflect.defineMetadata('design:paramtypes', [TaskDraftGenerationService], TaskDraftsController);
