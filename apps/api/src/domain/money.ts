const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/** Parse decimal grams as text so conversion to milligrams never uses float multiplication. */
export function parseWeightToMg(input: number | string): number {
  if (typeof input === 'number' && !Number.isFinite(input)) {
    throw new RangeError('Weight must be a finite non-negative number.');
  }

  const decimal = String(input);
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(decimal);
  if (!match) {
    throw new RangeError('Weight must be non-negative and have at most 3 decimal places.');
  }

  const wholeGrams = BigInt(match[1]!);
  const fractionalMg = BigInt((match[2] ?? '').padEnd(3, '0') || '0');
  const milligrams = wholeGrams * 1000n + fractionalMg;
  if (milligrams > MAX_SAFE_BIGINT) {
    throw new RangeError('Weight is too large.');
  }

  return Number(milligrams);
}

export type QuoteInput = {
  netWeightMg: number;
  karat: number;
  goldRatePaisePerGram: bigint;
  maxLtvBps: number;
};

export type Quote = {
  pureGoldGrams: string;
  goldValuePaise: number;
  eligibleLoanPaise: number;
  ltvAppliedBps: number;
};

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (2n * denominator);
}

function safeNumber(value: bigint, field: string): number {
  if (value > MAX_SAFE_BIGINT || value < -MAX_SAFE_BIGINT) {
    throw new RangeError(`${field} exceeds the safe integer range.`);
  }
  return Number(value);
}

export function calculateQuote({
  netWeightMg,
  karat,
  goldRatePaisePerGram,
  maxLtvBps,
}: QuoteInput): Quote {
  if (!Number.isSafeInteger(netWeightMg) || netWeightMg <= 0) {
    throw new RangeError('netWeightMg must be a positive safe integer.');
  }
  if (![18, 22, 24].includes(karat)) {
    throw new RangeError('karat must be 18, 22, or 24.');
  }
  if (goldRatePaisePerGram < 0n) {
    throw new RangeError('goldRatePaisePerGram must be non-negative.');
  }
  if (!Number.isSafeInteger(maxLtvBps) || maxLtvBps < 0) {
    throw new RangeError('maxLtvBps must be a non-negative safe integer.');
  }

  const weight = BigInt(netWeightMg);
  const karatBigInt = BigInt(karat);
  const appliedLtvBps = Math.min(maxLtvBps, 7500);
  const denominator = 24n * 1000n;
  const exactValueNumerator = weight * karatBigInt * goldRatePaisePerGram;

  // Keep the exact fraction for loan eligibility. Rounding the gold value first can
  // move a value across a whole-rupee boundary and produce a different loan amount.
  const goldValuePaise = roundHalfUp(exactValueNumerator, denominator);
  const loanNumerator = exactValueNumerator * BigInt(appliedLtvBps);
  const loanDenominator = denominator * 100n * 10000n;
  const eligibleLoanRupees = loanNumerator / loanDenominator;

  // Display pure gold to 0.001 g (1 mg), rounding half-up only after the exact ratio.
  const pureGoldMgRounded = roundHalfUp(weight * karatBigInt, 24n);
  const pureGoldGrams = `${pureGoldMgRounded / 1000n}.${(pureGoldMgRounded % 1000n)
    .toString()
    .padStart(3, '0')}`;

  return {
    pureGoldGrams,
    goldValuePaise: safeNumber(goldValuePaise, 'goldValuePaise'),
    eligibleLoanPaise: safeNumber(eligibleLoanRupees * 100n, 'eligibleLoanPaise'),
    ltvAppliedBps: appliedLtvBps,
  };
}

const indianRupeeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** Format paise as whole rupees using Indian digit grouping. */
export function formatINR(paise: number | bigint): string {
  if (typeof paise === 'number' && !Number.isSafeInteger(paise)) {
    throw new RangeError('paise must be a safe integer.');
  }
  return indianRupeeFormatter.format(BigInt(paise) / 100n);
}

export type RepaymentInput = {
  principalPaise: bigint;
  annualInterestBps: number;
  tenureMonths: number;
  repaymentType: 'EMI' | 'BULLET';
};

export type Repayment = {
  /** Null for bullet loans, which repay everything at maturity. */
  monthlyInstalmentPaise: bigint | null;
  totalInterestPaise: bigint;
  totalPayablePaise: bigint;
};

/**
 * Illustrative repayment for a principal, in exact integer paise.
 * EMI (reducing balance): with monthly rate r = bps / 120000,
 *   EMI = P·r·(1+r)^n / ((1+r)^n − 1) = P·a·(b+a)^n / (b·((b+a)^n − b^n)),  a = bps, b = 120000,
 * evaluated as one fraction and rounded half-up to the paise once.
 * Bullet: simple interest for the term, P·bps·n / 120000, rounded half-up, paid with the principal.
 */
export function estimateRepayment({
  principalPaise,
  annualInterestBps,
  tenureMonths,
  repaymentType,
}: RepaymentInput): Repayment {
  if (principalPaise <= 0n) throw new RangeError('principalPaise must be positive.');
  if (!Number.isSafeInteger(annualInterestBps) || annualInterestBps < 0) {
    throw new RangeError('annualInterestBps must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(tenureMonths) || tenureMonths <= 0) {
    throw new RangeError('tenureMonths must be a positive safe integer.');
  }

  const a = BigInt(annualInterestBps);
  const b = 120000n;
  const n = BigInt(tenureMonths);

  if (repaymentType === 'BULLET') {
    const totalInterestPaise = roundHalfUp(principalPaise * a * n, b);
    return {
      monthlyInstalmentPaise: null,
      totalInterestPaise,
      totalPayablePaise: principalPaise + totalInterestPaise,
    };
  }

  const monthlyInstalmentPaise =
    a === 0n
      ? roundHalfUp(principalPaise, n)
      : roundHalfUp(principalPaise * a * (b + a) ** n, b * ((b + a) ** n - b ** n));
  const totalPayablePaise = monthlyInstalmentPaise * n;
  return {
    monthlyInstalmentPaise,
    totalInterestPaise: totalPayablePaise - principalPaise,
    totalPayablePaise,
  };
}
