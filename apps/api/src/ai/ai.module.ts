import { Module } from '@nestjs/common';
import { assertAiConfig, loadAiConfig } from './ai.config';
import { AiService } from './ai.service';
import { AI_PROVIDER, type AiProvider } from './ai.types';
import { MockAiProvider } from './mock-ai.provider';
import { OpenAiProvider } from './openai-ai.provider';

export function createConfiguredProvider(): AiProvider {
  const config = loadAiConfig();
  if (!config.enabled || config.provider === 'mock') {
    return new MockAiProvider();
  }
  assertAiConfig();
  return new OpenAiProvider({
    apiKey: config.openaiApiKey,
    model: config.model,
    timeoutMs: config.requestTimeoutMs,
  });
}

@Module({
  providers: [
    { provide: AI_PROVIDER, useFactory: createConfiguredProvider },
    AiService,
  ],
  exports: [AiService, AI_PROVIDER],
})
export class AiModule {}
