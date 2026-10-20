import { publicAiError, type AiErrorCode } from './ai.errors';
import { UNAVAILABLE_USAGE, type AiCompletionRequest, type AiCompletionResponse, type AiProvider } from './ai.types';

export type MockScenario =
  | { type: 'json'; body: unknown }
  | { type: 'text'; body: string }
  | { type: 'error'; code: Extract<AiErrorCode, 'PROVIDER_UNAVAILABLE' | 'RATE_LIMITED' | 'TIMEOUT'> }
  | { type: 'wait-for-abort' };

const MOCK_MODEL = 'flowops-mock';

export class MockAiProvider implements AiProvider {
  readonly id = 'mock' as const;
  private scenario: MockScenario = { type: 'error', code: 'PROVIDER_UNAVAILABLE' };
  private completeCalls = 0;
  lastRequest: AiCompletionRequest | null = null;

  use(scenario: MockScenario): void {
    this.scenario = scenario;
  }

  callCount(): number {
    return this.completeCalls;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    this.completeCalls += 1;
    this.lastRequest = request;
    if (typeof fetch !== 'undefined') {
      // Guardrail: this provider must never perform HTTP.
    }
    const scenario = this.scenario;
    if (scenario.type === 'error') {
      throw publicAiError(scenario.code);
    }
    if (scenario.type === 'wait-for-abort') {
      await waitForAbort(request.signal);
      throw publicAiError('CANCELLED');
    }
    const rawText = scenario.type === 'text' ? scenario.body : JSON.stringify(scenario.body);
    return {
      rawText,
      provider: this.id,
      model: MOCK_MODEL,
      usage: {
        provider: this.id,
        model: MOCK_MODEL,
        ...UNAVAILABLE_USAGE,
      },
    };
  }
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!signal) {
      reject(publicAiError('PROVIDER_UNAVAILABLE'));
      return;
    }
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
