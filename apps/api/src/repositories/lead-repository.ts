import type {
  Lead,
  LeadAuditLog,
  LeadStatus,
  LoanScheme,
  Prisma,
  PrismaClient,
} from '@prisma/client';

export type SchemeForLead = Pick<
  LoanScheme,
  'id' | 'name' | 'repaymentType' | 'annualInterestBps' | 'tenureMonths' | 'maxLtvBps'
>;
export type LeadWithScheme = Lead & { scheme: SchemeForLead };
export type ExistingLead = Pick<Lead, 'applicationId' | 'createdAt'>;
export type StoredIdempotentResponse = {
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
};

export interface LeadTransaction {
  findRecentByMobile(mobileNumber: string): Promise<ExistingLead | null>;
  create(data: Prisma.LeadUncheckedCreateInput): Promise<LeadWithScheme>;
  findIdempotencyRecord(key: string): Promise<StoredIdempotentResponse | null>;
  saveIdempotencyRecord(record: {
    key: string;
    requestHash: string;
    responseStatus: number;
    responseBody: Prisma.InputJsonValue;
    leadId: string;
  }): Promise<void>;
}

export type LeadListOptions = {
  limit: number;
  cursor?: string | undefined;
  planId?: string | undefined;
};

export type LeadStatusInfo = Pick<Lead, 'id' | 'applicationId' | 'status' | 'createdAt'>;
export type RecentApplication = Pick<Lead, 'applicationId' | 'status' | 'createdAt'>;

export interface LeadRepository {
  findScheme(planId: string): Promise<SchemeForLead | null>;
  /**
   * Runs `operation` in one transaction holding PostgreSQL advisory locks on every key.
   * Keys are locked in sorted order so two requests can never deadlock each other.
   */
  withLocks<T>(
    lockKeys: string[],
    operation: (transaction: LeadTransaction) => Promise<T>,
  ): Promise<T>;
  list(options: LeadListOptions): Promise<LeadWithScheme[]>;
  findStatus(applicationId: string): Promise<LeadStatusInfo | null>;
  /** The latest application from this mobile in the last 7 days, the same window as the duplicate check. */
  findRecentApplication(mobileNumber: string): Promise<RecentApplication | null>;
  /**
   * Moves the lead from `from` to `to` and writes the audit row in one transaction.
   * Returns null when the lead is no longer in `from` (another change won the race).
   */
  transitionStatus(change: {
    applicationId: string;
    from: LeadStatus;
    to: LeadStatus;
    actor: string;
  }): Promise<{ lead: Lead; entry: LeadAuditLog } | null>;
  auditLog(leadId: string): Promise<LeadAuditLog[]>;
  /** Count and total eligible loan per status, optionally for one plan. */
  statusTotals(
    planId?: string,
  ): Promise<{ status: LeadStatus; count: number; eligibleLoanPaise: bigint }[]>;
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
    withLocks: (lockKeys, operation) =>
      prisma.$transaction(async (tx) => {
        for (const key of [...new Set(lockKeys)].sort()) {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_acquired`;
        }
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
          findIdempotencyRecord: (key) =>
            tx.idempotencyRecord.findUnique({
              where: { key },
              select: { requestHash: true, responseStatus: true, responseBody: true },
            }),
          saveIdempotencyRecord: async (record) => {
            await tx.idempotencyRecord.create({ data: record });
          },
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
    findRecentApplication: async (mobileNumber) => {
      const rows = await prisma.$queryRaw<RecentApplication[]>`
        SELECT "applicationId", "status", "createdAt"
        FROM "Lead"
        WHERE "mobileNumber" = ${mobileNumber}
          AND "createdAt" >= now() - interval '7 days'
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
      return rows[0] ?? null;
    },
    findStatus: (applicationId) =>
      prisma.lead.findUnique({
        where: { applicationId },
        select: { id: true, applicationId: true, status: true, createdAt: true },
      }),
    transitionStatus: ({ applicationId, from, to, actor }) =>
      prisma.$transaction(async (tx) => {
        const { count } = await tx.lead.updateMany({
          where: { applicationId, status: from },
          data: { status: to },
        });
        if (count === 0) return null;
        const lead = await tx.lead.findUniqueOrThrow({ where: { applicationId } });
        const entry = await tx.leadAuditLog.create({
          data: { leadId: lead.id, fromStatus: from, toStatus: to, actor },
        });
        return { lead, entry };
      }),
    statusTotals: async (planId) => {
      const groups = await prisma.lead.groupBy({
        by: ['status'],
        ...(planId ? { where: { schemeId: planId } } : {}),
        _count: { _all: true },
        _sum: { eligibleLoanPaise: true },
      });
      return groups.map((group) => ({
        status: group.status,
        count: group._count._all,
        eligibleLoanPaise: group._sum.eligibleLoanPaise ?? 0n,
      }));
    },
    auditLog: (leadId) =>
      prisma.leadAuditLog.findMany({ where: { leadId }, orderBy: { at: 'asc' } }),
  };
}
