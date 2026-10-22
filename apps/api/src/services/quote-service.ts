import { calculateQuote, parseWeightToMg } from '../domain/money.js';
import type { LoanSchemeRepository } from '../repositories/loan-scheme-repository.js';
import type { QuoteRequest } from '@tglobal/shared';

export async function createQuotes(
  input: QuoteRequest,
  repository: LoanSchemeRepository,
  goldRatePaisePerGram: bigint,
) {
  const netWeightMg = parseWeightToMg(input.netWeightGrams);
  const schemes = await repository.findActive();
  const reference = calculateQuote({
    netWeightMg,
    karat: input.karat,
    goldRatePaisePerGram,
    maxLtvBps: 7500,
  });

  return {
    goldRatePerGram: Number(goldRatePaisePerGram / 100n),
    pureGoldGrams: reference.pureGoldGrams,
    goldValuePaise: reference.goldValuePaise,
    quotes: schemes.map((scheme) => {
      const quote = calculateQuote({
        netWeightMg,
        karat: input.karat,
        goldRatePaisePerGram,
        maxLtvBps: scheme.maxLtvBps,
      });
      return {
        planId: scheme.id,
        name: scheme.name,
        ltvAppliedPercent: quote.ltvAppliedBps / 100,
        eligibleLoanPaise: quote.eligibleLoanPaise,
      };
    }),
  };
}
