import 'reflect-metadata';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PublicUser } from './auth/auth.types';
import { DatabaseService } from './database/database.service';
import { UTC_OVERDUE_SQL } from './domain/task-dates';
import {
  buildTaskListSql,
  PaginatedTasks,
  paginationMeta,
  TaskListQuery,
} from './domain/task-query';
import { NewTask, Task, TaskPatch, TaskStatus, TaskSummary } from './domain/tasks';

const TASK_COLUMNS = `
  id, title, team, priority, status, owner_id AS "ownerId",
  description,
  to_char(due_at, 'YYYY-MM-DD') AS "dueDate",
  completed_at AS "completedAt",
  ${UTC_OVERDUE_SQL} AS "isOverdue",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

@Injectable()
export class TasksRepository implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.database.ensureSchema();
  }

  async findPage(query: TaskListQuery, user: PublicUser): Promise<PaginatedTasks> {
    const ownerId = scopeOwner(user);
    const { whereSql, params, orderSql, limit, offset } = buildTaskListSql(query, ownerId);
    const count = await this.database.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM tasks ${whereSql}`,
      params,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    const result = await this.database.pool.query(
      `SELECT ${TASK_COLUMNS} FROM tasks ${whereSql} ORDER BY ${orderSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return { items: result.rows.map(mapTask), pagination: paginationMeta(total, query.page, query.limit) };
  }

  async summarize(user: PublicUser): Promise<TaskSummary> {
    const ownerId = scopeOwner(user);
    const params: number[] = [];
    const where = ownerId === undefined ? '' : (params.push(ownerId), 'WHERE owner_id = $1');
    const result = await this.database.pool.query<TaskSummary>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'todo')::int AS todo,
         COUNT(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress",
         COUNT(*) FILTER (WHERE status = 'done')::int AS done,
         COUNT(*) FILTER (WHERE ${UTC_OVERDUE_SQL})::int AS overdue,
         COUNT(*) FILTER (WHERE status <> 'done' AND priority = 'high')::int AS "highPriorityOpen"
       FROM tasks ${where}`,
      params,
    );
    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      todo: Number(row?.todo ?? 0),
      inProgress: Number(row?.inProgress ?? 0),
      done: Number(row?.done ?? 0),
      overdue: Number(row?.overdue ?? 0),
      highPriorityOpen: Number(row?.highPriorityOpen ?? 0),
    };
  }

  async create(payload: NewTask, ownerId: number): Promise<Task> {
    const result = await this.database.pool.query(
      `INSERT INTO tasks (title, team, priority, owner_id, description, due_at)
       VALUES ($1, $2, $3, $4, $5, $6::date)
       RETURNING ${TASK_COLUMNS}`,
      [payload.title, payload.team, payload.priority, ownerId, payload.description, payload.dueDate],
    );
    return mapTask(result.rows[0]);
  }

  async createMany(payloads: NewTask[], ownerId: number): Promise<Task[]> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const created: Task[] = [];
      for (const payload of payloads) {
        const result = await client.query(
          `INSERT INTO tasks (title, team, priority, owner_id, description, due_at)
           VALUES ($1, $2, $3, $4, $5, $6::date)
           RETURNING ${TASK_COLUMNS}`,
          [payload.title, payload.team, payload.priority, ownerId, payload.description, payload.dueDate],
        );
        created.push(mapTask(result.rows[0]));
      }
      await client.query('COMMIT');
      return created;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The original error is the one callers should see.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: number, patch: TaskPatch, user: PublicUser): Promise<Task | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown): void => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };
    if (patch.title !== undefined) add('title', patch.title);
    if (patch.team !== undefined) add('team', patch.team);
    if (patch.priority !== undefined) add('priority', patch.priority);
    if (patch.description !== undefined) add('description', patch.description);
    if (patch.dueDate !== undefined) {
      params.push(patch.dueDate);
      assignments.push(`due_at = $${params.length}::date`);
    }
    assignments.push('updated_at = NOW()');
    params.push(id);
    const idPlaceholder = `$${params.length}`;
    const ownerFilter = user.role === 'ADMIN' ? '' : (params.push(user.id), ` AND owner_id = $${params.length}`);
    const result = await this.database.pool.query(
      `UPDATE tasks SET ${assignments.join(', ')} WHERE id = ${idPlaceholder}${ownerFilter}
       RETURNING ${TASK_COLUMNS}`,
      params,
    );
    return result.rows[0] ? mapTask(result.rows[0]) : null;
  }

  async updateStatus(id: number, status: TaskStatus, user: PublicUser): Promise<Task | null> {
    const completionSql = `
      completed_at = CASE
        WHEN $1::text = 'done' AND status <> 'done' THEN NOW()
        WHEN $1::text <> 'done' THEN NULL
        ELSE completed_at
      END`;
    const result = user.role === 'ADMIN'
      ? await this.database.pool.query(
        `UPDATE tasks SET status = $1::varchar(20), ${completionSql}, updated_at = NOW() WHERE id = $2
         RETURNING ${TASK_COLUMNS}`,
        [status, id],
      )
      : await this.database.pool.query(
        `UPDATE tasks SET status = $1::varchar(20), ${completionSql}, updated_at = NOW() WHERE id = $2 AND owner_id = $3
         RETURNING ${TASK_COLUMNS}`,
        [status, id, user.id],
      );
    return result.rows[0] ? mapTask(result.rows[0]) : null;
  }
}

function scopeOwner(user: PublicUser): number | undefined {
  return user.role === 'ADMIN' ? undefined : user.id;
}

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: Number(row.id),
    title: String(row.title),
    team: String(row.team),
    priority: row.priority as Task['priority'],
    status: row.status as Task['status'],
    ownerId: Number(row.ownerId),
    description: row.description == null ? null : String(row.description),
    dueDate: row.dueDate == null ? null : String(row.dueDate),
    completedAt: toIso(row.completedAt),
    isOverdue: Boolean(row.isOverdue),
    createdAt: toIso(row.createdAt) ?? '',
    updatedAt: toIso(row.updatedAt) ?? '',
  };
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return null;
}

Reflect.defineMetadata('design:paramtypes', [DatabaseService], TasksRepository);
