import OpenAI from 'openai';
import { publicAiError, type AiError } from './ai.errors';
import { estimateUsageCost } from './ai.pricing';
import {
  UNAVAILABLE_USAGE,
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiCompletionStatus,
  type AiProvider,
  type AiUsage,
} from './ai.types';

export interface OpenAiCreateOptions {
  signal?: AbortSignal;
}

export type OpenAiCreateFn = (
  body: Record<string, unknown>,
  options?: OpenAiCreateOptions,
) => Promise<unknown>;

export interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  create?: OpenAiCreateFn;
}

interface OpenAiUsageLike {
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
  input_tokens_details?: { cached_tokens?: unknown };
}

interface OpenAiContentLike {
  type?: string;
  text?: string;
  refusal?: string;
}

interface OpenAiOutputItemLike {
  type?: string;
  content?: OpenAiContentLike[];
}

interface OpenAiResponseLike {
  status?: string;
  model?: string;
  output_text?: string;
  output?: OpenAiOutputItemLike[];
  incomplete_details?: { reason?: string };
  error?: { message?: string; code?: string };
  usage?: OpenAiUsageLike;
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai' as const;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly createFn: OpenAiCreateFn;
  private client: OpenAI | undefined;
  private completeCalls = 0;
  lastRequestBody: Record<string, unknown> | null = null;

  constructor(options: OpenAiProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.createFn = options.create ?? ((body, createOptions) => this.sdkCreate(body, createOptions));
  }

  callCount(): number {
    return this.completeCalls;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    this.completeCalls += 1;
    if (request.signal?.aborted) throw publicAiError('CANCELLED');
    if (!request.jsonSchema || !request.formatName) {
      throw publicAiError('VALIDATION_FAILED');
    }

    const body: Record<string, unknown> = {
      model: this.model,
      instructions: request.systemInstruction,
      input: request.userInput,
      max_output_tokens: request.maxOutputTokens,
      store: false,
      background: false,
      text: {
        format: {
          type: 'json_schema',
          name: request.formatName,
          strict: true,
          schema: request.jsonSchema,
        },
      },
    };
    this.lastRequestBody = body;

    let raw: unknown;
    try {
      raw = await this.createFn(body, { signal: request.signal });
    } catch (error) {
      throw mapProviderError(error, request.signal);
    }

    const response = (raw ?? {}) as OpenAiResponseLike;
    if (response.status === 'failed') throw publicAiError('PROVIDER_UNAVAILABLE');
    if (response.status === 'incomplete' || response.incomplete_details?.reason) {
      throw publicAiError('INCOMPLETE');
    }

    const refusal = extractRefusal(response);
    if (refusal !== null) throw publicAiError('REFUSAL');

    const rawText = extractOutputText(response);
    if (rawText === '') throw publicAiError('INVALID_PROVIDER_RESPONSE');

    const model = typeof response.model === 'string' && response.model !== '' ? response.model : this.model;
    return {
      rawText,
      provider: this.id,
      model,
      usage: mapUsage(this.id, model, response),
    };
  }

  private async sdkCreate(body: Record<string, unknown>, options?: OpenAiCreateOptions): Promise<unknown> {
    this.client ??= new OpenAI({
      apiKey: this.apiKey,
      timeout: this.timeoutMs,
      maxRetries: 0,
    });
    return this.client.responses.create(body as never, { signal: options?.signal });
  }
}

function extractRefusal(response: OpenAiResponseLike): string | null {
  for (const item of response.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === 'refusal' || (typeof part.refusal === 'string' && part.refusal !== '')) {
        return part.refusal ?? 'refused';
      }
    }
  }
  return null;
}

function extractOutputText(response: OpenAiResponseLike): string {
  if (typeof response.output_text === 'string' && response.output_text !== '') {
    return response.output_text;
  }
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
    }
  }
  return parts.join('');
}

function mapUsage(provider: string, fallbackModel: string, response: OpenAiResponseLike): AiUsage {
  const usage = response.usage;
  if (!usage) {
    return {
      provider,
      model: fallbackModel,
      ...UNAVAILABLE_USAGE,
      completionStatus: completionStatus(response.status),
    };
  }
  const inputTokens = optionalCount(usage.input_tokens);
  const outputTokens = optionalCount(usage.output_tokens);
  const totalTokens = optionalCount(usage.total_tokens);
  const cachedInputTokens = optionalCount(usage.input_tokens_details?.cached_tokens);
  const usageAvailable = inputTokens !== null || outputTokens !== null || totalTokens !== null;
  const mapped: AiUsage = {
    provider,
    model: fallbackModel,
    usageAvailable,
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    completionStatus: completionStatus(response.status),
    cost: UNAVAILABLE_USAGE.cost,
  };
  mapped.cost = estimateUsageCost(mapped);
  return mapped;
}

function completionStatus(status: string | undefined): AiCompletionStatus {
  if (status === 'completed' || status === 'incomplete' || status === 'failed') return status;
  return 'unknown';
}

function optionalCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function mapProviderError(error: unknown, signal?: AbortSignal): AiError {
  if (isAiError(error)) return error;
  if (signal?.aborted) return publicAiError('CANCELLED');

  const name = errorName(error);
  if (name === 'APIUserAbortError' || name === 'AbortError') return publicAiError('CANCELLED');
  if (name === 'APIConnectionTimeoutError' || name === 'TimeoutError') return publicAiError('TIMEOUT');
  if (name === 'AuthenticationError' || name === 'PermissionDeniedError') return publicAiError('CREDENTIALS');
  if (name === 'RateLimitError') return publicAiError('RATE_LIMITED');
  if (name === 'InternalServerError') return publicAiError('PROVIDER_UNAVAILABLE');

  const status = errorStatus(error);
  if (status === 401 || status === 403) return publicAiError('CREDENTIALS');
  if (status === 429) return publicAiError('RATE_LIMITED');
  if (status === 413) return publicAiError('INPUT_TOO_LARGE');
  if (status !== null && status >= 500) return publicAiError('PROVIDER_UNAVAILABLE');

  const code = errorCode(error);
  if (code === 'ABORT_ERR') return publicAiError('CANCELLED');
  if (code === 'ETIMEDOUT' || code === 'ERR_CANCELED') {
    return code === 'ETIMEDOUT' ? publicAiError('TIMEOUT') : publicAiError('CANCELLED');
  }

  return publicAiError('PROVIDER_UNAVAILABLE');
}

function isAiError(error: unknown): error is AiError {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as AiError).name === 'AiError');
}

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') return error.name;
  return '';
}

function errorStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') return error.status;
  return null;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return '';
}
