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
  OWNERSHIP_VERSION,
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
  assert.throws(() => namedIsolatedTestDatabaseUrl('flowops'), /non-isolated/);
  assert.throws(() => namedIsolatedTestDatabaseUrl('not_flowops_test'), /non-isolated/);
  assert.throws(() => assertIsolatedTestDatabaseUrl('postgresql://flowops:x@localhost:5432/flowops'), /non-isolated/);
  await assert.rejects(
    () => resetPublicSchema(pool, 'postgresql://flowops:x@localhost:5432/flowops'),
    /non-isolated/,
  );
});

test('migrates a fresh database', async () => {
  await resetPublicSchema(pool, testUrl);
  const applied = await runMigrations(pool);
  assert.deepEqual(applied.map((row) => row.version), files.map((file) => file.version));
  const tables = await tableNames();
  assert.deepEqual(tables, ['ai_request_quotas', 'refresh_sessions', 'schema_migrations', 'tasks', 'users']);
});

function writeSubset(versions: string[]): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'flowops-migrations-'));
  for (const file of files) {
    if (versions.includes(file.version)) {
      writeFileSync(join(tempDir, file.fileName), file.sql, 'utf8');
    }
  }
  return tempDir;
}

test('migrates a legacy tasks schema and preserves rows with the intended admin owner', async () => {
  await resetPublicSchema(pool, testUrl);
  const baseline = files.find((file) => file.version === BASELINE_VERSION);
  assert.ok(baseline);
  await pool.query(baseline.sql);
  await pool.query(
    `INSERT INTO tasks (id, title, team, priority, status)
     VALUES (11, 'Keep me', 'Platform', 'high', 'todo'),
            (12, 'Keep me too', 'Backend', 'low', 'done')`,
  );

  await runMigrations(pool, { directory: writeSubset(['001', '002', '003']) });
  const admin = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, role)
     VALUES ('legacy-admin@example.com', 'not-a-real-hash', 'ADMIN')
     RETURNING id`,
  );

  const applied = await runMigrations(pool);
  assert.deepEqual(applied.map((row) => row.version), files.map((file) => file.version));

  const tasks = await pool.query<{ id: number; title: string; status: string; owner_id: number }>(
    'SELECT id, title, status, owner_id FROM tasks ORDER BY id',
  );
  assert.deepEqual(tasks.rows, [
    { id: 11, title: 'Keep me', status: 'todo', owner_id: admin.rows[0].id },
    { id: 12, title: 'Keep me too', status: 'done', owner_id: admin.rows[0].id },
  ]);
  const ownerNull = await pool.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'tasks' AND column_name = 'owner_id'`,
  );
  assert.equal(ownerNull.rows[0].is_nullable, 'NO');
});

test('running migrations repeatedly does not change applied versions or task rows', async () => {
  await resetPublicSchema(pool, testUrl);
  await runMigrations(pool);
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, role)
     VALUES ('owner@example.com', 'not-a-real-hash', 'MEMBER')
     RETURNING id`,
  );
  await pool.query(
    `INSERT INTO tasks (title, team, priority, owner_id) VALUES ('Stable task', 'QA', 'medium', $1)`,
    [user.rows[0].id],
  );
  const before = await listAppliedMigrations(pool);
  const beforeTasks = await pool.query('SELECT * FROM tasks ORDER BY id');

  await runMigrations(pool);
  await runMigrations(pool);

  assert.deepEqual(await listAppliedMigrations(pool), before);
  assert.deepEqual((await pool.query('SELECT * FROM tasks ORDER BY id')).rows, beforeTasks.rows);
});

test('migration 005 adds nullable task details without inventing completion times', async () => {
  await resetPublicSchema(pool, testUrl);
  await runMigrations(pool, { directory: writeSubset(['001', '002', '003', '004']) });
  const admin = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, role)
     VALUES ('m31a-admin@example.com', 'not-a-real-hash', 'ADMIN') RETURNING id`,
  );
  const member = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, role)
     VALUES ('m31a-member@example.com', 'not-a-real-hash', 'MEMBER') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO tasks (id, title, team, priority, status, owner_id, created_at, updated_at)
     VALUES
       (21, 'Open owned', 'QA', 'low', 'todo', $1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
       (22, 'Done unknown', 'QA', 'high', 'done', $1, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
       (23, 'Other user', 'Backend', 'medium', 'todo', $2, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z')`,
    [admin.rows[0].id, member.rows[0].id],
  );
  const before = await pool.query(
    'SELECT id, title, team, priority, status, owner_id, created_at, updated_at FROM tasks ORDER BY id',
  );

  const applied = await runMigrations(pool);
  assert.equal(applied.some((row) => row.version === '005'), true);

  const columns = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tasks'
       AND column_name IN ('description', 'due_at', 'completed_at')
     ORDER BY column_name`,
  );
  assert.deepEqual(columns.rows, [
    { column_name: 'completed_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
    { column_name: 'description', data_type: 'text', is_nullable: 'YES' },
    { column_name: 'due_at', data_type: 'date', is_nullable: 'YES' },
  ]);

  const after = await pool.query(
    `SELECT id, title, team, priority, status, owner_id, created_at, updated_at,
            description, due_at, completed_at
     FROM tasks ORDER BY id`,
  );
  assert.deepEqual(
    after.rows.map(({ description, due_at, completed_at, ...row }) => {
      void description;
      void due_at;
      void completed_at;
      return row;
    }),
    before.rows,
  );
  assert.equal(after.rows.every((row) => row.description === null && row.due_at === null && row.completed_at === null), true);
  assert.equal(after.rows.find((row) => row.id === 22)?.status, 'done');

  await assert.rejects(
    () => pool.query(
      `UPDATE tasks SET completed_at = NOW() WHERE id = 21`,
    ),
    /tasks_completed_at_status_chk/,
  );

  const ownerNull = await pool.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'tasks' AND column_name = 'owner_id'`,
  );
  assert.equal(ownerNull.rows[0].is_nullable, 'NO');
});

