import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { hashPassword } from '../auth/passwords';
import { configureApp } from '../configure-app';
import { runMigrations } from '../database/migrate';
import { assertIsolatedTestDatabaseUrl, ensureIsolatedTestDatabase, resetPublicSchema } from './test-database';

const QA_DB = 'flowops_test_m33c';
const PORT = 3010;
const ORIGIN = 'http://127.0.0.1:4310';
const ADMIN_EMAIL = 'qa-admin@flowops.test';
const MEMBER_A_EMAIL = 'qa-member-a@flowops.test';
const MEMBER_B_EMAIL = 'qa-member-b@flowops.test';
const MEMBER_B_TITLE = 'B-SECRET-UNIQUE-ZZZ';
const MEMBER_A_PREFIX = 'A-ISO-';
const OVERDUE_TITLE = 'A-OVERDUE-YDAY';
const TODAY_TITLE = 'A-DUE-TODAY';
const HIST_DONE_TITLE = 'A-HIST-DONE';
const HIGH_DONE_TITLE = 'A-HIGH-DONE';
const ADMIN_TITLE = 'ADMIN-OWNED';

function loadDatabaseUrlFromDotenv(): void {
  const envPath = join(__dirname, '..', '..', '..', '..', '.env');
  if (!existsSync(envPath)) return;
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m);
  if (match && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = match[1].trim();
  }
}

function password(): string {
  return `Qa9!${randomBytes(12).toString('base64url')}`;
}

