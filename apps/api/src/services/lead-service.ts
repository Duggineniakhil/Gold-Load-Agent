import type { LeadAuditLog, LeadStatus } from '@prisma/client';
import {
  canTransition,
  leadStatusTransitions,
  type LeadRequest,
  type StatusUpdateRequest,
} from '@tglobal/shared';
import { AppError, ConflictError, NotFoundError } from '../errors.js';
import { requestHash } from '../domain/idempotency.js';
import { calculateQuote, parseWeightToMg } from '../domain/money.js';
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

    const scheme = await repository.findScheme(input.planId);
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

export async function listLeads(
  repository: LeadRepository,
  options: { limit: number; cursor?: string | undefined; planId?: string | undefined },
) {
  const rows = await repository.list(options);
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
  };
}
