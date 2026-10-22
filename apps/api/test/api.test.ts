import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { LoanSchemeRecord } from '../src/repositories/loan-scheme-repository.js';

const seededSchemes: LoanSchemeRecord[] = [
  {
    id: 'PLAN_BULLET_01',
    name: 'Bullet Repayment',
    repaymentType: 'BULLET',
    annualInterestBps: 1200,
    tenureMonths: 12,
    maxLtvBps: 7000,
  },
  {
    id: 'PLAN_EMI_01',
    name: 'Monthly EMI',
    repaymentType: 'EMI',
    annualInterestBps: 1050,
    tenureMonths: 12,
    maxLtvBps: 7500,
  },
];

function makeApp(findActive = async () => seededSchemes) {
  return createApp({
    loanSchemeRepository: { findActive },
    goldRatePaisePerGram: 700000n,
    logger: pino({ enabled: false }),
  });
}

describe('API foundation', () => {
  it('returns health and a request ID', async () => {
    const response = await request(makeApp()).get('/api/v1/health').expect(200, { ok: true });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('returns the two active seeded schemes in API units', async () => {
    const response = await request(makeApp()).get('/api/v1/loan-schemes').expect(200);
    expect(response.body).toEqual([
      {
        id: 'PLAN_BULLET_01',
        name: 'Bullet Repayment',
        annualInterestRate: 12,
        tenureMonths: 12,
        maxLtv: 70,
        repaymentType: 'BULLET',
      },
      {
        id: 'PLAN_EMI_01',
        name: 'Monthly EMI',
        annualInterestRate: 10.5,
        tenureMonths: 12,
        maxLtv: 75,
        repaymentType: 'EMI',
      },
    ]);
  });

  it.each([
    {
      label: '45 g 22K EMI quote',
      input: { netWeightGrams: 45, grossWeightGrams: 50, karat: 22 },
      pureGoldGrams: '41.250',
      goldValuePaise: 28875000,
      bulletLoanPaise: 20212500,
      emiLoanPaise: 21656200,
    },
    {
      label: '45 g 22K Bullet quote',
      input: { netWeightGrams: 45, grossWeightGrams: 50, karat: 22 },
      pureGoldGrams: '41.250',
      goldValuePaise: 28875000,
      bulletLoanPaise: 20212500,
      emiLoanPaise: 21656200,
    },
    {
      label: '10 g 18K EMI quote',
      input: { netWeightGrams: 10, grossWeightGrams: 12, karat: 18 },
      pureGoldGrams: '7.500',
      goldValuePaise: 5250000,
      bulletLoanPaise: 3675000,
      emiLoanPaise: 3937500,
    },
  ])('$label', async ({ input, ...expected }) => {
    const response = await request(makeApp()).post('/api/v1/quotes').send(input).expect(200);
    expect(response.body).toEqual({
      goldRatePerGram: 7000,
      pureGoldGrams: expected.pureGoldGrams,
      goldValuePaise: expected.goldValuePaise,
      quotes: [
        {
          planId: 'PLAN_BULLET_01',
          name: 'Bullet Repayment',
          ltvAppliedPercent: 70,
          eligibleLoanPaise: expected.bulletLoanPaise,
        },
        {
          planId: 'PLAN_EMI_01',
          name: 'Monthly EMI',
          ltvAppliedPercent: 75,
          eligibleLoanPaise: expected.emiLoanPaise,
        },
      ],
    });
  });

  it('reports net weight greater than gross weight on netWeightGrams', async () => {
    const response = await request(makeApp())
      .post('/api/v1/quotes')
      .send({ netWeightGrams: 52, grossWeightGrams: 50, karat: 22 })
      .expect(400);
    expect(response.body.error.fields[0].field).toBe('netWeightGrams');
  });

  it('rejects an invalid karat', async () => {
    const response = await request(makeApp())
      .post('/api/v1/quotes')
      .send({ netWeightGrams: 10, grossWeightGrams: 10, karat: 20 })
      .expect(400);
    expect(response.body.error.fields[0].field).toBe('karat');
  });

  it('returns the JSON error contract for malformed JSON', async () => {
    const response = await request(makeApp())
      .post('/api/v1/quotes')
      .set('content-type', 'application/json')
      .send('{"netWeightGrams":')
      .expect(400);
    expect(response.body).toEqual({
      error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.', fields: [] },
    });
  });

  it('returns the standard not found error for unknown routes', async () => {
    const response = await request(makeApp()).get('/api/v1/missing').expect(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found.', fields: [] },
    });
  });

  it('hides internals in unexpected error responses', async () => {
    const app = makeApp(async () => {
      throw new Error('database internals must not reach the client');
    });
    const response = await request(app).get('/api/v1/loan-schemes').expect(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        fields: [],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('stack');
    expect(JSON.stringify(response.body)).not.toContain('database internals');
  });
});
