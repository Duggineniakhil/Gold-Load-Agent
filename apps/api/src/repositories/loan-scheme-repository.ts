import type { PrismaClient, RepaymentType } from '@prisma/client';

export type LoanSchemeRecord = {
  id: string;
  name: string;
  repaymentType: RepaymentType;
  annualInterestBps: number;
  tenureMonths: number;
  maxLtvBps: number;
};

export interface LoanSchemeRepository {
  findActive(): Promise<LoanSchemeRecord[]>;
}

export function createLoanSchemeRepository(
  prisma: Pick<PrismaClient, 'loanScheme'>,
): LoanSchemeRepository {
  return {
    findActive: () =>
      prisma.loanScheme.findMany({
        where: { isActive: true },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          repaymentType: true,
          annualInterestBps: true,
          tenureMonths: true,
          maxLtvBps: true,
        },
      }),
  };
}
