import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { runMigrations } from './migrate';

export function postgresConnectionString(): string {
  return process.env.DATABASE_URL ??
    'postgresql://flowops:flowops_dev_password@localhost:5432/flowops';
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool = new Pool({ connectionString: postgresConnectionString() });
  private schemaReady: Promise<void> | undefined;

  ensureSchema(): Promise<void> {
    this.schemaReady ??= runMigrations(this.pool).then(() => undefined);
    return this.schemaReady;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