test('migration 006 adds per-user UTC quota rows without touching tasks', async () => {
  await resetPublicSchema(pool, testUrl);
  await runMigrations(pool);
  await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ('quota@example.com', 'not-a-real-hash', 'MEMBER')`,
  );
  await pool.query(
    `INSERT INTO ai_request_quotas (user_id, usage_date, request_count) VALUES (1, '2026-10-20', 1)`,
  );
  await assert.rejects(
    () => pool.query(
      `INSERT INTO ai_request_quotas (user_id, usage_date, request_count) VALUES (1, '2026-10-20', 2)`,
    ),
    /duplicate key|unique/i,
  );
  const tasks = await pool.query('SELECT count(*)::int AS count FROM tasks');
  assert.equal(tasks.rows[0].count, 0);
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

test('fresh databases with zero users and zero tasks receive NOT NULL owner_id', async () => {
  await resetPublicSchema(pool, testUrl);
  await runMigrations(pool);
  const owner = await pool.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'owner_id'`,
  );
  assert.equal(owner.rows[0].is_nullable, 'NO');
  await assert.rejects(
    () => pool.query(`INSERT INTO tasks (title, team, priority) VALUES ('No owner', 'QA', 'low')`),
    /null|owner_id/i,
  );
  await assert.rejects(
    () => pool.query(
      `INSERT INTO tasks (title, team, priority, owner_id) VALUES ('Ghost', 'QA', 'low', 99999)`,
    ),
    /foreign key|owner_id/i,
  );
});

