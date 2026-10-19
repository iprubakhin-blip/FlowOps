import { Logger } from '@nestjs/common';
import { isTestDatabaseUrl } from './auth.config';
import { parseCredentials } from './credentials';
import { hashPassword } from './passwords';

const logger = new Logger('AdminBootstrap');

export interface BootstrapQuery {
  query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }>;
}

export async function bootstrapAdminIfConfigured(db: BootstrapQuery): Promise<'created' | 'skipped' | 'disabled'> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const emailSet = email !== undefined && email !== '';
  const passwordSet = password !== undefined && password !== '';

  if (!emailSet && !passwordSet) return 'disabled';
  if (emailSet !== passwordSet) {
    throw new Error('Bootstrap requires both BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.');
  }

  let credentials;
  try {
    credentials = parseCredentials({ email, password });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid bootstrap credentials.';
    throw new Error(`Bootstrap admin configuration is invalid: ${message}`);
  }

  if (isTestDatabaseUrl() && process.env.BOOTSTRAP_ALLOW_TEST !== 'true') {
    return 'skipped';
  }

  const count = await db.query('SELECT COUNT(*)::int AS count FROM users');
  if (Number(count.rows[0]?.count ?? 0) > 0) {
    logger.log('Bootstrap skipped because users already exist.');
    return 'skipped';
  }

  const passwordHash = await hashPassword(credentials.password);
  try {
    await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'ADMIN')`,
      [credentials.email, passwordHash],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      logger.log('Bootstrap skipped because users already exist.');
      return 'skipped';
    }
    throw error;
  }
  logger.log('Bootstrap admin created.');
  return 'created';
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505';
}
