import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearTestDatabase,
  closeTestDatabase,
  openTestDatabase,
} from './helpers/database.js';

let prisma: PrismaClient;

const schemeData = {
  id: 'PLAN_TEST_01',
  name: 'Test Plan',
  repaymentType: 'EMI' as const,
  annualInterestBps: 1050,
  tenureMonths: 12,
  maxLtvBps: 7500,
  isActive: true,
};

function leadData(overrides: Partial<Prisma.LeadUncheckedCreateInput> = {}) {
  return {
    name: 'Akhil Kumar',
    mobileNumber: '9876543210',
    grossWeightMg: 50000,
    netWeightMg: 45000,
    karat: 22,
    schemeId: schemeData.id,
    goldRatePaisePerGram: 700000n,
    pureGoldMg: 41250,
    goldValuePaise: 28875000n,
    eligibleLoanPaise: 21656250n,
    ltvAppliedBps: 7500,
    ...overrides,
  } satisfies Prisma.LeadUncheckedCreateInput;
}

beforeAll(async () => {
  prisma = await openTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase(prisma);
});

afterAll(async () => {
  await closeTestDatabase(prisma);
});

describe('PostgreSQL constraints and generated application IDs', () => {
  it('rejects rows that violate the database CHECK constraints', async () => {
    await expect(
      prisma.loanScheme.create({ data: { ...schemeData, maxLtvBps: 7501 } }),
    ).rejects.toThrow();

    await prisma.loanScheme.create({ data: schemeData });

    const invalidLeads: Prisma.LeadUncheckedCreateInput[] = [
      leadData({ netWeightMg: 0 }),
      leadData({ grossWeightMg: 40000, netWeightMg: 45000 }),
      leadData({ grossWeightMg: 1000001, netWeightMg: 45000 }),
      leadData({ karat: 20 }),
    ];

    for (const data of invalidLeads) {
      await expect(prisma.lead.create({ data })).rejects.toThrow();
    }
  });

  it('generates application IDs from the PostgreSQL sequence', async () => {
    await prisma.loanScheme.create({ data: schemeData });

    const first = await prisma.lead.create({ data: leadData() });
    const second = await prisma.lead.create({
      data: leadData({ mobileNumber: '9876543211' }),
    });

    expect([first.applicationId, second.applicationId]).toEqual(['GL-1001', 'GL-1002']);
  });
});
