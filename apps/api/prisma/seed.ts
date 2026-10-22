import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const schemes = [
    {
      id: 'PLAN_BULLET_01',
      name: 'Bullet Repayment',
      annualInterestRate: '12.00',
      maxLtv: '0.700',
      tenureMonths: 12,
      repaymentType: 'BULLET',
    },
    {
      id: 'PLAN_EMI_01',
      name: 'Monthly EMI',
      annualInterestRate: '10.50',
      maxLtv: '0.750',
      tenureMonths: 12,
      repaymentType: 'EMI',
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
