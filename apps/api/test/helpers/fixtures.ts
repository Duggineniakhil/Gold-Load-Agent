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
