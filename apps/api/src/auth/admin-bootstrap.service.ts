import 'reflect-metadata';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { bootstrapAdminIfConfigured } from './bootstrap';

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.database.ensureSchema();
    await bootstrapAdminIfConfigured(this.database.pool);
  }
}

Reflect.defineMetadata('design:paramtypes', [DatabaseService], AdminBootstrapService);
