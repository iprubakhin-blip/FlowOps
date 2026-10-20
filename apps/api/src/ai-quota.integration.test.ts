import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { Pool } from 'pg';
import { AiQuotaRepository } from './ai/ai-quota.repository';
import { hashPassword } from './auth/passwords';
import { DatabaseService } from './database/database.service';
import { runMigrations } from './database/migrate';
import { ensureIsolatedTestDatabase, resetPublicSchema } from './testing/test-database';

let pool: Pool;
let testUrl: string;
let quotas: AiQuotaRepository;

async function insertUser(email: string): Promise<number> {
  const passwordHash = await hashPassword('test-password-ok');
  const result = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'MEMBER') RETURNING id`,
    [email, passwordHash],
  );
  return result.rows[0].id;
}

before(async () => {
  testUrl = await ensureIsolatedTestDatabase('flowops_test_ai_quota');
  const resetPool = new Pool({ connectionString: testUrl });
  await resetPublicSchema(resetPool, testUrl);
  await runMigrations(resetPool);
  await resetPool.end();
  pool = new Pool({ connectionString: testUrl });
  quotas = new AiQuotaRepository({ pool } as DatabaseService);
});

after(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE ai_request_quotas, users RESTART IDENTITY CASCADE');
});

test('atomic daily quota cannot be bypassed by concurrent reservations', async () => {
  const userId = await insertUser('quota@example.com');
  const day = new Date('2026-10-20T12:00:00.000Z');
  const results = await Promise.all(Array.from({ length: 8 }, () => quotas.reserveDailyRequest(userId, 3, day, pool)));
  assert.equal(results.filter((row) => row.allowed).length, 3);
  assert.equal(results.filter((row) => !row.allowed).length, 5);
  const stored = await pool.query<{ request_count: number }>(
    `SELECT request_count FROM ai_request_quotas WHERE user_id = $1 AND usage_date = $2`,
    [userId, '2026-10-20'],
  );
  assert.equal(stored.rows[0].request_count, 3);
});

test('separate users and UTC date rollover use independent counters', async () => {
  const alice = await insertUser('alice@example.com');
  const bob = await insertUser('bob@example.com');
  const day = new Date('2026-10-20T23:30:00.000Z');
  const next = new Date('2026-10-21T00:30:00.000Z');
  assert.equal((await quotas.reserveDailyRequest(alice, 1, day, pool)).allowed, true);
  assert.equal((await quotas.reserveDailyRequest(alice, 1, day, pool)).allowed, false);
  assert.equal((await quotas.reserveDailyRequest(bob, 1, day, pool)).allowed, true);
  assert.equal((await quotas.reserveDailyRequest(alice, 1, next, pool)).allowed, true);
});
