import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import {
  LlmUnavailableError,
  type AssistantMessage,
  type ChatMessage,
  type LlmClient,
} from '../src/agent/llm-client.js';
import { createLeadRepository } from '../src/repositories/lead-repository.js';
import { createLoanSchemeRepository } from '../src/repositories/loan-scheme-repository.js';
import {
  confirmationPrompt,
  createAgentService,
  unverifiedFiguresReply,
} from '../src/services/agent-service.js';
import { clearTestDatabase, closeTestDatabase, openTestDatabase } from './helpers/database.js';
import { fixedGoldRate, seededSchemes } from './helpers/fixtures.js';

let prisma: PrismaClient;

type Step = (messages: ChatMessage[]) => AssistantMessage;

/** A fake model that plays back a script and records every request it receives. */
function scriptedLlm(steps: Step[]) {
  const requests: ChatMessage[][] = [];
  const llm: LlmClient = {
    complete: async ({ messages }) => {
      requests.push(structuredClone(messages));
      const step = steps.shift();
      if (!step) throw new Error('The model was called more times than scripted.');
      return step(messages);
    },
  };
  return { llm, requests };
}

const callTool =
  (name: string, args: unknown, id = 'call_1'): Step =>
  () => ({
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
        extra_content: { google: { thought_signature: `sig-${id}` } },
      },
    ],
  });
const say =
  (text: string): Step =>
  () => ({ role: 'assistant', content: text });

const application = {
  name: 'Ravi Kumar',
  mobileNumber: '9876500011',
  grossWeightGrams: '50',
  netWeightGrams: '45',
  karat: 22,
  planId: 'PLAN_EMI_01',
};
const applyMessage = 'Apply for EMI. Ravi Kumar, 98765 00011, 45 g net, 50 g gross, 22K.';

function setup(steps: Step[]) {
  const { llm, requests } = scriptedLlm(steps);
  const loanSchemeRepository = createLoanSchemeRepository(prisma);
  const leadRepository = createLeadRepository(prisma);
  const goldRate = fixedGoldRate(env.GOLD_RATE_24K_PAISE_PER_GRAM);
  const logger = pino({ enabled: false });
  const agent = createAgentService({
    llm,
    loanSchemeRepository,
    leadRepository,
    goldRate,
    logger,
  });
  const app = createApp({
    loanSchemeRepository,
    leadRepository,
    goldRate,
    agent,
    logger,
  });
  return { agent, app, requests };
}

const lastToolResult = (messages: ChatMessage[]) => {
  const tool = messages.filter((message) => message.role === 'tool').at(-1);
  return JSON.parse(tool?.content ?? 'null');
};

beforeAll(async () => {
  prisma = await openTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase(prisma);
  await prisma.loanScheme.createMany({ data: seededSchemes });
});

afterAll(async () => {
  await closeTestDatabase(prisma);
});

