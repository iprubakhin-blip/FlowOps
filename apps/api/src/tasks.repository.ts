import 'reflect-metadata';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PublicUser } from './auth/auth.types';
import { DatabaseService } from './database/database.service';
import {
  buildTaskListSql,
  PaginatedTasks,
  paginationMeta,
  TaskListQuery,
} from './domain/task-query';
import { NewTask, Task, TaskStatus } from './domain/tasks';

const TASK_COLUMNS = `
  id, title, team, priority, status, owner_id AS "ownerId",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

@Injectable()
export class TasksRepository implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.database.ensureSchema();
  }

  async findPage(query: TaskListQuery, user: PublicUser): Promise<PaginatedTasks> {
    const ownerId = user.role === 'ADMIN' ? undefined : user.id;
    const { whereSql, params, orderSql, limit, offset } = buildTaskListSql(query, ownerId);
    const count = await this.database.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM tasks ${whereSql}`,
      params,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    const result = await this.database.pool.query<Task>(
      `SELECT ${TASK_COLUMNS} FROM tasks ${whereSql} ORDER BY ${orderSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return { items: result.rows, pagination: paginationMeta(total, query.page, query.limit) };
  }

  async create(payload: NewTask, ownerId: number): Promise<Task> {
    const result = await this.database.pool.query<Task>(
      `INSERT INTO tasks (title, team, priority, owner_id) VALUES ($1, $2, $3, $4)
       RETURNING ${TASK_COLUMNS}`,
      [payload.title, payload.team, payload.priority, ownerId],
    );
    return result.rows[0];
  }

  async updateStatus(id: number, status: TaskStatus, user: PublicUser): Promise<Task | null> {
    const result = user.role === 'ADMIN'
      ? await this.database.pool.query<Task>(
        `UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2
         RETURNING ${TASK_COLUMNS}`,
        [status, id],
      )
      : await this.database.pool.query<Task>(
        `UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3
         RETURNING ${TASK_COLUMNS}`,
        [status, id, user.id],
      );
    return result.rows[0] ?? null;
  }
}

Reflect.defineMetadata('design:paramtypes', [DatabaseService], TasksRepository);