test('legacy backfill fails safely when no admin exists and leaves task rows intact', async () => {
  await resetPublicSchema(pool, testUrl);
  const baseline = files.find((file) => file.version === BASELINE_VERSION);
  assert.ok(baseline);
  await pool.query(baseline.sql);
  await pool.query(
    `INSERT INTO tasks (title, team, priority, status)
     VALUES ('Orphan', 'Platform', 'high', 'todo')`,
  );
  await runMigrations(pool, { directory: writeSubset(['001', '002', '003']) });

  await assert.rejects(() => runMigrations(pool), /no ADMIN user is available/i);

  const recorded = await pool.query(`SELECT version FROM schema_migrations WHERE version = $1`, [OWNERSHIP_VERSION]);
  assert.equal(recorded.rowCount, 0);
  const tasks = await pool.query<{ title: string }>('SELECT title FROM tasks');
  assert.deepEqual(tasks.rows, [{ title: 'Orphan' }]);
  const column = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'owner_id'`,
  );
  assert.equal(column.rowCount, 0);
});

test('ambiguous admins require TASK_LEGACY_OWNER_EMAIL and do not promote members', async () => {
  await resetPublicSchema(pool, testUrl);
  const baseline = files.find((file) => file.version === BASELINE_VERSION);
  assert.ok(baseline);
  await pool.query(baseline.sql);
  await pool.query(`INSERT INTO tasks (title, team, priority) VALUES ('Pick me', 'QA', 'low')`);
  await runMigrations(pool, { directory: writeSubset(['001', '002', '003']) });
  await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES
     ('one@example.com', 'hash', 'ADMIN'),
     ('two@example.com', 'hash', 'ADMIN'),
     ('member@example.com', 'hash', 'MEMBER')`,
  );

  delete process.env.TASK_LEGACY_OWNER_EMAIL;
  await assert.rejects(() => runMigrations(pool), /multiple ADMIN/i);
  assert.equal(
    (await pool.query(`SELECT version FROM schema_migrations WHERE version = $1`, [OWNERSHIP_VERSION])).rowCount,
    0,
  );

  process.env.TASK_LEGACY_OWNER_EMAIL = 'member@example.com';
  await assert.rejects(() => runMigrations(pool), /not an ADMIN/i);

  process.env.TASK_LEGACY_OWNER_EMAIL = 'two@example.com';
  await runMigrations(pool);
  const owned = await pool.query<{ owner_id: number; email: string }>(
    `SELECT t.owner_id, u.email FROM tasks t JOIN users u ON u.id = t.owner_id`,
  );
  assert.equal(owned.rows[0].email, 'two@example.com');
  delete process.env.TASK_LEGACY_OWNER_EMAIL;
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

test('legacy tasks with bootstrap configured provision an admin before ownership backfill', async () => {
  await resetPublicSchema(pool, testUrl);
  const baseline = files.find((file) => file.version === BASELINE_VERSION);
  assert.ok(baseline);
  await pool.query(baseline.sql);
  await pool.query(`INSERT INTO tasks (title, team, priority) VALUES ('Owned after bootstrap', 'QA', 'low')`);
  await runMigrations(pool, { directory: writeSubset(['001', '002', '003']) });

  process.env.BOOTSTRAP_ALLOW_TEST = 'true';
  process.env.BOOTSTRAP_ADMIN_EMAIL = 'legacy-boot@example.com';
  process.env.BOOTSTRAP_ADMIN_PASSWORD = 'bootstrap-pass';
  process.env.AUTH_ARGON2_MEMORY = '4096';
  process.env.AUTH_ARGON2_TIME = '1';
  process.env.NODE_ENV = 'test';
  try {
    await runMigrations(pool);
  } finally {
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    delete process.env.BOOTSTRAP_ALLOW_TEST;
  }

  const admin = await pool.query<{ id: number; email: string; password_hash: string }>(
    'SELECT id, email, password_hash FROM users',
  );
  assert.equal(admin.rowCount, 1);
  assert.equal(admin.rows[0].email, 'legacy-boot@example.com');
  const hash = admin.rows[0].password_hash;
  const owned = await pool.query<{ owner_id: number; title: string }>('SELECT owner_id, title FROM tasks');
  assert.equal(owned.rows[0].title, 'Owned after bootstrap');
  assert.equal(owned.rows[0].owner_id, admin.rows[0].id);

  process.env.BOOTSTRAP_ALLOW_TEST = 'true';
  process.env.BOOTSTRAP_ADMIN_EMAIL = 'legacy-boot@example.com';
  process.env.BOOTSTRAP_ADMIN_PASSWORD = 'a-different-password-xx';
  try {
    await runMigrations(pool);
    const { bootstrapAdminIfConfigured } = await import('../auth/bootstrap');
    assert.equal(await bootstrapAdminIfConfigured(pool), 'skipped');
  } finally {
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    delete process.env.BOOTSTRAP_ALLOW_TEST;
  }
  assert.equal(
    (await pool.query<{ password_hash: string }>('SELECT password_hash FROM users')).rows[0].password_hash,
    hash,
  );
});

test('fresh database with bootstrap configured still migrates and can create the admin', async () => {
  await resetPublicSchema(pool, testUrl);
  process.env.NODE_ENV = 'test';
  process.env.BOOTSTRAP_ALLOW_TEST = 'true';
  process.env.BOOTSTRAP_ADMIN_EMAIL = 'fresh-boot@example.com';
  process.env.BOOTSTRAP_ADMIN_PASSWORD = 'bootstrap-pass';
  process.env.AUTH_ARGON2_MEMORY = '4096';
  process.env.AUTH_ARGON2_TIME = '1';
  try {
    await runMigrations(pool);
    const { bootstrapAdminIfConfigured } = await import('../auth/bootstrap');
    assert.equal((await pool.query(`SELECT email FROM users`)).rows[0].email, 'fresh-boot@example.com');
    assert.equal(await bootstrapAdminIfConfigured(pool), 'skipped');
  } finally {
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    delete process.env.BOOTSTRAP_ALLOW_TEST;
  }
});

test('two concurrent migrations serialize on the advisory lock', async () => {
  await resetPublicSchema(pool, testUrl);
  const [first, second] = await Promise.all([runMigrations(pool), runMigrations(pool)]);
  assert.deepEqual(first.map((row) => row.version), files.map((file) => file.version));
  assert.deepEqual(second.map((row) => row.version), files.map((file) => file.version));
  assert.equal((await listAppliedMigrations(pool)).length, files.length);
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
