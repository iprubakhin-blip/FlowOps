import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`FlowOps API: http://localhost:${port}/api/health`);
}

void bootstrap();
