import type { LoanSchemeRepository } from '../repositories/loan-scheme-repository.js';

export async function listActiveLoanSchemes(repository: LoanSchemeRepository) {
  const schemes = await repository.findActive();
  return schemes.map((scheme) => ({
    id: scheme.id,
    name: scheme.name,
    annualInterestRate: scheme.annualInterestBps / 100,
    tenureMonths: scheme.tenureMonths,
    maxLtv: Math.min(scheme.maxLtvBps, 7500) / 100,
    repaymentType: scheme.repaymentType,
  }));
}
