import { loadAiConfig } from './ai.config';
import { MAX_GENERATED_TASKS } from './task-draft.types';
import type { AiProviderId } from './ai.types';

export interface AiCapabilities {
  enabled: boolean;
  provider: AiProviderId;
  externalProcessingRequired: boolean;
  maxRequirementsChars: number;
  maxDrafts: number;
}

export function currentAiCapabilities(): AiCapabilities {
  const config = loadAiConfig();
  return {
    enabled: config.enabled,
    provider: config.provider,
    externalProcessingRequired: config.enabled && config.provider === 'openai',
    maxRequirementsChars: config.maxInputChars,
    maxDrafts: MAX_GENERATED_TASKS,
  };
}
