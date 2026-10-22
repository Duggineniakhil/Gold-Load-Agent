import type { LeadAuditLog } from '@prisma/client';
import {
  canTransition,
  leadStatuses,
  leadStatusTransitions,
  type LeadStatus,
  type LeadRequest,
  type StatusUpdateRequest,
} from '@tglobal/shared';
import { AppError, ConflictError, NotFoundError } from '../errors.js';
import { requestHash } from '../domain/idempotency.js';
import { calculateQuote, formatINR, parseWeightToMg } from '../domain/money.js';
import { maskMobile } from '../domain/mobile.js';
import type { LeadRepository, LeadWithScheme } from '../repositories/lead-repository.js';

function formatMgAsGrams(milligrams: number): string {
  return `${Math.floor(milligrams / 1000)}.${String(milligrams % 1000).padStart(3, '0')}`;
}

function pureGoldMgFromDisplay(pureGoldGrams: string): number {
  const [whole = '0', fractional = '0'] = pureGoldGrams.split('.');
  return Number(BigInt(whole) * 1000n + BigInt(fractional.padEnd(3, '0')));
}

function quoteResponse(lead: LeadWithScheme, goldRatePaisePerGram: bigint) {
  return {
    goldRatePerGram: Number(goldRatePaisePerGram / 100n),
    pureGoldGrams: formatMgAsGrams(lead.pureGoldMg),
    goldValuePaise: Number(lead.goldValuePaise),
    planId: lead.schemeId,
    planName: lead.scheme.name,
    ltvAppliedPercent: lead.ltvAppliedBps / 100,
    eligibleLoanPaise: Number(lead.eligibleLoanPaise),
  };
}

function leadResponse(lead: LeadWithScheme) {
  return {
    id: lead.id,
    applicationId: lead.applicationId,
    name: lead.name,
    mobileNumber: maskMobile(lead.mobileNumber),
    grossWeightGrams: lead.grossWeightMg / 1000,
    netWeightGrams: lead.netWeightMg / 1000,
    karat: lead.karat,
    planId: lead.schemeId,
    goldRatePaisePerGram: Number(lead.goldRatePaisePerGram),
    pureGoldMg: lead.pureGoldMg,
    goldValuePaise: Number(lead.goldValuePaise),
    eligibleLoanPaise: Number(lead.eligibleLoanPaise),
    ltvAppliedBps: lead.ltvAppliedBps,
    status: lead.status,
    createdAt: lead.createdAt.toISOString(),
  };
}

export type LeadSubmission = {
  applicationId: string;
  status: string;
  createdAt: string;
  lead: ReturnType<typeof leadResponse>;
  quote: ReturnType<typeof quoteResponse>;
};

export type IdempotencyInput = { key: string; body: unknown };

/**
 * Files a lead. With an idempotency key, the key and the request hash are checked under
 * an advisory lock in the same transaction that creates the lead, so concurrent retries
 * with one key produce exactly one lead and replay the same 201 response.
 */
export async function submitLeadRequest(
  input: LeadRequest,
  repository: LeadRepository,
  goldRatePaisePerGram: bigint,
  idempotency?: IdempotencyInput,
): Promise<{ response: LeadSubmission; replayed: boolean }> {
  const netWeightMg = parseWeightToMg(input.netWeightGrams);
  const grossWeightMg = parseWeightToMg(input.grossWeightGrams);
  const hash = idempotency ? requestHash(idempotency.body) : null;
  const lockKeys = [
    `mobile:${input.mobileNumber}`,
    ...(idempotency ? [`idempotency:${idempotency.key}`] : []),
  ];

  return repository.withLocks(lockKeys, async (transaction) => {
    if (idempotency) {
      const stored = await transaction.findIdempotencyRecord(idempotency.key);
      if (stored) {
        if (stored.requestHash !== hash) {
          throw new AppError(
            422,
            'IDEMPOTENCY_KEY_REUSED',
            'This Idempotency-Key was already used with a different request body.',
          );
        }
        return { response: stored.responseBody as LeadSubmission, replayed: true };
      }
    }

    const scheme = await transaction.findScheme(input.planId);
    if (!scheme) throw new NotFoundError('Loan scheme not found.', 'PLAN_NOT_FOUND');

    const existing = await transaction.findRecentByMobile(input.mobileNumber);
    if (existing) {
      throw new ConflictError(
        'An application was already submitted with this mobile number in the last 7 days.',
        'DUPLICATE_APPLICATION',
        [],
        { existing },
      );
    }

    const quote = calculateQuote({
      netWeightMg,
      karat: input.karat,
      goldRatePaisePerGram,
      maxLtvBps: scheme.maxLtvBps,
    });
    const lead = await transaction.create({
      name: input.name,
      mobileNumber: input.mobileNumber,
      grossWeightMg,
      netWeightMg,
      karat: input.karat,
      schemeId: scheme.id,
      goldRatePaisePerGram,
      pureGoldMg: pureGoldMgFromDisplay(quote.pureGoldGrams),
      goldValuePaise: BigInt(quote.goldValuePaise),
      eligibleLoanPaise: BigInt(quote.eligibleLoanPaise),
      ltvAppliedBps: quote.ltvAppliedBps,
      status: 'SUBMITTED',
    });

    const response: LeadSubmission = {
      applicationId: lead.applicationId,
      status: lead.status,
      createdAt: lead.createdAt.toISOString(),
      lead: leadResponse(lead),
      quote: quoteResponse(lead, goldRatePaisePerGram),
    };
    if (idempotency && hash) {
      await transaction.saveIdempotencyRecord({
        key: idempotency.key,
        requestHash: hash,
        responseStatus: 201,
        responseBody: response,
        leadId: lead.id,
      });
    }
    return { response, replayed: false };
  });
}

