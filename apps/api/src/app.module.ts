import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TasksController } from './tasks.controller';
import { TasksRepository } from './tasks.repository';

@Controller('health')
class HealthController {
  @Get()
  getHealth(): { status: 'ok' } { return { status: 'ok' }; }
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' })],
  controllers: [TasksController, HealthController],
  providers: [TasksRepository],
})
export class AppModule {}
