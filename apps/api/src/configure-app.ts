import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { assertAiConfig } from './ai/ai.config';
import { assertSecurityConfig } from './auth/auth.config';

export function configureApp(app: INestApplication): void {
  assertSecurityConfig();
  assertAiConfig();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use((req: { path?: string }, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    const path = req.path ?? '';
    if (path.includes('/auth') || path.includes('/tasks')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });
}