/** Files a lead without an idempotency key (used by Loan Assist after the borrower confirms). */
export async function submitLead(
  input: LeadRequest,
  repository: LeadRepository,
  goldRatePaisePerGram: bigint,
) {
  return (await submitLeadRequest(input, repository, goldRatePaisePerGram)).response;
}

const auditEntryResponse = (entry: LeadAuditLog) => ({
  from: entry.fromStatus,
  to: entry.toStatus,
  actor: entry.actor,
  at: entry.at.toISOString(),
});

function invalidTransition(applicationId: string, from: LeadStatus, to: LeadStatus) {
  const allowed = leadStatusTransitions[from];
  return new ConflictError(
    allowed.length
      ? `${applicationId} is ${from} and can only move to ${allowed.join(' or ')}.`
      : `${applicationId} is ${from}, which is final.`,
    'INVALID_TRANSITION',
    [],
    { from, to, allowed },
  );
}

/** Applies one step of SUBMITTED -> UNDER_REVIEW -> APPROVED | REJECTED and audits it. */
export async function updateLeadStatus(
  applicationId: string,
  { status: to, actor }: StatusUpdateRequest,
  repository: LeadRepository,
) {
  const lead = await repository.findStatus(applicationId);
  if (!lead) throw new NotFoundError('Application not found.', 'LEAD_NOT_FOUND');
  if (!canTransition(lead.status, to)) throw invalidTransition(applicationId, lead.status, to);

  const result = await repository.transitionStatus({ applicationId, from: lead.status, to, actor });
  if (!result) {
    // Another change landed between the read and the update; report against the fresh status.
    const latest = await repository.findStatus(applicationId);
    throw invalidTransition(applicationId, latest?.status ?? lead.status, to);
  }
  return {
    applicationId,
    status: result.lead.status,
    updatedAt: result.lead.updatedAt.toISOString(),
    entry: auditEntryResponse(result.entry),
  };
}

export async function getLeadAudit(applicationId: string, repository: LeadRepository) {
  const lead = await repository.findStatus(applicationId);
  if (!lead) throw new NotFoundError('Application not found.', 'LEAD_NOT_FOUND');
  const entries = await repository.auditLog(lead.id);
  return {
    applicationId,
    status: lead.status,
    submittedAt: lead.createdAt.toISOString(),
    entries: entries.map(auditEntryResponse),
  };
}

export type PlainEnglishLeadFilter = {
  status?: LeadStatus;
  repaymentType?: 'BULLET' | 'EMI';
  karat?: 18 | 22 | 24;
  minNetWeightMg?: number;
  minEligibleLoanPaise?: bigint;
  maxEligibleLoanPaise?: bigint;
  search?: string;
  summary: string;
};

function thresholdPaise(amount: string, unit: string | undefined): bigint | null {
  const normalized = amount.replace(/,/g, '');
  const [whole = '0', fraction = ''] = normalized.split('.');
  const multiplier = unit?.startsWith('l')
    ? 10_000_000n
    : unit?.startsWith('c')
      ? 1_000_000_000n
      : 100n;
  const denominator = 10n ** BigInt(fraction.length);
  const scaled = (BigInt(whole) * denominator + BigInt(fraction || '0')) * multiplier;
  return scaled % denominator === 0n ? scaled / denominator : null;
}

