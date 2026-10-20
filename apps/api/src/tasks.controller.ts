import 'reflect-metadata';
import {
  BadRequestException, Body, Controller, Get, NotFoundException,
  Param, ParseIntPipe, Patch, Post, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from './auth/auth.guard';
import { PublicUser } from './auth/auth.types';
import { CsrfGuard } from './auth/csrf.guard';
import { PaginatedTasks } from './domain/task-query';
import { parseListQuery } from './domain/task-query';
import { isStatus, parseCreateTask, parsePatchTask, Task, TaskStatus, TaskSummary } from './domain/tasks';
import { throwClientOrInternal } from './http/client-error';
import { TasksRepository } from './tasks.repository';

@UseGuards(AuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksRepository) {}

  @Get('summary')
  async summary(@Req() request: Request): Promise<TaskSummary> {
    return this.tasks.summarize(requireUser(request));
  }

  @Get()
  async list(@Req() request: Request, @Query() query: Record<string, unknown>): Promise<PaginatedTasks> {
    const user = requireUser(request);
    try {
      return await this.tasks.findPage(parseListQuery(query), user);
    } catch (error) {
      throwClientOrInternal(error);
    }
  }

  @Post()
  @UseGuards(CsrfGuard)
  create(@Req() request: Request, @Body() body: unknown): Promise<Task> {
    const ownerId = requireUser(request).id;
    try {
      return this.tasks.create(parseCreateTask(body), ownerId);
    } catch (error) {
      throwClientOrInternal(error);
    }
  }

  @Patch(':id/status')
  @UseGuards(CsrfGuard)
  async setStatus(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status?: TaskStatus } | null,
  ): Promise<Task> {
    if (!isStatus(body?.status)) throw new BadRequestException('Invalid status.');
    const updated = await this.tasks.updateStatus(id, body.status, requireUser(request));
    if (!updated) throw new NotFoundException('Task not found.');
    return updated;
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  async update(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<Task> {
    try {
      const updated = await this.tasks.update(id, parsePatchTask(body), requireUser(request));
      if (!updated) throw new NotFoundException('Task not found.');
      return updated;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throwClientOrInternal(error);
    }
  }
}

function requireUser(request: Request): PublicUser {
  if (!request.user) throw new UnauthorizedException('Authentication required.');
  return request.user;
}

Reflect.defineMetadata('design:paramtypes', [TasksRepository], TasksController);
