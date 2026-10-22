import type { Lead, LoanScheme, Prisma, PrismaClient } from '@prisma/client';

export type SchemeForLead = Pick<
  LoanScheme,
  'id' | 'name' | 'repaymentType' | 'annualInterestBps' | 'tenureMonths' | 'maxLtvBps'
>;
export type LeadWithScheme = Lead & { scheme: SchemeForLead };
export type ExistingLead = Pick<Lead, 'applicationId' | 'createdAt'>;

export interface LeadTransaction {
  findRecentByMobile(mobileNumber: string): Promise<ExistingLead | null>;
  create(data: Prisma.LeadUncheckedCreateInput): Promise<LeadWithScheme>;
}

export type LeadListOptions = {
  limit: number;
  cursor?: string | undefined;
  planId?: string | undefined;
};

export interface LeadRepository {
  findScheme(planId: string): Promise<SchemeForLead | null>;
  withMobileLock<T>(mobileNumber: string, operation: (transaction: LeadTransaction) => Promise<T>): Promise<T>;
  list(options: LeadListOptions): Promise<LeadWithScheme[]>;
}

export function createLeadRepository(prisma: PrismaClient): LeadRepository {
  return {
    findScheme: (id) =>
      prisma.loanScheme.findUnique({
        where: { id, isActive: true },
        select: {
          id: true,
          name: true,
          repaymentType: true,
          annualInterestBps: true,
          tenureMonths: true,
          maxLtvBps: true,
        },
      }),
    withMobileLock: (mobileNumber, operation) =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${mobileNumber}))::text AS lock_acquired`;
        return operation({
          findRecentByMobile: async (mobile) => {
            const rows = await tx.$queryRaw<ExistingLead[]>`
              SELECT "applicationId", "createdAt"
              FROM "Lead"
              WHERE "mobileNumber" = ${mobile}
                AND "createdAt" >= now() - interval '7 days'
              ORDER BY "createdAt" DESC
              LIMIT 1
            `;
            return rows[0] ?? null;
          },
          create: (data) => tx.lead.create({ data, include: { scheme: true } }),
        });
      }),
    list: async ({ limit, cursor, planId }) => {
      const rows = await prisma.lead.findMany({
        ...(planId ? { where: { schemeId: planId } } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: limit + 1,
        include: { scheme: true },
      });
      return rows;
    },
  };
}
