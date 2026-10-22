import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLeadRepository } from '../src/repositories/lead-repository.js';
import { createLoanSchemeRepository } from '../src/repositories/loan-scheme-repository.js';
import { clearTestDatabase, closeTestDatabase, openTestDatabase } from './helpers/database.js';
import { fixedGoldRate, seededSchemes } from './helpers/fixtures.js';

let prisma: PrismaClient;

const app = () =>
  createApp({
    loanSchemeRepository: createLoanSchemeRepository(prisma),
    leadRepository: createLeadRepository(prisma),
    goldRate: fixedGoldRate(),
    logger: pino({ enabled: false }),
  });

async function fileLead(api: ReturnType<typeof app>, mobileNumber = '9876543210') {
  const response = await request(api)
    .post('/api/v1/leads')
    .send({
      name: 'Akhil Kumar',
      mobileNumber,
      grossWeightGrams: 50,
      netWeightGrams: 45,
      karat: 22,
      planId: 'PLAN_EMI_01',
    })
    .expect(201);
  return response.body.applicationId as string;
}

const move = (
  api: ReturnType<typeof app>,
  applicationId: string,
  status: string,
  actor = 'Asha Rao',
) => request(api).patch(`/api/v1/leads/${applicationId}/status`).send({ status, actor });

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

describe('PATCH /api/v1/leads/:applicationId/status', () => {
  it('walks SUBMITTED -> UNDER_REVIEW -> APPROVED and audits every step', async () => {
    const api = app();
    const id = await fileLead(api);

    const review = await move(api, id, 'UNDER_REVIEW', 'Asha Rao').expect(200);
    expect(review.body).toMatchObject({
      applicationId: id,
      status: 'UNDER_REVIEW',
      entry: { from: 'SUBMITTED', to: 'UNDER_REVIEW', actor: 'Asha Rao' },
    });
    await move(api, id, 'APPROVED', 'Imran Shaikh').expect(200);

    const audit = await request(api).get(`/api/v1/leads/${id}/audit`).expect(200);
    expect(audit.body.status).toBe('APPROVED');
    expect(
      audit.body.entries.map(({ from, to, actor }: Record<string, string>) => ({
        from,
        to,
        actor,
      })),
    ).toEqual([
      { from: 'SUBMITTED', to: 'UNDER_REVIEW', actor: 'Asha Rao' },
      { from: 'UNDER_REVIEW', to: 'APPROVED', actor: 'Imran Shaikh' },
    ]);
    expect(new Date(audit.body.entries[1].at) >= new Date(audit.body.entries[0].at)).toBe(true);
    expect(await prisma.leadAuditLog.count()).toBe(2);

    const list = await request(api).get('/api/v1/leads').expect(200);
    expect(list.body.items[0].status).toBe('APPROVED');
  });

  it.each([
    { path: [], to: 'APPROVED', from: 'SUBMITTED' },
    { path: [], to: 'SUBMITTED', from: 'SUBMITTED' },
    { path: ['UNDER_REVIEW'], to: 'SUBMITTED', from: 'UNDER_REVIEW' },
    { path: ['UNDER_REVIEW', 'REJECTED'], to: 'APPROVED', from: 'REJECTED' },
    { path: ['UNDER_REVIEW', 'APPROVED'], to: 'UNDER_REVIEW', from: 'APPROVED' },
  ])(
    'rejects $from -> $to with 409 INVALID_TRANSITION and writes no audit row',
    async ({ path, to, from }) => {
      const api = app();
      const id = await fileLead(api);
      for (const step of path) await move(api, id, step).expect(200);

      const response = await move(api, id, to).expect(409);

      expect(response.body.error).toMatchObject({
        code: 'INVALID_TRANSITION',
        fields: [],
        from,
        to,
      });
      expect(await prisma.leadAuditLog.count()).toBe(path.length);
    },
  );

  it('lets only one of two simultaneous decisions win', async () => {
    const api = app();
    for (let round = 0; round < 10; round += 1) {
      const id = await fileLead(api, `90000000${String(round).padStart(2, '0')}`);
      await move(api, id, 'UNDER_REVIEW').expect(200);

      const results = await Promise.all([
        move(api, id, 'APPROVED', 'Asha Rao'),
        move(api, id, 'REJECTED', 'Imran Shaikh'),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      const lead = await prisma.lead.findUniqueOrThrow({
        where: { applicationId: id },
        include: { auditLog: true },
      });
      expect(lead.auditLog).toHaveLength(2);
      expect(lead.auditLog.at(-1)?.toStatus).toBe(lead.status);
    }
  }, 60000);

  it('returns 404 for an unknown application and 400 for a bad body', async () => {
    const api = app();
    const missing = await move(api, 'GL-9999', 'UNDER_REVIEW').expect(404);
    expect(missing.body.error.code).toBe('LEAD_NOT_FOUND');
    await request(api).get('/api/v1/leads/GL-9999/audit').expect(404);

    const id = await fileLead(api);
    const invalid = await request(api)
      .patch(`/api/v1/leads/${id}/status`)
      .send({ status: 'DONE', actor: '' })
      .expect(400);
    expect(invalid.body.error.fields).toEqual([
      { field: 'status', message: 'Choose a valid status.' },
      { field: 'actor', message: 'Enter at least 2 characters.' },
    ]);
  });
});

describe('GET /api/v1/leads/stats', () => {
  it('counts every lead by status and totals the eligible loans, optionally per plan', async () => {
    const api = app();
    const first = await fileLead(api, '9000000001');
    await fileLead(api, '9000000002');
    await request(api)
      .post('/api/v1/leads')
      .send({
        name: 'Asha Rao',
        mobileNumber: '9000000003',
        grossWeightGrams: 12,
        netWeightGrams: 10,
        karat: 18,
        planId: 'PLAN_BULLET_01',
      })
      .expect(201);
    await move(api, first, 'UNDER_REVIEW').expect(200);

    const all = await request(api).get('/api/v1/leads/stats').expect(200);
    expect(all.body).toEqual({
      total: 3,
      byStatus: { SUBMITTED: 2, UNDER_REVIEW: 1, APPROVED: 0, REJECTED: 0 },
      totalEligibleLoanPaise: 21656200 * 2 + 3675000,
    });

    const emi = await request(api).get('/api/v1/leads/stats?planId=PLAN_EMI_01').expect(200);
    expect(emi.body).toMatchObject({ total: 2, totalEligibleLoanPaise: 21656200 * 2 });
  });
});
