import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createLeadRepository } from '../src/repositories/lead-repository.js';
import { createLoanSchemeRepository } from '../src/repositories/loan-scheme-repository.js';
import {
  clearTestDatabase,
  closeTestDatabase,
  openTestDatabase,
} from './helpers/database.js';
import { seededSchemes } from './helpers/fixtures.js';

let prisma: PrismaClient;

const basePayload = {
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
    goldRatePaisePerGram: env.GOLD_RATE_24K_PAISE_PER_GRAM,
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

describe('POST /api/v1/leads', () => {
  it.each([
    {
      label: '45 g 22K EMI',
      input: basePayload,
      expectedLoan: 21656200,
    },
    {
      label: '45 g 22K Bullet',
      input: { ...basePayload, planId: 'PLAN_BULLET_01', mobileNumber: '9876543211' },
      expectedLoan: 20212500,
    },
    {
      label: '10 g 18K EMI',
      input: { ...basePayload, netWeightGrams: 10, grossWeightGrams: 12, karat: 18, mobileNumber: '9876543212' },
      expectedLoan: 3937500,
    },
  ])('creates a server-calculated application for $label', async ({ input, expectedLoan }) => {
    const response = await request(app()).post('/api/v1/leads').send(input).expect(201);
    expect(response.body.status).toBe('SUBMITTED');
    expect(response.body.applicationId).toBe('GL-1001');
    expect(response.body.quote.eligibleLoanPaise).toBe(expectedLoan);
    expect(response.body.lead.mobileNumber).toBe(`${input.mobileNumber.slice(0, 4)}XXXX${input.mobileNumber.slice(-2)}`);
    expect(response.body.lead.eligibleLoanPaise).toBe(expectedLoan);
  });

  it('ignores a forged client eligibleLoan and stores the server-calculated value', async () => {
    const response = await request(app())
      .post('/api/v1/leads')
      .send({ ...basePayload, eligibleLoanPaise: 1 })
      .expect(201);
    const stored = await prisma.lead.findUniqueOrThrow({
      where: { applicationId: response.body.applicationId },
    });
    expect(stored.eligibleLoanPaise).toBe(21656200n);
  });

  it('returns validation errors for net over gross and the invalid mobile 5876543210', async () => {
    const response = await request(app())
      .post('/api/v1/leads')
      .send({ ...basePayload, mobileNumber: '5876543210', netWeightGrams: 52, grossWeightGrams: 50 })
      .expect(400);
    expect(response.body.error.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'netWeightGrams' }),
        expect.objectContaining({ field: 'mobileNumber' }),
      ]),
    );
  });

  it('returns a mobileNumber field error for the invalid mobile 98765', async () => {
    const response = await request(app())
      .post('/api/v1/leads')
      .send({ ...basePayload, mobileNumber: '98765' })
      .expect(400);
    expect(response.body.error.fields[0].field).toBe('mobileNumber');
  });

  it('returns 400 for invalid karat', async () => {
    const response = await request(app())
      .post('/api/v1/leads')
      .send({ ...basePayload, karat: 20 })
      .expect(400);
    expect(response.body.error.fields[0].field).toBe('karat');
  });

  it('returns 404 for an unknown plan after validation without occupying the duplicate window', async () => {
    await request(app())
      .post('/api/v1/leads')
      .send({ ...basePayload, planId: 'UNKNOWN_PLAN' })
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('PLAN_NOT_FOUND'));

    await request(app()).post('/api/v1/leads').send(basePayload).expect(201);
  });

  it('does not count a rejected 400 attempt toward duplicate detection', async () => {
    const mobileNumber = '9876543220';
    await request(app())
      .post('/api/v1/leads')
      .send({ ...basePayload, mobileNumber, netWeightGrams: 52, grossWeightGrams: 50 })
      .expect(400);
    await request(app()).post('/api/v1/leads').send({ ...basePayload, mobileNumber }).expect(201);
  });

  it('returns the existing application ID in a duplicate conflict', async () => {
    const created = await request(app()).post('/api/v1/leads').send(basePayload).expect(201);
    const duplicate = await request(app()).post('/api/v1/leads').send(basePayload).expect(409);
    expect(duplicate.body.error).toMatchObject({
      code: 'DUPLICATE_APPLICATION',
      fields: [],
      existing: { applicationId: created.body.applicationId },
    });
    expect(duplicate.body.error.existing.createdAt).toBe(created.body.createdAt);
  });

  it('allows an application when the previous lead is eight days old', async () => {
    await prisma.lead.create({
      data: {
        name: basePayload.name,
        mobileNumber: basePayload.mobileNumber,
        grossWeightMg: 50000,
        netWeightMg: 45000,
        karat: 22,
        schemeId: basePayload.planId,
        goldRatePaisePerGram: 700000n,
        pureGoldMg: 41250,
        goldValuePaise: 28875000n,
        eligibleLoanPaise: 21656200n,
        ltvAppliedBps: 7500,
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
    });

    await request(app()).post('/api/v1/leads').send(basePayload).expect(201);
  });

  it('creates exactly one lead for 2 and 10 concurrent requests, repeated 20 times', async () => {
    const api = app();
    for (let iteration = 0; iteration < 20; iteration += 1) {
      for (const count of [2, 10]) {
        const mobileNumber = count === 2
          ? `90${String(iteration).padStart(8, '0')}`
          : `91${String(iteration).padStart(8, '0')}`;
        const responses = await Promise.all(
          Array.from({ length: count }, () =>
            request(api).post('/api/v1/leads').send({ ...basePayload, mobileNumber }),
          ),
        );
        expect(responses.filter(({ status }) => status === 201)).toHaveLength(1);
        expect(responses.filter(({ status }) => status === 409)).toHaveLength(count - 1);
      }
    }
  }, 120000);
});

