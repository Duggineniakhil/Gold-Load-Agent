import type { Logger } from 'pino';
import type { env as appEnv } from '../config/env.js';
import {
  createFallbackClient,
  createOpenAiCompatibleClient,
  type LlmClient,
} from './llm-client.js';

/**
 * The primary provider (LLM_*) with an optional fallback (LLM_FALLBACK_*). With a fallback
 * configured, the primary retries once instead of three times so a busy provider is skipped
 * quickly. Returns undefined when neither key is set, which disables Loan Assist.
 */
export function createLlmFromEnv(env: typeof appEnv, logger: Logger): LlmClient | undefined {
  const apiKey = env.LLM_API_KEY.trim();
  const fallbackApiKey = env.LLM_FALLBACK_API_KEY.trim();
  const hasFallback = Boolean(fallbackApiKey);
  const providers = [
    ...(apiKey
      ? [
          {
            name: env.LLM_MODEL,
            client: createOpenAiCompatibleClient({
              baseUrl: env.LLM_BASE_URL,
              apiKey,
              model: env.LLM_MODEL,
              timeoutMs: env.LLM_TIMEOUT_MS,
              maxRetries: hasFallback ? 1 : 3,
            }),
          },
        ]
      : []),
    ...(hasFallback
      ? [
          {
            name: env.LLM_FALLBACK_MODEL,
            client: createOpenAiCompatibleClient({
              baseUrl: env.LLM_FALLBACK_BASE_URL,
              apiKey: fallbackApiKey,
              model: env.LLM_FALLBACK_MODEL,
              timeoutMs: env.LLM_TIMEOUT_MS,
              standardMessages: true,
            }),
          },
        ]
      : []),
  ];
  if (providers.length === 0) return undefined;
  if (providers.length === 1) return providers[0]!.client;
  return createFallbackClient(providers, ({ from, to, detail }) =>
    logger.warn({ from, to, detail }, 'LLM provider unavailable, falling back'),
  );
}
