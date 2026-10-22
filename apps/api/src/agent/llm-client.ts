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

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
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
            body: JSON.stringify({ model: options.model, messages, tools, temperature: 0 }),
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
          await delay(retryDelayMs * 2 ** attempt);
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
