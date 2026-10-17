import 'reflect-metadata';
import {
  BadRequestException, Body, Controller, Get, NotFoundException,
  Param, ParseIntPipe, Patch, Post, Query,
} from '@nestjs/common';
import { PaginatedTasks, parseListQuery } from './domain/task-query';
import { isStatus, parseCreateTask, Task, TaskStatus } from './domain/tasks';
import { TasksRepository } from './tasks.repository';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksRepository) {}

  @Get()
  async list(@Query() query: Record<string, unknown>): Promise<PaginatedTasks> {
    try {
      return await this.tasks.findPage(parseListQuery(query));
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid query.');
    }
  }

  @Post()
  create(@Body() body: unknown): Promise<Task> {
    try {
      return this.tasks.create(parseCreateTask(body));
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid task.');
    }
  }

  @Patch(':id/status')
  async setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status?: TaskStatus } | null,
  ): Promise<Task> {
    if (!isStatus(body?.status)) throw new BadRequestException('Invalid status.');
    const updated = await this.tasks.updateStatus(id, body.status);
    if (!updated) throw new NotFoundException('Task not found.');
    return updated;
  }
}

Reflect.defineMetadata('design:paramtypes', [TasksRepository], TasksController);
