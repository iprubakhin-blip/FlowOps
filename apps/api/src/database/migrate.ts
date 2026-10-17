import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';

export const MIGRATION_LOCK_KEY = 0xF10605;
export const BASELINE_VERSION = '001';

const FILE_NAME = /^(\d{3})_([a-z0-9_]+)\.sql$/;

export interface MigrationFile {
  version: string;
  name: string;
  checksum: string;
  sql: string;
  fileName: string;
}

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
}

export function resolveMigrationsDirectory(): string {
  const candidates = [
    join(__dirname, '..', '..', 'migrations'),
    join(__dirname, '..', 'migrations'),
    join(process.cwd(), 'migrations'),
    join(process.cwd(), 'apps', 'api', 'migrations'),
  ];
  const found = candidates.find((directory) => existsSync(directory));
  if (!found) {
    throw new Error(`Could not find migrations directory. Looked in: ${candidates.join(', ')}`);
  }
  return found;
}

export function loadMigrationFiles(directory = resolveMigrationsDirectory()): MigrationFile[] {
  const files = readdirSync(directory)
    .filter((file) => FILE_NAME.test(file))
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) {
    throw new Error(`No migration SQL files found in ${directory}`);
  }
  return files.map((fileName) => {
    const match = FILE_NAME.exec(fileName);
    if (!match) throw new Error(`Invalid migration file name: ${fileName}`);
    const sql = readFileSync(join(directory, fileName), 'utf8');
    return {
      version: match[1],
      name: match[2],
      checksum: checksumSql(sql),
      sql,
      fileName,
    };
  });
}

export function checksumSql(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export async function runMigrations(
  pool: Pool,
  options: { directory?: string } = {},
): Promise<AppliedMigration[]> {
  const migrations = loadMigrationFiles(options.directory);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      const applied = await loadApplied(client);
      for (const migration of migrations) {
        const existing = applied.get(migration.version);
        if (existing) {
          if (existing.checksum !== migration.checksum) {
            throw new Error(
              `Migration ${migration.fileName} checksum mismatch. ` +
                `The SQL file changed after it was applied. Refusing to continue.`,
            );
          }
          continue;
        }
        await applyMigration(client, migration);
        applied.set(migration.version, {
          version: migration.version,
          name: migration.name,
          checksum: migration.checksum,
        });
      }
      return [...applied.values()].sort((left, right) => left.version.localeCompare(right.version));
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export async function listAppliedMigrations(pool: Pool): Promise<AppliedMigration[]> {
  const result = await pool.query<AppliedMigration>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
  );
  return result.rows;
}

async function loadApplied(client: PoolClient): Promise<Map<string, AppliedMigration>> {
  const result = await client.query<AppliedMigration>(
    'SELECT version, name, checksum FROM schema_migrations',
  );
  return new Map(result.rows.map((row) => [row.version, row]));
}

async function applyMigration(client: PoolClient, migration: MigrationFile): Promise<void> {
  await client.query('BEGIN');
  try {
    if (migration.version === BASELINE_VERSION) {
      await applyBaseline(client, migration);
    } else {
      await client.query(migration.sql);
    }
    await client.query(
      `INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
      [migration.version, migration.name, migration.checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Migration ${migration.fileName} failed: ${detail}`);
  }
}

async function applyBaseline(client: PoolClient, migration: MigrationFile): Promise<void> {
  const state = await inspectTasksTable(client);
  if (state === 'compatible') {
    return;
  }
  if (state === 'missing') {
    await client.query(migration.sql);
    return;
  }
  throw new Error(
    'Existing tasks table is incompatible with the FlowOps baseline schema. ' +
      `${state}. Refusing to mark migration ${migration.fileName} as applied.`,
  );
}

type TasksTableState = 'missing' | 'compatible' | string;

async function inspectTasksTable(client: PoolClient): Promise<TasksTableState> {
  const exists = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'tasks'
     ) AS exists`,
  );
  if (!exists.rows[0]?.exists) return 'missing';

  const columns = await client.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    character_maximum_length: number | null;
  }>(
    `SELECT column_name, data_type, is_nullable, character_maximum_length
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tasks'`,
  );
  const byName = new Map(columns.rows.map((column) => [column.column_name, column]));
  const required: Array<{
    name: string;
    type: string;
    nullable: boolean;
    length?: number;
  }> = [
    { name: 'id', type: 'integer', nullable: false },
    { name: 'title', type: 'character varying', nullable: false, length: 120 },
    { name: 'team', type: 'character varying', nullable: false, length: 60 },
    { name: 'priority', type: 'character varying', nullable: false },
    { name: 'status', type: 'character varying', nullable: false },
    { name: 'created_at', type: 'timestamp with time zone', nullable: false },
    { name: 'updated_at', type: 'timestamp with time zone', nullable: false },
  ];

  for (const column of required) {
    const actual = byName.get(column.name);
    if (!actual) return `missing column ${column.name}`;
    if (actual.data_type !== column.type) {
      return `column ${column.name} has type ${actual.data_type}, expected ${column.type}`;
    }
    if (column.nullable === false && actual.is_nullable !== 'NO') {
      return `column ${column.name} must be NOT NULL`;
    }
    if (column.length !== undefined && actual.character_maximum_length !== column.length) {
      return `column ${column.name} length is ${actual.character_maximum_length}, expected ${column.length}`;
    }
  }

  const checks = await client.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conrelid = 'public.tasks'::regclass AND contype = 'c'`,
  );
  const definitions = checks.rows.map((row) => row.definition.toLowerCase()).join(' ');
  for (const value of ['low', 'medium', 'high']) {
    if (!definitions.includes(`'${value}'`)) {
      return `tasks is missing a priority CHECK that includes '${value}'`;
    }
  }
  for (const value of ['todo', 'in_progress', 'done']) {
    if (!definitions.includes(`'${value}'`)) {
      return `tasks is missing a status CHECK that includes '${value}'`;
    }
  }

  const primary = await client.query<{ attname: string }>(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = 'public.tasks'::regclass AND i.indisprimary`,
  );
  if (primary.rows.length !== 1 || primary.rows[0]?.attname !== 'id') {
    return 'tasks primary key must be column id';
  }

  return 'compatible';
}