describe('Loan Assist agent', () => {
  it('quotes through the tool and sends provider tool-call fields back unchanged', async () => {
    const { agent, requests } = setup([
      callTool('calculate_quote', { netWeightGrams: '45', grossWeightGrams: '50', karat: 22 }),
      (messages) => {
        const quote = lastToolResult(messages);
        expect(quote).toMatchObject({ pureGoldGrams: '41.250', goldValue: '₹2,88,750' });
        return say(`EMI: ${quote.plans[1].eligibleLoan}. Bullet: ${quote.plans[0].eligibleLoan}.`)(
          messages,
        );
      },
    ]);

    const turn = await agent.sendMessage({
      message: 'I have 45 g net, 50 g gross, 22 carat. How much?',
    });

    expect(turn.reply).toBe('EMI: ₹2,16,562. Bullet: ₹2,02,125.');
    expect(turn.toolEvents).toEqual([{ tool: 'calculate_quote', ok: true }]);
    expect(turn.pendingConfirmation).toBeNull();
    const echoed = requests[1]?.find((message) => message.role === 'assistant') as AssistantMessage;
    expect(echoed.tool_calls?.[0]?.extra_content).toEqual({
      google: { thought_signature: 'sig-call_1' },
    });
  });

  it('feeds invalid tool arguments back to the model as field errors', async () => {
    const { agent } = setup([
      callTool('calculate_quote', { netWeightGrams: '52', grossWeightGrams: '50', karat: 22 }),
      (messages) => {
        expect(lastToolResult(messages).error.fields).toEqual([
          { field: 'netWeightGrams', message: 'Net weight cannot exceed gross weight.' },
        ]);
        return say('Net weight cannot be more than gross weight. Please check both weights.')(
          messages,
        );
      },
    ]);

    const turn = await agent.sendMessage({ message: '52 g net, 50 g gross, 22K' });

    expect(turn.toolEvents).toEqual([{ tool: 'calculate_quote', ok: false }]);
    expect(turn.reply).toMatch(/net weight/i);
  });

  it('refuses tool arguments the borrower never stated, such as an assumed gross weight', async () => {
    const { agent } = setup([
      callTool('calculate_quote', { netWeightGrams: '45', grossWeightGrams: '45', karat: 22 }),
      (messages) => {
        expect(lastToolResult(messages).error).toMatchObject({
          code: 'NOT_PROVIDED_BY_BORROWER',
          fields: [{ field: 'grossWeightGrams', message: 'Not provided by the borrower.' }],
        });
        return say('What is the gross weight of your jewellery?')(messages);
      },
    ]);

    const turn = await agent.sendMessage({
      message: 'I have 45 grams of 22 carat jewellery, how much can I get?',
    });

    expect(turn.toolEvents).toEqual([{ tool: 'calculate_quote', ok: false }]);
    expect(turn.reply).toMatch(/gross weight/);
  });

  it('checks for an existing application with a mobile number the borrower typed', async () => {
    const { agent, app } = setup([
      callTool('check_existing_application', { mobileNumber: '9876500011' }),
      (messages) => {
        const result = lastToolResult(messages);
        expect(result).toMatchObject({
          hasRecentApplication: true,
          applicationId: 'GL-1001',
          status: 'SUBMITTED',
        });
        expect(JSON.stringify(result)).not.toMatch(/[6-9]\d{9}/);
        return say(`You already applied: ${result.applicationId} on ${result.appliedOn}.`)(
          messages,
        );
      },
      callTool('check_existing_application', { mobileNumber: '9123456789' }, 'call_2'),
      (messages) => {
        expect(lastToolResult(messages).error.code).toBe('NOT_PROVIDED_BY_BORROWER');
        return say('Which mobile number did you apply with?')(messages);
      },
    ]);
    await request(app).post('/api/v1/leads').send(application).expect(201);

    const found = await agent.sendMessage({
      message: 'Did I already apply? My mobile is 98765 00011.',
    });
    expect(found.toolEvents).toEqual([{ tool: 'check_existing_application', ok: true }]);
    expect(found.reply).toContain('GL-1001');

    const probing = await agent.sendMessage({
      sessionId: found.sessionId,
      message: 'Check my friend too.',
    });
    expect(probing.toolEvents).toEqual([{ tool: 'check_existing_application', ok: false }]);
  });

  it('files nothing until the borrower confirms, then stores the same lead as the form path', async () => {
    const { app } = setup([callTool('submit_application', application)]);

    const prepared = await request(app)
      .post('/api/v1/agent/messages')
      .send({ message: applyMessage })
      .expect(200);

    expect(prepared.body.reply).toBe(confirmationPrompt);
    expect(prepared.body.pendingConfirmation).toMatchObject({
      mobileNumber: '9876XXXX11',
      planName: 'Monthly EMI',
      pureGoldGrams: '41.250',
      goldValue: '₹2,88,750',
      eligibleLoan: '₹2,16,562',
      ltvPercent: 75,
    });
    expect(await prisma.lead.count()).toBe(0);

    const confirmed = await request(app)
      .post(`/api/v1/agent/sessions/${prepared.body.sessionId}/confirm`)
      .send({ confirm: true })
      .expect(200);
    expect(confirmed.body.submission).toMatchObject({
      outcome: 'submitted',
      applicationId: 'GL-1001',
      status: 'SUBMITTED',
    });
    expect(confirmed.body.reply).toContain('GL-1001');
    expect(confirmed.body.reply).toContain('₹2,16,562');
    expect(confirmed.body.pendingConfirmation).toBeNull();

    await request(app)
      .post('/api/v1/leads')
      .send({ ...application, mobileNumber: '9876500022' })
      .expect(201);

    const [agentLead, formLead] = await prisma.lead.findMany({ orderBy: { applicationId: 'asc' } });
    const comparable = ({
      id,
      applicationId,
      mobileNumber,
      createdAt,
      updatedAt,
      ...rest
    }: NonNullable<typeof agentLead>) => {
      void [id, applicationId, mobileNumber, createdAt, updatedAt];
      return rest;
    };
    expect(comparable(agentLead!)).toEqual(comparable(formLead!));
    expect(agentLead!.eligibleLoanPaise).toBe(21656200n);
  });

  it('cancels without filing and refuses a second settlement', async () => {
    const { agent, app } = setup([callTool('submit_application', application)]);
    const prepared = await agent.sendMessage({ message: applyMessage });

    const cancelled = await agent.confirm(prepared.sessionId, false);
    expect(cancelled.submission).toEqual({ outcome: 'cancelled' });
    expect(await prisma.lead.count()).toBe(0);

    const again = await request(app)
      .post(`/api/v1/agent/sessions/${prepared.sessionId}/confirm`)
      .send({ confirm: true })
      .expect(409);
    expect(again.body.error.code).toBe('NO_PENDING_APPLICATION');
  });

  it('reports a duplicate within 7 days with the existing application ID', async () => {
    const { agent, app } = setup([callTool('submit_application', application)]);
    await request(app).post('/api/v1/leads').send(application).expect(201);

    const prepared = await agent.sendMessage({ message: applyMessage });
    const settled = await agent.confirm(prepared.sessionId, true);

    expect(settled.submission).toMatchObject({ outcome: 'duplicate', applicationId: 'GL-1001' });
    expect(settled.reply).toMatch(/^You already applied on .+, application GL-1001\./);
    expect(await prisma.lead.count()).toBe(1);
  });

  it('drops a pending summary when the borrower sends another message', async () => {
    const { agent } = setup([
      callTool('submit_application', application),
      say('Sure, which plan would you like instead?'),
    ]);
    const prepared = await agent.sendMessage({ message: applyMessage });

    const changed = await agent.sendMessage({
      sessionId: prepared.sessionId,
      message: 'Actually, wait.',
    });

    expect(changed.pendingConfirmation).toBeNull();
    await expect(agent.confirm(prepared.sessionId, true)).rejects.toMatchObject({
      code: 'NO_PENDING_APPLICATION',
    });
  });

  it('asks the model to rewrite a reply containing figures no tool returned', async () => {
    const { agent, requests } = setup([
      say('You can get about ₹3,00,000.'),
      (messages) => {
        expect(messages.at(-1)).toMatchObject({
          role: 'user',
          content: expect.stringContaining('300000'),
        });
        return say('Please tell me the gross weight, net weight and karat so I can calculate it.')(
          messages,
        );
      },
    ]);

    const turn = await agent.sendMessage({ message: 'How much loan can I get?' });

    expect(turn.reply).toMatch(/gross weight/);
    expect(requests).toHaveLength(2);
  });

  it('falls back to a safe reply when the model keeps inventing figures', async () => {
    const { agent } = setup([say('About ₹3,00,000.'), say('Roughly ₹2.5 lakh.')]);

    const turn = await agent.sendMessage({ message: 'How much loan can I get?' });

    expect(turn.reply).toBe(unverifiedFiguresReply);
  });

  it('tells the model about unknown tools instead of failing', async () => {
    const { agent } = setup([
      callTool('approve_loan', {}),
      (messages) => {
        expect(lastToolResult(messages).error.code).toBe('UNKNOWN_TOOL');
        return say('I can only prepare an application for you to confirm.')(messages);
      },
    ]);

    const turn = await agent.sendMessage({ message: 'Approve my loan now' });

    expect(turn.toolEvents).toEqual([{ tool: 'unknown', ok: false }]);
  });

  it('discards a failed turn so the conversation can continue', async () => {
    const { agent, app, requests } = setup([
      callTool('get_loan_schemes', {}),
      () => {
        throw new LlmUnavailableError('HTTP 503');
      },
      say('Hello! How can I help with your gold loan?'),
      say('We offer gold loans. Tell me about your gold.'),
    ]);

    const first = await request(app)
      .post('/api/v1/agent/messages')
      .send({ message: 'Show plans' })
      .expect(503);
    expect(first.body.error).toEqual({
      code: 'LLM_UNAVAILABLE',
      message: 'Loan Assist is temporarily unavailable. Please try again shortly.',
      fields: [],
    });

    const turn = await agent.sendMessage({ message: 'Hi' });
    const next = await agent.sendMessage({ sessionId: turn.sessionId, message: 'What do you do?' });
    expect(next.reply).toMatch(/gold loans/);
    expect(requests[3]?.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
  });

  it('validates agent requests and unknown sessions with the standard error shape', async () => {
    const { app } = setup([]);

    const empty = await request(app)
      .post('/api/v1/agent/messages')
      .send({ message: '   ' })
      .expect(400);
    expect(empty.body.error.fields).toEqual([{ field: 'message', message: 'Type a message.' }]);

    const unknown = await request(app)
      .post('/api/v1/agent/messages')
      .send({ sessionId: '00000000-0000-4000-8000-000000000000', message: 'Hi' })
      .expect(404);
    expect(unknown.body.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('streams only the complete, number-guarded reply as Server-Sent Events', async () => {
    const { app } = setup([say('Tell me about your gold and I can help.')]);

    const response = await request(app)
      .post('/api/v1/agent/messages/stream')
      .send({ message: 'Hello' })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);

    expect(response.text).toContain('event: start');
    expect(response.text).toContain('event: delta');
    expect(response.text).toContain('event: done');
    expect(response.text).toContain('"reply":"Tell me about your gold and I can help."');
  });

  it('answers 503 when no LLM key is configured', async () => {
    const app = createApp({
      loanSchemeRepository: createLoanSchemeRepository(prisma),
      leadRepository: createLeadRepository(prisma),
      goldRate: fixedGoldRate(),
      logger: pino({ enabled: false }),
    });

    const response = await request(app)
      .post('/api/v1/agent/messages')
      .send({ message: 'Hi' })
      .expect(503);
    expect(response.body.error.code).toBe('AGENT_NOT_CONFIGURED');
  });
});
