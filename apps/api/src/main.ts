import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { assertSecurityConfig } from './auth/auth.config';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  assertSecurityConfig();
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`FlowOps API: http://localhost:${port}/api/health`);
}

void bootstrap();
