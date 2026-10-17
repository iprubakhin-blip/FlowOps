import 'reflect-metadata';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { bootstrapAdminIfConfigured } from './bootstrap';
import { UsersRepository } from './users.repository';

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly users: UsersRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.database.ensureSchema();
    await bootstrapAdminIfConfigured(this.users);
  }
}

Reflect.defineMetadata('design:paramtypes', [DatabaseService, UsersRepository], AdminBootstrapService);