describe('GET /api/v1/leads', () => {
  it('masks mobile numbers and lists newest first', async () => {
    await prisma.lead.createMany({
      data: [
        {
          name: 'Older Lead', mobileNumber: '9876543210', grossWeightMg: 50000, netWeightMg: 45000,
          karat: 22, schemeId: 'PLAN_EMI_01', goldRatePaisePerGram: 700000n, pureGoldMg: 41250,
          goldValuePaise: 28875000n, eligibleLoanPaise: 21656200n, ltvAppliedBps: 7500,
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
        },
        {
          name: 'Newer Lead', mobileNumber: '9876543211', grossWeightMg: 50000, netWeightMg: 45000,
          karat: 22, schemeId: 'PLAN_BULLET_01', goldRatePaisePerGram: 700000n, pureGoldMg: 41250,
          goldValuePaise: 28875000n, eligibleLoanPaise: 20212500n, ltvAppliedBps: 7000,
          createdAt: new Date('2025-01-02T00:00:00.000Z'),
        },
      ],
    });

    const response = await request(app()).get('/api/v1/leads').expect(200);
    expect(response.body.items.map((item: { mobileNumber: string }) => item.mobileNumber)).toEqual([
      '9876XXXX11',
      '9876XXXX10',
    ]);
    expect(response.body.items[0]).toMatchObject({
      name: 'Newer Lead',
      planId: 'PLAN_BULLET_01',
      planName: 'Bullet Repayment',
      netWeightGrams: 45,
      eligibleLoanPaise: 20212500,
      status: 'SUBMITTED',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/[6-9]\d{9}/);
  });

  it('filters by plan and paginates with a cursor', async () => {
    const createdAt = (day: number) => new Date(`2025-02-${String(day).padStart(2, '0')}T00:00:00.000Z`);
    await prisma.lead.createMany({
      data: [
        ...[1, 2, 3].map((day) => ({
          name: 'EMI Lead', mobileNumber: `98765432${String(day).padStart(2, '0')}`,
          grossWeightMg: 50000, netWeightMg: 45000, karat: 22, schemeId: 'PLAN_EMI_01',
          goldRatePaisePerGram: 700000n, pureGoldMg: 41250, goldValuePaise: 28875000n,
          eligibleLoanPaise: 21656200n, ltvAppliedBps: 7500, createdAt: createdAt(day),
        })),
        {
          name: 'Bullet Lead', mobileNumber: '9876543299', grossWeightMg: 50000, netWeightMg: 45000,
          karat: 22, schemeId: 'PLAN_BULLET_01', goldRatePaisePerGram: 700000n, pureGoldMg: 41250,
          goldValuePaise: 28875000n, eligibleLoanPaise: 20212500n, ltvAppliedBps: 7000,
          createdAt: createdAt(4),
        },
      ],
    });

    const firstPage = await request(app()).get('/api/v1/leads?planId=PLAN_EMI_01&limit=2').expect(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.items.every((item: { planId: string }) => item.planId === 'PLAN_EMI_01')).toBe(true);
    expect(firstPage.body.nextCursor).toBeTruthy();

    const secondPage = await request(app())
      .get(`/api/v1/leads?planId=PLAN_EMI_01&limit=2&cursor=${firstPage.body.nextCursor}`)
      .expect(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.nextCursor).toBeNull();
  });
});
