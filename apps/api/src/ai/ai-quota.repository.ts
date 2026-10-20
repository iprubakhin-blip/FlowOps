import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { utcCalendarDate } from '../domain/task-dates';
import { DatabaseService } from '../database/database.service';

export interface QuotaReservation {
  allowed: boolean;
  requestCount: number | null;
  usageDate: string;
}

@Injectable()
export class AiQuotaRepository {
  constructor(private readonly database: DatabaseService) {}

  async reserveDailyRequest(
    userId: number,
    dailyLimit: number,
    now = new Date(),
    pool: Pool = this.database.pool,
  ): Promise<QuotaReservation> {
    const usageDate = utcCalendarDate(now);
    const result = await pool.query<{ request_count: number }>(
      `INSERT INTO ai_request_quotas (user_id, usage_date, request_count)
       VALUES ($1, $2::date, 1)
       ON CONFLICT (user_id, usage_date)
       DO UPDATE SET request_count = ai_request_quotas.request_count + 1
       WHERE ai_request_quotas.request_count < $3
       RETURNING request_count`,
      [userId, usageDate, dailyLimit],
    );
    if (result.rowCount === 0) {
      return { allowed: false, requestCount: null, usageDate };
    }
    return { allowed: true, requestCount: result.rows[0].request_count, usageDate };
  }
}

Reflect.defineMetadata('design:paramtypes', [DatabaseService], AiQuotaRepository);
