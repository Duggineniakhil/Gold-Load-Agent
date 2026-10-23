import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RateLimitOptions } from '../src/rate-limit.js';
import { fakeLeadRepository, fixedGoldRate, seededSchemes } from './helpers/fixtures.js';

function makeApp(
  rateLimits: { leads?: RateLimitOptions; agent?: RateLimitOptions },
  trustProxyHops?: number,
) {
  return createApp({
    loanSchemeRepository: { findActive: async () => seededSchemes },
    leadRepository: fakeLeadRepository(),
    goldRate: fixedGoldRate(),
    logger: pino({ enabled: false }),
    rateLimits,
    trustProxyHops,
  });
}

// Invalid bodies are enough: the limit applies before validation, so every attempt counts.
const postLead = (app: ReturnType<typeof makeApp>) => request(app).post('/api/v1/leads').send({});

describe('rate limits', () => {
  it('answers 429 RATE_LIMITED with Retry-After once POST /leads passes the limit', async () => {
    let clock = 0;
    const app = makeApp({ leads: { max: 2, windowMs: 60_000, now: () => clock } });

    await postLead(app).expect(400);
    await postLead(app).expect(400);
    clock = 15_000;
    const limited = await postLead(app).expect(429);

    expect(limited.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a moment and try again.',
        fields: [],
      },
    });
    expect(limited.headers['retry-after']).toBe('45');
  });

  it('opens again when the window ends and leaves other routes alone', async () => {
    let clock = 0;
    const app = makeApp({ leads: { max: 1, windowMs: 60_000, now: () => clock } });

    await postLead(app).expect(400);
    await postLead(app).expect(429);
    await request(app).post('/api/v1/quotes').send({}).expect(400);
    await request(app).get('/api/v1/loan-schemes').expect(200);

    clock = 60_000;
    await postLead(app).expect(400);
  });

  it('limits the Loan Assist endpoints separately', async () => {
    const app = makeApp({ agent: { max: 1, windowMs: 60_000 } });

    await request(app).post('/api/v1/agent/messages').send({ message: 'Hi' }).expect(503);
    await request(app).post('/api/v1/agent/messages').send({ message: 'Hi' }).expect(429);
    await postLead(app).expect(400);
  });

  it('behind trusted proxies, limits each client by its forwarded address', async () => {
    const app = makeApp({ leads: { max: 1, windowMs: 60_000 } }, 1);
    const from = (client: string) =>
      request(app).post('/api/v1/leads').set('X-Forwarded-For', client).send({});

    await from('203.0.113.1').expect(400);
    await from('203.0.113.2').expect(400);
    await from('203.0.113.1').expect(429);
  });

  it('ignores X-Forwarded-For when no proxy is trusted, so clients cannot dodge the limit', async () => {
    const app = makeApp({ leads: { max: 1, windowMs: 60_000 } });
    const from = (client: string) =>
      request(app).post('/api/v1/leads').set('X-Forwarded-For', client).send({});

    await from('203.0.113.1').expect(400);
    await from('203.0.113.2').expect(429);
  });
});