async function seed(pool: Pool, secrets: {
  adminPassword: string;
  memberAPassword: string;
  memberBPassword: string;
}): Promise<{
  adminId: number;
  memberAId: number;
  memberBId: number;
  memberBTaskId: number;
  overdueTaskId: number;
  histDoneTaskId: number;
}> {
  const hashes = await Promise.all([
    hashPassword(secrets.adminPassword),
    hashPassword(secrets.memberAPassword),
    hashPassword(secrets.memberBPassword),
  ]);
  const admin = await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'ADMIN') RETURNING id`,
    [ADMIN_EMAIL, hashes[0]],
  );
  const memberA = await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'MEMBER') RETURNING id`,
    [MEMBER_A_EMAIL, hashes[1]],
  );
  const memberB = await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'MEMBER') RETURNING id`,
    [MEMBER_B_EMAIL, hashes[2]],
  );
  const adminId = admin.rows[0].id as number;
  const memberAId = memberA.rows[0].id as number;
  const memberBId = memberB.rows[0].id as number;

  for (let index = 1; index <= 25; index += 1) {
    const title = `${MEMBER_A_PREFIX}${String(index).padStart(2, '0')}`;
    const status = index <= 3 ? 'in_progress' : 'todo';
    await pool.query(
      `INSERT INTO tasks (title, team, priority, status, owner_id)
       VALUES ($1, 'Alpha', 'medium', $2, $3)`,
      [title, status, memberAId],
    );
  }

  const overdue = await pool.query(
    `INSERT INTO tasks (title, team, priority, status, owner_id, description, due_at)
     VALUES ($1, 'Alpha', 'high', 'todo', $2, 'Seed overdue unfinished', (timezone('utc', now()))::date - 1)
     RETURNING id`,
    [OVERDUE_TITLE, memberAId],
  );
  await pool.query(
    `INSERT INTO tasks (title, team, priority, status, owner_id, due_at)
     VALUES ($1, 'Alpha', 'medium', 'todo', $2, (timezone('utc', now()))::date)`,
    [TODAY_TITLE, memberAId],
  );
  const histDone = await pool.query(
    `INSERT INTO tasks (title, team, priority, status, owner_id, due_at, completed_at)
     VALUES ($1, 'Alpha', 'medium', 'done', $2, (timezone('utc', now()))::date - 7, NULL)
     RETURNING id`,
    [HIST_DONE_TITLE, memberAId],
  );
  await pool.query(
    `INSERT INTO tasks (title, team, priority, status, owner_id, due_at, completed_at)
     VALUES ($1, 'Alpha', 'high', 'done', $2, (timezone('utc', now()))::date - 10, timezone('utc', now()))`,
    [HIGH_DONE_TITLE, memberAId],
  );

  const memberBTask = await pool.query(
    `INSERT INTO tasks (title, team, priority, status, owner_id, description)
     VALUES ($1, 'Bravo', 'high', 'todo', $2, 'Hidden from MEMBER A')
     RETURNING id`,
    [MEMBER_B_TITLE, memberBId],
  );
  await pool.query(
    `INSERT INTO tasks (title, team, priority, status, owner_id)
     VALUES ($1, 'Ops', 'low', 'todo', $2)`,
    [ADMIN_TITLE, adminId],
  );

  return {
    adminId,
    memberAId,
    memberBId,
    memberBTaskId: memberBTask.rows[0].id as number,
    overdueTaskId: overdue.rows[0].id as number,
    histDoneTaskId: histDone.rows[0].id as number,
  };
}

async function main(): Promise<void> {
  loadDatabaseUrlFromDotenv();
  const testUrl = await ensureIsolatedTestDatabase(QA_DB);
  const targetName = assertIsolatedTestDatabaseUrl(testUrl);
  if (targetName !== QA_DB) {
    throw new Error(`Refusing to start isolated QA against ${targetName}; expected ${QA_DB}.`);
  }

  const secretsPath = join(tmpdir(), 'flowops-m33c-qa-secrets.json');
  const secrets = {
    origin: ORIGIN,
    api: `http://127.0.0.1:${PORT}`,
    database: QA_DB,
    adminEmail: ADMIN_EMAIL,
    memberAEmail: MEMBER_A_EMAIL,
    memberBEmail: MEMBER_B_EMAIL,
    memberBTitle: MEMBER_B_TITLE,
    memberAPrefix: MEMBER_A_PREFIX,
    overdueTitle: OVERDUE_TITLE,
    todayTitle: TODAY_TITLE,
    histDoneTitle: HIST_DONE_TITLE,
    highDoneTitle: HIGH_DONE_TITLE,
    adminTitle: ADMIN_TITLE,
    adminPassword: password(),
    memberAPassword: password(),
    memberBPassword: password(),
  };

  process.env.NODE_ENV = 'development';
  process.env.DATABASE_URL = testUrl;
  process.env.PORT = String(PORT);
  process.env.AUTH_WEB_ORIGIN = ORIGIN;
  process.env.AUTH_COOKIE_SECURE = 'false';
  process.env.JWT_SECRET = randomBytes(32).toString('base64url');
  process.env.AUTH_ARGON2_MEMORY = '4096';
  process.env.AUTH_ARGON2_TIME = '1';
  process.env.AUTH_LOGIN_THROTTLE_LIMIT = '1000';
  process.env.AUTH_REFRESH_THROTTLE_LIMIT = '1000';
  process.env.BOOTSTRAP_ADMIN_EMAIL = '';
  process.env.BOOTSTRAP_ADMIN_PASSWORD = '';
  process.env.AI_ENABLED = 'true';
  process.env.AI_PROVIDER = 'mock';
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_LIVE_SMOKE;
  delete process.env.AUTH_ACCESS_TTL_SECONDS;

  const pool = new Pool({ connectionString: testUrl });
  const connected = await pool.query<{ name: string }>('SELECT current_database() AS name');
  if (connected.rows[0]?.name !== QA_DB) {
    await pool.end();
    throw new Error(`Refusing destructive QA setup: connected to ${connected.rows[0]?.name}, expected ${QA_DB}.`);
  }
  await resetPublicSchema(pool, testUrl);
  await runMigrations(pool);
  const ids = await seed(pool, secrets);
  await pool.end();

  writeFileSync(secretsPath, JSON.stringify({ ...secrets, ...ids }, null, 2));

  const { AppModule } = await import('../app.module');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  configureApp(app);
  await app.listen(PORT, '127.0.0.1');
  console.log(`Isolated QA API: http://127.0.0.1:${PORT}/api/health`);
  console.log(`Isolated QA origin: ${ORIGIN}`);
  console.log(`Isolated QA database: ${QA_DB}`);
  console.log(`Credentials file: ${secretsPath}`);
}

void main();
