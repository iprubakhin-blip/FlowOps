import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { REFRESH_TTL_SECONDS } from './auth.constants';
import { hashRefreshToken, newRefreshToken } from './tokens';

export type RotateResult =
  | { status: 'rotated'; userId: number; familyId: string; refreshToken: string }
  | { status: 'invalid' }
  | { status: 'reuse'; familyId: string };

/** Namespace for transaction-scoped per-family advisory locks. Distinct from MIGRATION_LOCK_KEY. */
export const REFRESH_FAMILY_LOCK_NS = 0xF10607;

export async function lockRefreshFamily(client: PoolClient, familyId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2::text))', [REFRESH_FAMILY_LOCK_NS, familyId]);
}

@Injectable()
export class SessionsRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(userId: number): Promise<string> {
    const refreshToken = newRefreshToken();
    await this.database.pool.query(
      `INSERT INTO refresh_sessions (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'))`,
      [userId, randomUUID(), hashRefreshToken(refreshToken), REFRESH_TTL_SECONDS],
    );
    return refreshToken;
  }

  async rotate(presentedToken: string): Promise<RotateResult> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const hash = hashRefreshToken(presentedToken);
      const family = await client.query<{ familyId: string }>(
        `SELECT family_id AS "familyId" FROM refresh_sessions WHERE token_hash = $1`,
        [hash],
      );
      if (!family.rows[0]) {
        await client.query('ROLLBACK');
        return { status: 'invalid' };
      }
      await lockRefreshFamily(client, family.rows[0].familyId);
      const found = await client.query<SessionRow>(
        `SELECT id, user_id AS "userId", family_id AS "familyId",
                expires_at AS "expiresAt", replaced_at AS "replacedAt", revoked_at AS "revokedAt"
         FROM refresh_sessions WHERE token_hash = $1`,
        [hash],
      );
      const row = found.rows[0];
      if (!row || row.familyId !== family.rows[0].familyId) {
        await client.query('ROLLBACK');
        return { status: 'invalid' };
      }
      if (row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return { status: 'invalid' };
      }
      if (row.replacedAt) {
        await revokeFamily(client, row.familyId);
        await client.query('COMMIT');
        return { status: 'reuse', familyId: row.familyId };
      }

      const refreshToken = newRefreshToken();
      await client.query(
        `UPDATE refresh_sessions SET replaced_at = NOW() WHERE id = $1`,
        [row.id],
      );
      await client.query(
        `INSERT INTO refresh_sessions (user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'))`,
        [row.userId, row.familyId, hashRefreshToken(refreshToken), REFRESH_TTL_SECONDS],
      );
      await client.query('COMMIT');
      return { status: 'rotated', userId: row.userId, familyId: row.familyId, refreshToken };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeFamilyByToken(presentedToken: string): Promise<void> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<{ familyId: string }>(
        `SELECT family_id AS "familyId" FROM refresh_sessions WHERE token_hash = $1`,
        [hashRefreshToken(presentedToken)],
      );
      if (!found.rows[0]) {
        await client.query('COMMIT');
        return;
      }
      await lockRefreshFamily(client, found.rows[0].familyId);
      const confirmed = await client.query<{ familyId: string }>(
        `SELECT family_id AS "familyId" FROM refresh_sessions WHERE token_hash = $1`,
        [hashRefreshToken(presentedToken)],
      );
      if (confirmed.rows[0]?.familyId === found.rows[0].familyId) {
        await revokeFamily(client, confirmed.rows[0].familyId);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

interface SessionRow {
  id: number;
  userId: number;
  familyId: string;
  expiresAt: Date;
  replacedAt: Date | null;
  revokedAt: Date | null;
}

async function revokeFamily(client: PoolClient, familyId: string): Promise<void> {
  await client.query(
    `UPDATE refresh_sessions SET revoked_at = NOW()
     WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId],
  );
}

Reflect.defineMetadata('design:paramtypes', [DatabaseService], SessionsRepository);
