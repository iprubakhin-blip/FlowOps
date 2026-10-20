import { AI_PROVIDERS, type AiProviderId } from './ai.types';

const DEFAULT_MAX_INPUT_CHARS = 8_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL = 'gpt-5.4-mini';
const DEFAULT_MAX_REQUESTS_PER_USER_DAY = 20;

export interface AiConfig {
  enabled: boolean;
  provider: AiProviderId;
  model: string;
  openaiApiKey: string;
  maxInputChars: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  /** Per authenticated user per UTC date. Enforced in PostgreSQL, not a dollar cap. */
  maxRequestsPerUserDay: number;
}

export function loadAiConfig(): AiConfig {
  const enabled = readBool(process.env.AI_ENABLED, false, 'AI_ENABLED');
  const provider = readProvider(process.env.AI_PROVIDER);
  const openaiApiKey = readSecret(process.env.OPENAI_API_KEY);
  return {
    enabled,
    provider,
    model: readModel(process.env.AI_MODEL),
    openaiApiKey,
    maxInputChars: readBoundedInt(process.env.AI_MAX_INPUT_CHARS, DEFAULT_MAX_INPUT_CHARS, 1, 100_000, 'AI_MAX_INPUT_CHARS'),
    maxOutputTokens: readBoundedInt(process.env.AI_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, 1, 8_192, 'AI_MAX_OUTPUT_TOKENS'),
    requestTimeoutMs: readBoundedInt(process.env.AI_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 50, 120_000, 'AI_REQUEST_TIMEOUT_MS'),
    maxRequestsPerUserDay: readBoundedInt(
      process.env.AI_MAX_REQUESTS_PER_USER_DAY,
      DEFAULT_MAX_REQUESTS_PER_USER_DAY,
      1,
      10_000,
      'AI_MAX_REQUESTS_PER_USER_DAY',
    ),
  };
}

export function assertAiConfig(): void {
  const config = loadAiConfig();
  if (config.enabled && config.provider === 'openai' && config.openaiApiKey === '') {
    throw new Error('OPENAI_API_KEY is required when AI_ENABLED=true and AI_PROVIDER=openai.');
  }
}

function readProvider(raw: string | undefined): AiProviderId {
  const value = (raw ?? '').trim();
  if (value === '') return 'mock';
  if ((AI_PROVIDERS as readonly string[]).includes(value)) return value as AiProviderId;
  throw new Error(`Unsupported AI_PROVIDER "${value}". Supported values: mock, openai.`);
}

function readModel(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (value === '') return DEFAULT_MODEL;
  if (value.length > 80 || !/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error('AI_MODEL must be a short identifier using letters, numbers, dot, underscore, or hyphen.');
  }
  return value;
}

function readSecret(raw: string | undefined): string {
  return (raw ?? '').trim();
}

function readBool(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function readBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}
