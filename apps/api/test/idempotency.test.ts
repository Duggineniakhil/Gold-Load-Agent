import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { canonicalJson, requestHash } from '../src/domain/idempotency.js';
import { createLeadRepository } from '../src/repositories/lead-repository.js';
import { createLoanSchemeRepository } from '../src/repositories/loan-scheme-repository.js';
import { clearTestDatabase, closeTestDatabase, openTestDatabase } from './helpers/database.js';
import { fixedGoldRate, seededSchemes } from './helpers/fixtures.js';

let prisma: PrismaClient;

const payload = {
  name: 'Akhil Kumar',
  mobileNumber: '9876543210',
  grossWeightGrams: 50,
  netWeightGrams: 45,
  karat: 22,
  planId: 'PLAN_EMI_01',
};

const app = () =>
  createApp({
    loanSchemeRepository: createLoanSchemeRepository(prisma),
    leadRepository: createLeadRepository(prisma),
    goldRate: fixedGoldRate(),
    logger: pino({ enabled: false }),
  });

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

describe('request hashing', () => {
  it('ignores object key order but not values', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[1,2]},"b":1}',
    );
    expect(requestHash({ a: 1, b: 2 })).toBe(requestHash({ b: 2, a: 1 }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: '1' }));
  });
});

describe('POST /api/v1/leads with Idempotency-Key', () => {
  it('spec case 7: the same request with the same key replays the original 201', async () => {
    const api = app();
    const first = await request(api)
      .post('/api/v1/leads')
      .set('Idempotency-Key', 'key-case-7')
      .send(payload)
      .expect(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    const reordered = Object.fromEntries(Object.entries(payload).reverse());
    const retry = await request(api)
      .post('/api/v1/leads')
      .set('Idempotency-Key', 'key-case-7')
      .send(reordered)
      .expect(201);

    expect(retry.headers['idempotency-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(await prisma.lead.count()).toBe(1);
  });

  it('rejects the same key with a different body with 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const api = app();
    await request(api)
      .post('/api/v1/leads')
      .set('Idempotency-Key', 'key-reused')
      .send(payload)
      .expect(201);

    const response = await request(api)
      .post('/api/v1/leads')
      .set('Idempotency-Key', 'key-reused')
      .send({ ...payload, netWeightGrams: 40 })
      .expect(422);

    expect(response.body).toEqual({
      error: {
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'This Idempotency-Key was already used with a different request body.',
        fields: [],
      },
    });
    expect(await prisma.lead.count()).toBe(1);
  });

  it('creates one lead for concurrent requests with the same key and replays it to the rest', async () => {
    const api = app();
    for (let round = 0; round < 10; round += 1) {
      const body = { ...payload, mobileNumber: `90000000${String(round).padStart(2, '0')}` };
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(api).post('/api/v1/leads').set('Idempotency-Key', `race-${round}`).send(body),
        ),
      );

      expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(responses.map((response) => response.body.applicationId)).size).toBe(1);
      expect(
        responses.filter((response) => response.headers['idempotency-replayed'] === 'true'),
      ).toHaveLength(4);
    }
    expect(await prisma.lead.count()).toBe(10);
    expect(await prisma.idempotencyRecord.count()).toBe(10);
  }, 60000);

  it('still blocks a repeat mobile within 7 days when the retry uses a new key', async () => {
    const api = app();
    await request(api)
      .post('/api/v1/leads')
      .set('Idempotency-Key', 'first-key')
      .send(payload)
      .expect(201);
    const second = await request(api)
      .post('/api/v1/leads')
      .set('Idempotency-Key', 'second-key')
      .send(payload)
      .expect(409);
    expect(second.body.error.code).toBe('DUPLICATE_APPLICATION');
  });

  it('does not store failed requests, so the same key can be retried after a fix', async () => {
    const api = app();
    await request(api)
      .post('/api/v1/leads')
      .set('Idempotency-Key', 'fix-and-retry')
      .send({ ...payload, planId: 'PLAN_UNKNOWN' })
      .expect(404);
    expect(await prisma.idempotencyRecord.count()).toBe(0);
  });

  it('validates the header', async () => {
    const response = await request(app())
      .post('/api/v1/leads')
      .set('Idempotency-Key', 'has spaces')
      .send(payload)
      .expect(400);
    expect(response.body.error.fields).toEqual([
      { field: 'Idempotency-Key', message: 'Use 1–255 printable characters without spaces.' },
    ]);
  });
});
