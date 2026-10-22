import {
  existingApplicationRequestSchema,
  leadRequestSchema,
  quoteRequestSchema,
} from '@tglobal/shared';
import { describe, expect, it } from 'vitest';
import {
  createFallbackClient,
  createOpenAiCompatibleClient,
  LlmUnavailableError,
  type LlmClient,
} from '../src/agent/llm-client.js';
import { extractNumbers, findUnsupportedNumbers } from '../src/agent/number-guard.js';
import { toolDefinitions, ungroundedFields } from '../src/agent/tools.js';

describe('number guard', () => {
  it('normalises Indian grouping and trailing decimal zeros', () => {
    expect([...extractNumbers('₹2,16,562 for 41.250 g at 10.50%')]).toEqual([
      '216562',
      '41.25',
      '10.5',
    ]);
  });

  it('accepts figures copied from tool results and the user', () => {
    const toolResult = JSON.stringify({
      goldValue: '₹2,88,750',
      pureGoldGrams: '41.250',
      eligibleLoan: '₹2,16,562',
    });
    const reply =
      'Your 45 g of 22K gold has 41.25 g pure gold worth ₹2,88,750. You can get ₹2,16,562.';
    expect(findUnsupportedNumbers(reply, [toolResult, 'I have 45 grams of 22 carat'])).toEqual([]);
  });

  it('flags figures the model produced itself, including lakh conversions', () => {
    const toolResult = JSON.stringify({ eligibleLoan: '₹2,16,562' });
    expect(findUnsupportedNumbers('That is about ₹2.17 lakh, or ₹2,16,600.', [toolResult])).toEqual(
      ['2.17', '216600'],
    );
  });

  it('ignores list markers', () => {
    expect(findUnsupportedNumbers('1. Bullet\n2. Monthly EMI', [])).toEqual([]);
  });
});

describe('borrower grounding of tool arguments', () => {
  it('accepts values the borrower typed, including a spaced mobile number', () => {
    const args = {
      netWeightGrams: '45.5',
      grossWeightGrams: '50',
      karat: 22,
      mobileNumber: '9876500011',
    };
    expect(ungroundedFields(args, 'net 45.50 g, gross 50g, 22K. Call me on 98765 00011')).toEqual(
      [],
    );
  });

  it('flags values the model filled in itself', () => {
    const args = {
      netWeightGrams: '45',
      grossWeightGrams: '45',
      karat: 22,
      mobileNumber: '9876500011',
    };
    expect(ungroundedFields(args, 'I have 45 grams of 22 carat jewellery')).toEqual([
      'grossWeightGrams',
      'mobileNumber',
    ]);
    expect(ungroundedFields(args, 'Net 45 g, gross 45 g, 22K, mobile 9876500011')).toEqual([]);
    expect(
      ungroundedFields(
        { ...args, grossWeightGrams: '48' },
        'I have 45 grams of 22 carat jewellery',
      ),
    ).toEqual(['grossWeightGrams', 'mobileNumber']);
  });
});

describe('tool definitions', () => {
  const parameters = (name: string) =>
    toolDefinitions.find((tool) => tool.function.name === name)?.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };

  it.each([
    ['calculate_quote', quoteRequestSchema],
    ['check_existing_application', existingApplicationRequestSchema],
    ['submit_application', leadRequestSchema],
  ] as const)('%s advertises exactly the fields its Zod schema validates', (name, schema) => {
    const zodFields = Object.keys(schema.shape).sort();
    expect(Object.keys(parameters(name).properties).sort()).toEqual(zodFields);
    expect([...parameters(name).required].sort()).toEqual(zodFields);
  });
});

