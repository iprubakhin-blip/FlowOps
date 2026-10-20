import 'reflect-metadata';
import { Inject, Injectable } from '@nestjs/common';
import { loadAiConfig, type AiConfig } from './ai.config';
import { AiError, publicAiError } from './ai.errors';
import { getRegisteredSchema } from './ai.registry';
import { clampOutputTokens } from './ai.safeguards';
import { parseProviderJson, validateStructured } from './ai.schema';
import {
  AI_PROVIDER,
  type AiCompletionResponse,
  type AiProvider,
  type AiStructuredResult,
  type StructuredGenerationInput,
} from './ai.types';

export interface AiServiceHooks {
  loadConfig: () => AiConfig;
  timeoutSignal: (ms: number) => AbortSignal;
}

const defaultHooks: AiServiceHooks = {
  loadConfig: loadAiConfig,
  timeoutSignal: (ms) => AbortSignal.timeout(ms),
};

@Injectable()
export class AiService {
  constructor(@Inject(AI_PROVIDER) private readonly provider: AiProvider) {}

  /**
   * Structured generation only. Does not read or write tasks.
   * Callers must pass already-authorized text; this service never
   * accepts ownerId as authority and never talks to PostgreSQL.
   */
  async generateStructured<T>(
    input: StructuredGenerationInput,
    hooks: AiServiceHooks = defaultHooks,
  ): Promise<AiStructuredResult<T>> {
    const config = hooks.loadConfig();
    if (!config.enabled) throw publicAiError('AI_DISABLED');

    const registered = getRegisteredSchema(input.schemaName);
    if (!registered) throw publicAiError('VALIDATION_FAILED');

    const systemInstruction = input.systemInstruction;
    const userInput = input.userInput;
    if (systemInstruction.length > config.maxInputChars || userInput.length > config.maxInputChars) {
      throw publicAiError('INPUT_TOO_LARGE');
    }

    const maxOutputTokens = clampOutputTokens(input.maxOutputTokens, config.maxOutputTokens);

    if (input.signal?.aborted) throw publicAiError('CANCELLED');
    const timeout = hooks.timeoutSignal(config.requestTimeoutMs);
    const combined = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    if (combined.aborted) throw publicAiError(input.signal?.aborted ? 'CANCELLED' : 'TIMEOUT');

    let completion: AiCompletionResponse;
    try {
      completion = await awaitWithAbort(
        this.provider.complete({
          systemInstruction,
          userInput,
          schemaName: input.schemaName,
          jsonSchema: registered.providerJsonSchema,
          formatName: registered.providerFormatName,
          maxOutputTokens,
          signal: combined,
        }),
        combined,
        input.signal,
      );
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw publicAiError('PROVIDER_UNAVAILABLE');
    }

    const parsed = parseProviderJson(completion.rawText);
    validateStructured(parsed, registered.runtimeSchema);
    const output = validateStructured<T>(parsed, input.schema);
    return { output, schemaName: input.schemaName, usage: completion.usage };
  }
}

function awaitWithAbort<T>(work: Promise<T>, signal: AbortSignal, userSignal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: (value: T | unknown) => void, value: T | unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      finish(reject, publicAiError(userSignal?.aborted ? 'CANCELLED' : 'TIMEOUT'));
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    work.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

Reflect.defineMetadata('design:paramtypes', [Object], AiService);
