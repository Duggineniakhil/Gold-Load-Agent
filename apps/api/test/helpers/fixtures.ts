import type { LeadRepository } from '../../src/repositories/lead-repository.js';
import { createGoldRateService } from '../../src/services/gold-rate-service.js';

export const seededSchemes = [
  {
    id: 'PLAN_BULLET_01',
    name: 'Bullet Repayment',
    repaymentType: 'BULLET' as const,
    annualInterestBps: 1200,
    tenureMonths: 12,
    maxLtvBps: 7000,
  },
  {
    id: 'PLAN_EMI_01',
    name: 'Monthly EMI',
    repaymentType: 'EMI' as const,
    annualInterestBps: 1050,
    tenureMonths: 12,
    maxLtvBps: 7500,
  },
];

/** A gold-rate service pinned to one rate, for tests. */
export const fixedGoldRate = (ratePaisePerGram = 700000n) =>
  createGoldRateService({ source: async () => ({ ratePaisePerGram, source: 'test' }) });

/** A lead repository for tests that never reach the database; override what a test needs. */
export const fakeLeadRepository = (overrides: Partial<LeadRepository> = {}): LeadRepository => ({
  withLocks: async () => {
    throw new Error('No lead repository configured for this test.');
  },
  list: async () => [],
  findStatus: async () => null,
  findRecentApplication: async () => null,
  transitionStatus: async () => null,
  auditLog: async () => [],
  statusTotals: async () => [],
  ...overrides,
});