describe('OpenAI-compatible LLM client', () => {
  const okBody = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_loan_schemes', arguments: '{}' },
              extra_content: { google: { thought_signature: 'sig' } },
            },
          ],
        },
      },
    ],
  };

  function client(responses: Response[]) {
    const requests: RequestInit[] = [];
    const llm = createOpenAiCompatibleClient({
      baseUrl: 'https://llm.test/v1/',
      apiKey: 'test-key',
      model: 'test-model',
      timeoutMs: 1000,
      retryDelayMs: 1,
      fetch: async (_url, init) => {
        requests.push(init ?? {});
        const next = responses.shift();
        if (!next) throw new Error('No more responses');
        return next;
      },
    });
    return { llm, requests };
  }

  it('retries overloaded responses and keeps provider fields on tool calls', async () => {
    const { llm, requests } = client([
      new Response('busy', { status: 503 }),
      new Response(JSON.stringify(okBody), { status: 200 }),
    ]);
    const message = await llm.complete({ messages: [{ role: 'user', content: 'hi' }], tools: [] });
    expect(requests).toHaveLength(2);
    expect(message.tool_calls?.[0]).toMatchObject({
      id: 'call_1',
      extra_content: { google: { thought_signature: 'sig' } },
    });
    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      model: 'test-model',
      temperature: 0,
    });
  });

  it('waits as long as Retry-After asks before retrying a 429', async () => {
    const { llm, requests } = client([
      new Response('slow down', { status: 429, headers: { 'retry-after': '0.05' } }),
      new Response(JSON.stringify(okBody), { status: 200 }),
    ]);
    const started = Date.now();
    await llm.complete({ messages: [], tools: [] });
    expect(requests).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  it('fails without retrying on a client error, keeping the detail out of the public message', async () => {
    const { llm, requests } = client([new Response('bad key', { status: 401 })]);
    const failure = llm.complete({ messages: [], tools: [] });
    await expect(failure).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(failure).rejects.toMatchObject({ detail: 'HTTP 401: bad key', statusCode: 503 });
    expect(requests).toHaveLength(1);
  });
});

describe('LLM provider fallback', () => {
  const reply = (content: string): LlmClient => ({
    complete: async () => ({ role: 'assistant', content }),
  });
  const down = (detail: string): LlmClient => ({
    complete: async () => {
      throw new LlmUnavailableError(detail);
    },
  });

  it('uses the next provider only when the current one is unavailable', async () => {
    const events: unknown[] = [];
    const llm = createFallbackClient(
      [
        { name: 'gemini', client: down('HTTP 503') },
        { name: 'groq', client: reply('from groq') },
      ],
      (event) => events.push(event),
    );
    await expect(llm.complete({ messages: [], tools: [] })).resolves.toMatchObject({
      content: 'from groq',
    });
    expect(events).toEqual([{ from: 'gemini', to: 'groq', detail: 'HTTP 503' }]);
  });

  it('does not hide programming errors behind a fallback', async () => {
    const broken: LlmClient = {
      complete: async () => {
        throw new TypeError('bug');
      },
    };
    const llm = createFallbackClient([
      { name: 'gemini', client: broken },
      { name: 'groq', client: reply('unused') },
    ]);
    await expect(llm.complete({ messages: [], tools: [] })).rejects.toBeInstanceOf(TypeError);
  });

  it('reports the last provider error when every provider is down', async () => {
    const llm = createFallbackClient([
      { name: 'gemini', client: down('HTTP 503') },
      { name: 'groq', client: down('HTTP 429') },
    ]);
    await expect(llm.complete({ messages: [], tools: [] })).rejects.toMatchObject({
      detail: 'HTTP 429',
    });
  });

  it('sends and keeps only standard fields for a non-Gemini provider', async () => {
    const requests: RequestInit[] = [];
    const llm = createOpenAiCompatibleClient({
      baseUrl: 'https://llm.test/v1/',
      apiKey: 'test-key',
      model: 'fallback-model',
      timeoutMs: 1000,
      standardMessages: true,
      fetch: async (_url, init) => {
        requests.push(init ?? {});
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'ok',
                  reasoning: 'private chain of thought',
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const message = await llm.complete({
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'get_loan_schemes', arguments: '{}' },
              extra_content: { google: { thought_signature: 'sig' } },
            },
          ],
        },
      ],
      tools: [],
    });

    const sent = JSON.parse(String(requests[0]?.body));
    expect(sent.messages[0].tool_calls[0]).toEqual({
      id: 'c1',
      type: 'function',
      function: { name: 'get_loan_schemes', arguments: '{}' },
    });
    expect(message).toEqual({ role: 'assistant', content: 'ok' });
  });
});
