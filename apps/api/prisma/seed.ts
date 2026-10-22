import { PrismaClient, type Prisma } from '@prisma/client';
import { env } from '../src/config/env.js';

const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });

async function main() {
  const schemes: Prisma.LoanSchemeCreateInput[] = [
    {
      id: 'PLAN_BULLET_01',
      name: 'Bullet Repayment',
      annualInterestBps: 1200,
      maxLtvBps: 7000,
      tenureMonths: 12,
      repaymentType: 'BULLET',
      isActive: true,
    },
    {
      id: 'PLAN_EMI_01',
      name: 'Monthly EMI',
      annualInterestBps: 1050,
      maxLtvBps: 7500,
      tenureMonths: 12,
      repaymentType: 'EMI',
      isActive: true,
    },
  ];

  for (const scheme of schemes) {
    await prisma.loanScheme.upsert({
      where: { id: scheme.id },
      create: scheme,
      update: scheme,
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
