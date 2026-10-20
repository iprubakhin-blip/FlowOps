import { loadAiConfig } from './ai.config';
import { ILLUSTRATIVE_NOTE_SCHEMA } from './ai.fixtures';
import { AiService } from './ai.service';
import { OpenAiProvider, type OpenAiCreateFn } from './openai-ai.provider';

export interface AiSmokeEnv {
  AI_LIVE_SMOKE?: string;
  AI_ENABLED?: string;
  AI_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  AI_MODEL?: string;
  AI_MAX_OUTPUT_TOKENS?: string;
  AI_REQUEST_TIMEOUT_MS?: string;
  [key: string]: string | undefined;
}

export interface AiSmokeReport {
  ok: boolean;
  reason: string;
  contactedProvider: boolean;
  provider?: string;
  model?: string;
  usageAvailable?: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedInputTokens?: number | null;
  estimatedCostUsd?: number | null;
  costNote?: string | null;
}

export interface AiSmokeResult {
  exitCode: number;
  report: AiSmokeReport;
}

const SYNTHETIC_INPUT = 'Return one illustrative JSON note titled Smoke check with medium priority.';

export async function runAiSmoke(options: {
  env?: AiSmokeEnv;
  create?: OpenAiCreateFn;
} = {}): Promise<AiSmokeResult> {
  const env = options.env ?? process.env;
  if (env.AI_LIVE_SMOKE !== 'true') {
    return {
      exitCode: 2,
      report: {
        ok: false,
        reason: 'Live AI smoke is disabled. Set AI_LIVE_SMOKE=true after explicit approval. No provider was contacted.',
        contactedProvider: false,
      },
    };
  }

  const previous = snapshotAiEnv();
  applyEnv(env);
  let provider: OpenAiProvider | undefined;
  try {
    const config = loadAiConfig();
    if (!config.enabled) {
      return disabled('AI_ENABLED is not true. No provider was contacted.');
    }
    if (config.provider !== 'openai') {
      return disabled('AI_PROVIDER must be openai for live smoke. No provider was contacted.');
    }
    if (config.openaiApiKey === '') {
      return disabled('OPENAI_API_KEY is missing. No provider was contacted.');
    }

    let transportCalls = 0;
    const create = options.create
      ? async (body: Parameters<OpenAiCreateFn>[0], createOptions?: Parameters<OpenAiCreateFn>[1]) => {
          transportCalls += 1;
          return options.create!(body, createOptions);
        }
      : undefined;

    provider = new OpenAiProvider({
      apiKey: config.openaiApiKey,
      model: config.model,
      timeoutMs: Math.min(config.requestTimeoutMs, 20_000),
      create,
    });
    const service = new AiService(provider);
    const result = await service.generateStructured({
      systemInstruction: 'Return JSON that matches the registered illustrative.note schema. Use synthetic data only.',
      userInput: SYNTHETIC_INPUT,
      schemaName: 'illustrative.note',
      schema: ILLUSTRATIVE_NOTE_SCHEMA,
      maxOutputTokens: Math.min(64, config.maxOutputTokens),
    });
    return {
      exitCode: 0,
      report: {
        ok: true,
        reason: 'One synthetic structured request completed. Token counts are provider measurements; cost is estimated.',
        contactedProvider: create ? transportCalls > 0 : provider.callCount() > 0,
        provider: result.usage.provider,
        model: result.usage.model,
        usageAvailable: result.usage.usageAvailable,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        estimatedCostUsd: result.usage.cost.amountUsd,
        costNote: result.usage.cost.note,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The smoke request failed.';
    return {
      exitCode: 1,
      report: {
        ok: false,
        reason: redactSecrets(message),
        contactedProvider: (provider?.callCount() ?? 0) > 0,
      },
    };
  } finally {
    restoreEnv(previous);
  }
}

function disabled(reason: string): AiSmokeResult {
  return { exitCode: 2, report: { ok: false, reason, contactedProvider: false } };
}

function redactSecrets(message: string): string {
  return message.replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

const AI_ENV_KEYS = [
  'AI_LIVE_SMOKE',
  'AI_ENABLED',
  'AI_PROVIDER',
  'OPENAI_API_KEY',
  'AI_MODEL',
  'AI_MAX_OUTPUT_TOKENS',
  'AI_REQUEST_TIMEOUT_MS',
  'AI_MAX_INPUT_CHARS',
  'AI_MAX_REQUESTS_PER_USER_DAY',
];

function snapshotAiEnv(): Record<string, string | undefined> {
  return Object.fromEntries(AI_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function applyEnv(env: AiSmokeEnv): void {
  for (const key of AI_ENV_KEYS) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
