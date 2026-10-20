import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminBootstrapService } from './auth/admin-bootstrap.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { SessionsRepository } from './auth/sessions.repository';
import { UsersRepository } from './auth/users.repository';
import { AiModule } from './ai/ai.module';
import { DatabaseService } from './database/database.service';
import { TasksController } from './tasks.controller';
import { TasksRepository } from './tasks.repository';

@Controller('health')
class HealthController {
  @Get()
  getHealth(): { status: 'ok' } { return { status: 'ok' }; }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
    AiModule,
    ThrottlerModule.forRoot({
      getTracker: (req) => req.ip || 'anonymous',
      throttlers: [{ name: 'default', ttl: 60_000, limit: 1_000 }],
    }),
  ],
  controllers: [TasksController, HealthController, AuthController],
  providers: [
    DatabaseService,
    TasksRepository,
    UsersRepository,
    SessionsRepository,
    AuthService,
    AuthGuard,
    AdminBootstrapService,
  ],
})
export class AppModule {}
