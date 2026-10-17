import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import {
  assertIsolatedTestDatabaseUrl,
  ensureIsolatedTestDatabase,
  namedIsolatedTestDatabaseUrl,
  resetPublicSchema,
} from '../testing/test-database';
import {
  BASELINE_VERSION,
  listAppliedMigrations,
  loadMigrationFiles,
  resolveMigrationsDirectory,
  runMigrations,
} from './migrate';

const MIGRATE_DB = 'flowops_test_migrate';

let pool: Pool;
let testUrl: string;
const migrationDir = resolveMigrationsDirectory();
const files = loadMigrationFiles(migrationDir);

before(async () => {
  testUrl = await ensureIsolatedTestDatabase(MIGRATE_DB);
  assertIsolatedTestDatabaseUrl(testUrl);
  pool = new Pool({ connectionString: testUrl });
});

after(async () => {
  await pool?.end();
});

async function tableNames(): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

test('refuses the development database name', async () => {
  assert.throws(() => namedIsolatedTestDatabaseUrl('flowops'), /development database/);
  assert.throws(() => assertIsolatedTestDatabaseUrl('postgresql://flowops:x@localhost:5432/flowops'), /development database/);
  await assert.rejects(
    () => resetPublicSchema(pool, 'postgresql://flowops:x@localhost:5432/flowops'),
    /development database/,
  );
});

test('migrates a fresh database', async () => {
  await resetPublicSchema(pool, testUrl);
  const applied = await runMigrations(pool);
  assert.deepEqual(applied.map((row) => row.version), files.map((file) => file.version));
  const tables = await tableNames();
  assert.deepEqual(tables, ['refresh_sessions', 'schema_migrations', 'tasks', 'users']);
});

test('migrates a legacy tasks schema and preserves rows', async () => {
  await resetPublicSchema(pool, testUrl);
  const baseline = files.find((file) => file.version === BASELINE_VERSION);
  assert.ok(baseline);
  await pool.query(baseline.sql);
  await pool.query(
    `INSERT INTO tasks (title, team, priority, status)
     VALUES ('Keep me', 'Platform', 'high', 'todo'),
            ('Keep me too', 'Backend', 'low', 'done')`,
  );

  const applied = await runMigrations(pool);
  assert.deepEqual(applied.map((row) => row.version), ['001', '002', '003']);

  const tasks = await pool.query<{ title: string; status: string }>(
    'SELECT title, status FROM tasks ORDER BY id',
  );
  assert.deepEqual(tasks.rows, [
    { title: 'Keep me', status: 'todo' },
    { title: 'Keep me too', status: 'done' },
  ]);
});

test('running migrations repeatedly does not change applied versions or task rows', async () => {
  await resetPublicSchema(pool, testUrl);
  await runMigrations(pool);
  await pool.query(
    `INSERT INTO tasks (title, team, priority) VALUES ('Stable task', 'QA', 'medium')`,
  );
  const before = await listAppliedMigrations(pool);
  const beforeTasks = await pool.query('SELECT * FROM tasks ORDER BY id');

  await runMigrations(pool);
  await runMigrations(pool);

  assert.deepEqual(await listAppliedMigrations(pool), before);
  assert.deepEqual((await pool.query('SELECT * FROM tasks ORDER BY id')).rows, beforeTasks.rows);
});

test('records migration versions and checksums', async () => {
  await resetPublicSchema(pool, testUrl);
  await runMigrations(pool);
  const applied = await listAppliedMigrations(pool);
  assert.equal(applied.length, files.length);
  for (const file of files) {
    const row = applied.find((entry) => entry.version === file.version);
    assert.equal(row?.name, file.name);
    assert.equal(row?.checksum, file.checksum);
  }
});

test('users email is unique case-insensitively and role is constrained', async () => {
  await resetPublicSchema(pool, testUrl);
  await runMigrations(pool);

  await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ('Admin@Example.com', 'not-a-real-hash', 'ADMIN')`,
  );

  await assert.rejects(
    () => pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ('admin@example.com', 'also-not-a-hash', 'MEMBER')`,
    ),
    /users_email_lower_key|duplicate key/i,
  );

  await assert.rejects(
    () => pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ('other@example.com', 'not-a-real-hash', 'OWNER')`,
    ),
    /role/i,
  );

  await assert.rejects(
    () => pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES (NULL, 'not-a-real-hash', 'MEMBER')`,
    ),
    /null/i,
  );
});

test('refresh sessions require a user and a unique token hash', async () => {
  await resetPublicSchema(pool, testUrl);
  await runMigrations(pool);

  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, role)
     VALUES ('member@example.com', 'not-a-real-hash', 'MEMBER')
     RETURNING id`,
  );
  const userId = user.rows[0].id;
  const familyId = '11111111-1111-1111-1111-111111111111';

  await pool.query(
    `INSERT INTO refresh_sessions (user_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, 'hash-one', NOW() + INTERVAL '7 days')`,
    [userId, familyId],
  );

  await assert.rejects(
    () => pool.query(
      `INSERT INTO refresh_sessions (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, 'hash-one', NOW() + INTERVAL '7 days')`,
      [userId, familyId],
    ),
    /refresh_sessions_token_hash_key|duplicate key/i,
  );

  await assert.rejects(
    () => pool.query(
      `INSERT INTO refresh_sessions (user_id, family_id, token_hash, expires_at)
       VALUES (99999, $1, 'hash-two', NOW() + INTERVAL '7 days')`,
      [familyId],
    ),
    /foreign key|refresh_sessions_user_id_fkey/i,
  );
});

test('refuses an incompatible existing tasks table', async () => {
  await resetPublicSchema(pool, testUrl);
  await pool.query('CREATE TABLE tasks (id SERIAL PRIMARY KEY, title TEXT)');

  await assert.rejects(
    () => runMigrations(pool),
    /incompatible with the FlowOps baseline schema/,
  );

  const tables = await tableNames();
  assert.ok(tables.includes('tasks'));
  assert.ok(!tables.includes('users'));
  const recorded = await pool.query('SELECT version FROM schema_migrations');
  assert.equal(recorded.rowCount, 0);
});

test('refuses to reapply a migration whose SQL checksum changed', async () => {
  await resetPublicSchema(pool, testUrl);
  await runMigrations(pool);

  const tempDir = mkdtempSync(join(tmpdir(), 'flowops-migrations-'));
  for (const file of files) {
    const sql = file.version === '002' ? `${file.sql}\n-- checksum drift\n` : file.sql;
    writeFileSync(join(tempDir, file.fileName), sql, 'utf8');
  }

  await assert.rejects(
    () => runMigrations(pool, { directory: tempDir }),
    /checksum mismatch/,
  );
});