function thresholdMg(amount: string): number | null {
  if (!/^\d+(?:\.\d{1,3})?$/.test(amount)) return null;
  const [whole = '0', fraction = ''] = amount.split('.');
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

export function parsePlainEnglishLeadFilter(input: string): PlainEnglishLeadFilter {
  let remaining = input.trim();
  const criteria: string[] = [];
  const parsed: Omit<PlainEnglishLeadFilter, 'summary'> = {};
  const statusTerms: [RegExp, LeadStatus, string][] = [
    [/\b(?:pending|new|submitted|awaiting review)\b/i, 'SUBMITTED', 'awaiting review'],
    [/\bunder review\b/i, 'UNDER_REVIEW', 'under review'],
    [/\bapproved\b/i, 'APPROVED', 'approved'],
    [/\brejected\b/i, 'REJECTED', 'rejected'],
  ];
  for (const [pattern, status, label] of statusTerms) {
    const match = pattern.exec(remaining);
    if (match) {
      parsed.status = status;
      criteria.push(label);
      remaining = remaining.replace(match[0], ' ');
      break;
    }
  }

  const repayment = /\b(emi|bullet)\b/i.exec(remaining);
  if (repayment) {
    parsed.repaymentType = repayment[1]?.toLowerCase() === 'emi' ? 'EMI' : 'BULLET';
    criteria.push(`${repayment[1]?.toUpperCase()} plan`);
    remaining = remaining.replace(repayment[0], ' ');
  }

  const karat = /\b(18|22|24)\s*(?:k|karat|carat)\b/i.exec(remaining);
  if (karat) {
    parsed.karat = Number(karat[1]) as 18 | 22 | 24;
    criteria.push(`${karat[1]}K gold`);
    remaining = remaining.replace(karat[0], ' ');
  }

  const weightPattern =
    /\b(?:net\s+)?(?:weight\s+)?(above|over|greater than|more than|at least|>=)\s*(\d+(?:\.\d{1,3})?)\s*(?:g|grams?)\b/i;
  const weight = weightPattern.exec(remaining);
  if (weight) {
    const amount = weight[2] ?? '';
    let milligrams = thresholdMg(amount);
    if (milligrams !== null) {
      const strict = !['at least', '>='].includes(weight[1]?.toLowerCase() ?? '');
      if (strict) milligrams += 1;
      parsed.minNetWeightMg = milligrams;
      criteria.push(`net weight ${strict ? 'over' : 'at least'} ${amount} g`);
    }
    remaining = remaining.replace(weight[0], ' ');
  }

  const amountPattern =
    /\b(?:loan|amount)s?\s+(above|over|greater than|more than|at least|below|under|less than|at most|up to|>=|<=)\s*(?:₹\s*|rs\.?\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(lakh|lakhs|lac|lacs|l|crore|crores|cr|rupees?|inr)?/i;
  const explicitAmountPattern =
    /\b(above|over|greater than|more than|at least|below|under|less than|at most|up to|>=|<=)\s*(?:₹\s*|rs\.?\s*)(\d[\d,]*(?:\.\d{1,2})?)\s*(lakh|lakhs|lac|lacs|l|crore|crores|cr)?/i;
  const amount = amountPattern.exec(remaining) ?? explicitAmountPattern.exec(remaining);
  if (amount) {
    const operator = amount[1]?.toLowerCase() ?? '';
    const paise = thresholdPaise(amount[2] ?? '', amount[3]?.toLowerCase());
    if (paise !== null) {
      const minimum = ['above', 'over', 'greater than', 'more than', 'at least', '>='].includes(
        operator,
      );
      const strict = [
        'above',
        'over',
        'greater than',
        'more than',
        'below',
        'under',
        'less than',
      ].includes(operator);
      if (minimum) parsed.minEligibleLoanPaise = strict ? paise + 1n : paise;
      else parsed.maxEligibleLoanPaise = strict ? paise - 1n : paise;
      criteria.push(
        `loan ${strict ? (minimum ? 'over' : 'below') : minimum ? 'at least' : 'up to'} ${formatINR(paise)}`,
      );
    }
    remaining = remaining.replace(amount[0], ' ');
  }

  remaining = remaining
    .replace(
      /\b(?:applications?|leads?|show|list|find|all|loan|loans|for|on|plan|with|the|and|me|please|that|are|have|name|called|contains|belonging)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (remaining) {
    parsed.search = remaining.slice(0, 60);
    criteria.push(`matching “${parsed.search}”`);
  }

  return { ...parsed, summary: criteria.length ? `Filtered by ${criteria.join(', ')}.` : '' };
}

export async function listLeads(
  repository: LeadRepository,
  options: {
    limit: number;
    cursor?: string | undefined;
    planId?: string | undefined;
    filter?: string | undefined;
  },
) {
  const parsedFilter = parsePlainEnglishLeadFilter(options.filter ?? '');
  const rows = await repository.list({ ...options, ...parsedFilter });
  const page = rows.slice(0, options.limit);
  return {
    items: page.map((lead) => ({
      applicationId: lead.applicationId,
      name: lead.name,
      mobileNumber: maskMobile(lead.mobileNumber),
      netWeightGrams: lead.netWeightMg / 1000,
      karat: lead.karat,
      planId: lead.schemeId,
      planName: lead.scheme.name,
      eligibleLoanPaise: Number(lead.eligibleLoanPaise),
      status: lead.status,
      createdAt: lead.createdAt,
    })),
    nextCursor: rows.length > options.limit ? (page.at(-1)?.id ?? null) : null,
    filterSummary: parsedFilter.summary,
  };
}

/** Totals for the admin dashboard, computed in the database over every lead (not one page). */
export async function getLeadStats(repository: LeadRepository, planId?: string) {
  const groups = await repository.statusTotals(planId);
  const byStatus = Object.fromEntries(leadStatuses.map((status) => [status, 0])) as Record<
    LeadStatus,
    number
  >;
  let totalEligibleLoanPaise = 0n;
  for (const group of groups) {
    byStatus[group.status] = group.count;
    totalEligibleLoanPaise += group.eligibleLoanPaise;
  }
  return {
    total: groups.reduce((sum, group) => sum + group.count, 0),
    byStatus,
    totalEligibleLoanPaise: Number(totalEligibleLoanPaise),
  };
}
