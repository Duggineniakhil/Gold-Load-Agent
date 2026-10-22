import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  // Provider-specific fields (Gemini's thought signatures) must be sent back untouched.
  [extra: string]: unknown;
};

export type AssistantMessage = {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
  [extra: string]: unknown;
};

export type MultimodalContent =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string | MultimodalContent[] }
  | AssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export interface LlmClient {
  complete(request: {
    messages: ChatMessage[];
    tools: ToolDefinition[];
  }): Promise<AssistantMessage>;
}

export class LlmUnavailableError extends AppError {
  /** Provider detail for server logs only; never sent to the client. */
  constructor(readonly detail: string) {
    super(
      503,
      'LLM_UNAVAILABLE',
      'Loan Assist is temporarily unavailable. Please try again shortly.',
    );
  }
}

type ClientOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries?: number;
  retryDelayMs?: number;
  /**
   * Send and keep only standard OpenAI message fields. For providers other than Gemini:
   * Gemini's thought signatures are dropped on the way out, and fields such as Groq's
   * `reasoning` never enter the conversation history.
   */
  standardMessages?: boolean;
  fetch?: typeof fetch;
};

const retryableStatus = new Set([408, 429, 500, 502, 503, 504]);

/** Chat-completions client for any OpenAI-compatible endpoint (Gemini's included). */
export function createOpenAiCompatibleClient(options: ClientOptions): LlmClient {
  const doFetch = options.fetch ?? fetch;
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const url = new URL('chat/completions', options.baseUrl);

  return {
    async complete({ messages, tools }) {
      for (let attempt = 0; ; attempt += 1) {
        let response: Response;
        try {
          response = await doFetch(url, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${options.apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: options.model,
              messages: options.standardMessages ? messages.map(toStandardMessage) : messages,
              tools,
              temperature: 0,
            }),
            signal: AbortSignal.timeout(options.timeoutMs),
          });
        } catch (error) {
          if (attempt < maxRetries) {
            await delay(retryDelayMs * 2 ** attempt);
            continue;
          }
          throw new LlmUnavailableError(error instanceof Error ? error.message : 'Request failed');
        }

        if (retryableStatus.has(response.status) && attempt < maxRetries) {
          // Honour the provider's Retry-After (seconds) when it asks for longer than our backoff.
          const retryAfterMs = Number(response.headers.get('retry-after')) * 1000;
          const backoffMs = retryDelayMs * 2 ** attempt;
          await delay(
            Math.min(Math.max(backoffMs, Number.isFinite(retryAfterMs) ? retryAfterMs : 0), 20_000),
          );
          continue;
        }
        if (!response.ok) {
          throw new LlmUnavailableError(
            `HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`,
          );
        }

        const body = (await response.json()) as { choices?: { message?: AssistantMessage }[] };
        const message = body.choices?.[0]?.message;
        if (!message) throw new LlmUnavailableError('Response contained no message');
        if (options.standardMessages) return toStandardMessage(message) as AssistantMessage;
        return {
          ...message,
          role: 'assistant',
          content: message.content ?? null,
          ...(message.tool_calls?.length
            ? {
                tool_calls: message.tool_calls.map((call) => ({
                  ...call,
                  id: call.id || randomUUID(),
                })),
              }
            : {}),
        };
      }
    },
  };
}

function toStandardMessage(message: ChatMessage): ChatMessage {
  if (message.role !== 'assistant') return message;
  return {
    role: 'assistant',
    content: message.content ?? null,
    ...(message.tool_calls?.length
      ? {
          tool_calls: message.tool_calls.map((call) => ({
            id: call.id || randomUUID(),
            type: 'function' as const,
            function: { name: call.function.name, arguments: call.function.arguments },
          })),
        }
      : {}),
  };
}

/**
 * Tries each provider in order and moves on only when one is unavailable (after its own
 * retries). Each turn's history is plain chat messages, so providers can take over mid-conversation.
 */
export function createFallbackClient(
  providers: { name: string; client: LlmClient }[],
  onFallback?: (event: { from: string; to: string; detail: string }) => void,
): LlmClient {
  return {
    async complete(request) {
      let lastError: LlmUnavailableError | undefined;
      for (const [index, provider] of providers.entries()) {
        try {
          return await provider.client.complete(request);
        } catch (error) {
          if (!(error instanceof LlmUnavailableError)) throw error;
          lastError = error;
          const next = providers[index + 1];
          if (next) onFallback?.({ from: provider.name, to: next.name, detail: error.detail });
        }
      }
      throw lastError ?? new LlmUnavailableError('No LLM provider is configured');
    },
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
