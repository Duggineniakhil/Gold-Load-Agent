import type { RepaymentEstimateRequest } from '@tglobal/shared';
import { estimateRepayment } from '../domain/money.js';
import { NotFoundError } from '../errors.js';
import type { LoanSchemeRepository } from '../repositories/loan-scheme-repository.js';

/** Repayment for the calculator, from the plan's own rate and tenure. Amounts are integer paise. */
export async function estimateLoanRepayment(
  { planId, loanAmountRupees }: RepaymentEstimateRequest,
  repository: LoanSchemeRepository,
) {
  const scheme = (await repository.findActive()).find((item) => item.id === planId);
  if (!scheme) throw new NotFoundError('Loan scheme not found.', 'PLAN_NOT_FOUND');

  const principalPaise = BigInt(loanAmountRupees) * 100n;
  const repayment = estimateRepayment({
    principalPaise,
    annualInterestBps: scheme.annualInterestBps,
    tenureMonths: scheme.tenureMonths,
    repaymentType: scheme.repaymentType,
  });
  return {
    planId: scheme.id,
    planName: scheme.name,
    repaymentType: scheme.repaymentType,
    annualInterestRate: scheme.annualInterestBps / 100,
    tenureMonths: scheme.tenureMonths,
    principalPaise: Number(principalPaise),
    monthlyInstalmentPaise:
      repayment.monthlyInstalmentPaise === null ? null : Number(repayment.monthlyInstalmentPaise),
    totalInterestPaise: Number(repayment.totalInterestPaise),
    totalPayablePaise: Number(repayment.totalPayablePaise),
  };
}
