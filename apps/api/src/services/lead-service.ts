import { ConflictError, NotFoundError } from '../errors.js';
import { calculateQuote, parseWeightToMg } from '../domain/money.js';
import { maskMobile } from '../domain/mobile.js';
import type { LeadRepository, LeadWithScheme } from '../repositories/lead-repository.js';
import type { LeadRequest } from '@tglobal/shared';

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
    createdAt: lead.createdAt,
  };
}

export async function submitLead(
  input: LeadRequest,
  repository: LeadRepository,
  goldRatePaisePerGram: bigint,
) {
  const scheme = await repository.findScheme(input.planId);
  if (!scheme) throw new NotFoundError('Loan scheme not found.', 'PLAN_NOT_FOUND');

  const netWeightMg = parseWeightToMg(input.netWeightGrams);
  const grossWeightMg = parseWeightToMg(input.grossWeightGrams);

  const lead = await repository.withMobileLock(input.mobileNumber, async (transaction) => {
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
    return transaction.create({
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
  });

  return {
    applicationId: lead.applicationId,
    status: lead.status,
    createdAt: lead.createdAt,
    lead: leadResponse(lead),
    quote: quoteResponse(lead, goldRatePaisePerGram),
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
    nextCursor: rows.length > options.limit ? page.at(-1)?.id ?? null : null,
  };
}
