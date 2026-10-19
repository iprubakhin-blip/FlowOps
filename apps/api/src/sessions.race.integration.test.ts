import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { Pool } from 'pg';
import { hashPassword } from './auth/passwords';
import { REFRESH_FAMILY_LOCK_NS, lockRefreshFamily } from './auth/sessions.repository';
import { hashRefreshToken, newRefreshToken } from './auth/tokens';
import { runMigrations } from './database/migrate';
import { ensureIsolatedTestDatabase, resetPublicSchema } from './testing/test-database';

const EMAIL = 'race@example.com';
const PASSWORD = 'test-password-ok';

let pool: Pool;
let testUrl: string;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.AUTH_ARGON2_MEMORY = '4096';
  process.env.AUTH_ARGON2_TIME = '1';
  testUrl = await ensureIsolatedTestDatabase('flowops_test_sessions');
  pool = new Pool({ connectionString: testUrl });
  await resetPublicSchema(pool, testUrl);
  await runMigrations(pool);
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE refresh_sessions, users, tasks RESTART IDENTITY CASCADE');
  await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'MEMBER')`,
    [EMAIL, await hashPassword(PASSWORD)],
  );
});

after(async () => {
  await pool?.end();
});

async function seedFamily(): Promise<{ userId: number; familyId: string; tokenA: string; tokenB: string }> {
  const userId = 1;
  const familyId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const tokenA = newRefreshToken();
  const tokenB = newRefreshToken();
  await pool.query(
    `INSERT INTO refresh_sessions (user_id, family_id, token_hash, expires_at, replaced_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '7 days', NOW())`,
    [userId, familyId, hashRefreshToken(tokenA)],
  );
  await pool.query(
    `INSERT INTO refresh_sessions (user_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
    [userId, familyId, hashRefreshToken(tokenB)],
  );
  return { userId, familyId, tokenA, tokenB };
}

test('family revocation waits for an in-flight rotation and still revokes the successor', async () => {
  const { userId, familyId, tokenA } = await seedFamily();
  const rotator = await pool.connect();
  const revoker = await pool.connect();
  const tokenC = newRefreshToken();
  try {
    await rotator.query('BEGIN');
    await lockRefreshFamily(rotator, familyId);
    const live = await rotator.query<{ id: number }>(
      `SELECT id FROM refresh_sessions WHERE family_id = $1 AND replaced_at IS NULL FOR UPDATE`,
      [familyId],
    );
    await rotator.query(`UPDATE refresh_sessions SET replaced_at = NOW() WHERE id = $1`, [live.rows[0].id]);
    await rotator.query(
      `INSERT INTO refresh_sessions (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
      [userId, familyId, hashRefreshToken(tokenC)],
    );

    await revoker.query('BEGIN');
    const waiting = revoker.query('SELECT pg_advisory_xact_lock($1, hashtext($2::text))', [REFRESH_FAMILY_LOCK_NS, familyId]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rotator.query('COMMIT');
    await waiting;
    await revoker.query(
      `UPDATE refresh_sessions SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
    await revoker.query('COMMIT');
  } finally {
    rotator.release();
    revoker.release();
  }

  const live = await pool.query(
    `SELECT id FROM refresh_sessions WHERE family_id = $1 AND revoked_at IS NULL AND replaced_at IS NULL`,
    [familyId],
  );
  assert.equal(live.rowCount, 0);
  const hashedA = hashRefreshToken(tokenA);
  assert.ok(hashedA);
});

test('rolling back a rotation releases the family lock', async () => {
  const { familyId } = await seedFamily();
  const rotator = await pool.connect();
  const later = await pool.connect();
  try {
    await rotator.query('BEGIN');
    await lockRefreshFamily(rotator, familyId);
    await rotator.query('ROLLBACK');
    await later.query('BEGIN');
    await lockRefreshFamily(later, familyId);
    await later.query(
      `UPDATE refresh_sessions SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
    await later.query('COMMIT');
  } finally {
    rotator.release();
    later.release();
  }
  const live = await pool.query(
    `SELECT id FROM refresh_sessions WHERE family_id = $1 AND revoked_at IS NULL AND replaced_at IS NULL`,
    [familyId],
  );
  assert.equal(live.rowCount, 0);
});
