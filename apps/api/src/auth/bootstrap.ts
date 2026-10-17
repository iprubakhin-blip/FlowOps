import { Logger } from '@nestjs/common';
import { isTestDatabaseUrl } from './auth.config';
import { parseCredentials } from './credentials';
import { hashPassword } from './passwords';
import { UsersRepository } from './users.repository';

const logger = new Logger('AdminBootstrap');

export async function bootstrapAdminIfConfigured(users: UsersRepository): Promise<'created' | 'skipped' | 'disabled'> {
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

  if (await users.count() > 0) {
    logger.log('Bootstrap skipped because users already exist.');
    return 'skipped';
  }

  const passwordHash = await hashPassword(credentials.password);
  await users.create(credentials.email, passwordHash, 'ADMIN');
  logger.log('Bootstrap admin created.');
  return 'created';
}
