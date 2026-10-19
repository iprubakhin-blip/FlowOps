import { Pool } from 'pg';
import { isIsolatedTestDatabaseName } from '../auth/auth.config';

const DEFAULT_DEV_URL = 'postgresql://flowops:flowops_dev_password@127.0.0.1:5432/flowops';
const TEST_DB = 'flowops_test';

function toUrl(connectionString: string): URL {
  return new URL(connectionString.replace(/^postgresql:/, 'http:'));
}

function toConnectionString(url: URL): string {
  return url.toString().replace(/^http:/, 'postgresql:');
}

function databaseName(url: URL): string {
  return url.pathname.replace(/^\//, '').split('/')[0] ?? '';
}

export function isolatedTestDatabaseUrl(): string {
  const source = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DEV_URL;
  const url = toUrl(source);
  const name = databaseName(url);
  if (name === 'flowops') url.pathname = `/${TEST_DB}`;
  const testName = databaseName(url);
  if (!isIsolatedTestDatabaseName(testName)) {
    throw new Error('Refusing to run integration tests against the development database.');
  }
  return toConnectionString(url);
}

export function namedIsolatedTestDatabaseUrl(name: string): string {
  if (!isIsolatedTestDatabaseName(name)) {
    throw new Error('Refusing to run integration tests against a non-isolated database. Use flowops_test or flowops_test_<label>.');
  }
  const source = process.env.DATABASE_URL ?? DEFAULT_DEV_URL;
  const url = toUrl(source);
  url.pathname = `/${name}`;
  return toConnectionString(url);
}

export function assertIsolatedTestDatabaseUrl(connectionString: string): string {
  const name = databaseName(toUrl(connectionString));
  if (!isIsolatedTestDatabaseName(name)) {
    throw new Error('Refusing to run destructive tests against a non-isolated database. Use flowops_test or flowops_test_<label>.');
  }
  return name;
}

export async function ensureIsolatedTestDatabase(name?: string): Promise<string> {
  const testUrl = name ? namedIsolatedTestDatabaseUrl(name) : isolatedTestDatabaseUrl();
  const testName = assertIsolatedTestDatabaseUrl(testUrl);
  const adminUrl = toUrl(process.env.DATABASE_URL ?? DEFAULT_DEV_URL);
  adminUrl.pathname = '/flowops';
  const admin = new Pool({ connectionString: toConnectionString(adminUrl) });
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [testName]);
    if ((existing.rowCount ?? 0) === 0) {
      await admin.query(`CREATE DATABASE ${testName}`);
    }
  } finally {
    await admin.end();
  }
  return testUrl;
}

export async function resetPublicSchema(pool: Pool, connectionString: string): Promise<void> {
  assertIsolatedTestDatabaseUrl(connectionString);
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
  await pool.query('GRANT ALL ON SCHEMA public TO public');
}
