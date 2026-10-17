import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UserRecord, UserRole } from './auth.types';

@Injectable()
export class UsersRepository {
  constructor(private readonly database: DatabaseService) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.database.pool.query<UserRow>(
      `SELECT id, email, password_hash AS "passwordHash", role
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: number): Promise<UserRecord | null> {
    const result = await this.database.pool.query<UserRow>(
      `SELECT id, email, password_hash AS "passwordHash", role
       FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async count(): Promise<number> {
    const result = await this.database.pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM users');
    return Number(result.rows[0]?.count ?? 0);
  }

  async create(email: string, passwordHash: string, role: UserRole): Promise<UserRecord> {
    const result = await this.database.pool.query<UserRow>(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
       RETURNING id, email, password_hash AS "passwordHash", role`,
      [email, passwordHash, role],
    );
    return result.rows[0];
  }
}

interface UserRow {
  id: number;
  email: string;
  passwordHash: string;
  role: UserRole;
}

Reflect.defineMetadata('design:paramtypes', [DatabaseService], UsersRepository);
