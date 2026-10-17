import 'reflect-metadata';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from './database/database.service';
import {
  buildTaskListSql,
  PaginatedTasks,
  paginationMeta,
  TaskListQuery,
} from './domain/task-query';
import { NewTask, Task, TaskStatus } from './domain/tasks';

function isTestDatabase(): boolean {
  return (process.env.DATABASE_URL ?? '').includes('flowops_test');
}

const TASK_COLUMNS = `
  id, title, team, priority, status,
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

@Injectable()
export class TasksRepository implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.database.ensureSchema();
    const existing = await this.database.pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM tasks');
    if (!isTestDatabase() && Number(existing.rows[0]?.count) === 0) {
      const examples: NewTask[] = [
        { title: 'Review API gateway error logs', team: 'Platform', priority: 'high' },
        { title: 'Refactor customer onboarding form', team: 'Frontend', priority: 'medium' },
        { title: 'Write integration tests for task API', team: 'Backend', priority: 'high' },
        { title: 'Improve analytics table filters', team: 'Frontend', priority: 'low' },
        { title: 'Document local setup and releases', team: 'Platform', priority: 'medium' },
      ];
      for (const item of examples) await this.create(item);
      await this.database.pool.query("UPDATE tasks SET status = 'in_progress' WHERE title LIKE 'Refactor%'");
      await this.database.pool.query("UPDATE tasks SET status = 'done' WHERE title LIKE 'Document%'");
    }
  }

  async findPage(query: TaskListQuery): Promise<PaginatedTasks> {
    const { whereSql, params, orderSql, limit, offset } = buildTaskListSql(query);
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

  async create(payload: NewTask): Promise<Task> {
    const result = await this.database.pool.query<Task>(
      `INSERT INTO tasks (title, team, priority) VALUES ($1, $2, $3)
       RETURNING ${TASK_COLUMNS}`,
      [payload.title, payload.team, payload.priority],
    );
    return result.rows[0];
  }

  async updateStatus(id: number, status: TaskStatus): Promise<Task | null> {
    const result = await this.database.pool.query<Task>(
      `UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2
       RETURNING ${TASK_COLUMNS}`,
      [status, id],
    );
    return result.rows[0] ?? null;
  }
}

Reflect.defineMetadata('design:paramtypes', [DatabaseService], TasksRepository);
