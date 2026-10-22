import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateQuote, formatINR, parseWeightToMg } from '../src/domain/money.js';

const RATE_24K_PAISE = 700000n;

describe('parseWeightToMg', () => {
  it.each([
    ['45', 45000],
    ['45.5', 45500],
    ['45.123', 45123],
    [0.001, 1],
    [1000, 1000000],
  ] as const)('parses %s grams exactly', (input, expectedMg) => {
    expect(parseWeightToMg(input)).toBe(expectedMg);
  });

  it.each([['-1'], ['NaN'], ['Infinity'], ['45.1234'], ['1e-7']])(
    'rejects invalid weight %s',
    (input) => {
      expect(() => parseWeightToMg(input)).toThrow(RangeError);
    },
  );

  it('rejects non-finite and negative numbers', () => {
    for (const input of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      expect(() => parseWeightToMg(input)).toThrow(RangeError);
    }
  });
});

describe('calculateQuote', () => {
  it.each([
    {
      netWeightMg: 45000,
      karat: 22,
      maxLtvBps: 7500,
      pureGoldGrams: '41.250',
      goldValuePaise: 28875000,
      eligibleLoanPaise: 21656200,
    },
    {
      netWeightMg: 45000,
      karat: 22,
      maxLtvBps: 7000,
      pureGoldGrams: '41.250',
      goldValuePaise: 28875000,
      eligibleLoanPaise: 20212500,
    },
    {
      netWeightMg: 10000,
      karat: 18,
      maxLtvBps: 7500,
      pureGoldGrams: '7.500',
      goldValuePaise: 5250000,
      eligibleLoanPaise: 3937500,
    },
    {
      netWeightMg: 1000,
      karat: 22,
      maxLtvBps: 7500,
      pureGoldGrams: '0.917',
      goldValuePaise: 641667,
      eligibleLoanPaise: 481200,
    },
    {
      netWeightMg: 1,
      karat: 24,
      maxLtvBps: 7500,
      pureGoldGrams: '0.001',
      goldValuePaise: 700,
      eligibleLoanPaise: 500,
    },
    {
      netWeightMg: 1000000,
      karat: 24,
      maxLtvBps: 9000,
      pureGoldGrams: '1000.000',
      goldValuePaise: 700000000,
      eligibleLoanPaise: 525000000,
    },
  ])('calculates a quote for case %#', (input) => {
    const quote = calculateQuote({ ...input, goldRatePaisePerGram: RATE_24K_PAISE });

    expect(quote).toEqual({
      pureGoldGrams: input.pureGoldGrams,
      goldValuePaise: input.goldValuePaise,
      eligibleLoanPaise: input.eligibleLoanPaise,
      ltvAppliedBps: Math.min(input.maxLtvBps, 7500),
    });
  });

  it('formats paise as whole Indian rupees', () => {
    expect(formatINR(21656200)).toBe('₹2,16,562');
    expect(formatINR(20212500n)).toBe('₹2,02,125');
  });

  it('always returns whole-rupee loans within the 75% cap and monotonic in weight', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000000 }),
        fc.integer({ min: 1, max: 1000000 }),
        fc.constantFrom(18, 22, 24),
        fc.integer({ min: 1, max: 10000000 }),
        fc.integer({ min: 0, max: 9000 }),
        (firstWeight, secondWeight, karat, rate, maxLtvBps) => {
          const lowerWeight = Math.min(firstWeight, secondWeight);
          const higherWeight = Math.max(firstWeight, secondWeight);
          const quote = calculateQuote({
            netWeightMg: lowerWeight,
            karat,
            goldRatePaisePerGram: BigInt(rate),
            maxLtvBps,
          });
          const higherQuote = calculateQuote({
            netWeightMg: higherWeight,
            karat,
            goldRatePaisePerGram: BigInt(rate),
            maxLtvBps,
          });

          const exactValueNumerator = BigInt(lowerWeight) * BigInt(karat) * BigInt(rate);
          expect(quote.eligibleLoanPaise % 100).toBe(0);
          expect(BigInt(quote.eligibleLoanPaise) * 24000n * 10000n).toBeLessThanOrEqual(
            exactValueNumerator * BigInt(Math.min(maxLtvBps, 7500)),
          );
          expect(higherQuote.eligibleLoanPaise).toBeGreaterThanOrEqual(quote.eligibleLoanPaise);
        },
      ),
    );
  });
});
